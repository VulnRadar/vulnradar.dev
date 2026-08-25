import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import {
  APP_NAME,
  SEVERITY_LEVELS,
  DEFAULT_SCAN_NOTE,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import {
  getDangerScore,
  getEngineConfidence,
} from "@/lib/scanner/safety-rating";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { getDecryptedGithubToken } from "@/lib/github/github-connections";
import { getRepoInfo, listRepoTree } from "@/lib/github/github-api";
import {
  filterScannableFiles,
  type RepoFilterCaps,
} from "@/lib/github/repo-filter";
import {
  estimateTokens,
  fetchSelectedFiles,
  runPatternSecretsScan,
} from "@/lib/scanner/github-repo-scan";
import { runGithubAiReview } from "@/lib/ai/review-source";
import { attachCvssScores } from "@/lib/scanner/cvss";
import {
  checkGithubReviewQuota,
  claimFreeGithubReviewTrial,
  releaseFreeGithubReviewTrial,
} from "@/lib/billing/github-review-usage";
import {
  checkRateLimit as checkGlobalRateLimit,
  RATE_LIMITS,
} from "@/lib/rate-limiting/rate-limit";

const REPO_FULL_NAME_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

// POST /api/v3/scan/github — run a security review against a connected
// GitHub repo's source instead of a live URL. Session-only (no API key
// path yet — this is a new, separate scanning mode from the URL scanner).
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.userId;

    let body: { repoFullName?: string; ref?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }

    const repoFullName = body.repoFullName?.trim();
    if (!repoFullName || !REPO_FULL_NAME_RE.test(repoFullName)) {
      return NextResponse.json(
        { error: "repoFullName is required and must look like 'owner/repo'." },
        { status: 400 },
      );
    }
    const [owner, repo] = repoFullName.split("/");

    // Same request-throttling pattern as every sibling scan/AI endpoint
    // (e.g. scan/authenticated's `scan-authenticated:${userId}` key) --
    // this route had none at all, so a caller could hammer both GitHub's
    // API and the AI review pipeline with rapid-fire requests before
    // checkGithubReviewQuota's own per-window USAGE cap ever kicked in
    // (AUDIT-010, production-readiness #5).
    const rl = await checkGlobalRateLimit({
      key: `scan-github:${userId}`,
      ...RATE_LIMITS.scan,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        { status: 429 },
      );
    }

    const token = await getDecryptedGithubToken(userId);
    if (!token) {
      return NextResponse.json(
        { error: "Connect your GitHub account first." },
        { status: 400 },
      );
    }

    // Checked before any real GitHub API call is made, not after (this used
    // to call getRepoInfo/listRepoTree first and only check quota once both
    // had already spent real GitHub API calls on a request that might get
    // rejected anyway) (AUDIT-010, production-readiness #5).
    const preQuota = await checkGithubReviewQuota(userId);
    if (!preQuota.allowed) {
      return NextResponse.json({ error: preQuota.message }, { status: 403 });
    }

    const repoInfo = await getRepoInfo(token, owner, repo);
    const ref = body.ref?.trim() || repoInfo.defaultBranch;

    const tree = await listRepoTree(token, owner, repo, ref);

    const caps: RepoFilterCaps = {
      maxFiles: await getSetting("GITHUB_REVIEW_MAX_FILES"),
      maxTotalBytes: await getSetting("GITHUB_REVIEW_MAX_TOTAL_BYTES"),
      maxFileBytes: await getSetting("GITHUB_REVIEW_MAX_FILE_BYTES"),
    };
    const { selected, truncatedByCaps } = filterScannableFiles(
      tree.entries,
      caps,
    );

    if (selected.length === 0) {
      return NextResponse.json(
        {
          error:
            "No scannable files were found in this repo (after skipping binaries and vendor/build directories).",
        },
        { status: 400 },
      );
    }

    // Cheap upfront token estimate from tree metadata (byte size), before
    // fetching a single byte of content or spending an AI call. Applies
    // regardless of plan or AI-key ownership — see the doc comment on
    // GITHUB_REVIEW_MAX_TOKENS_PER_RUN in lib/config/registry.ts.
    const estimatedBytes = selected.reduce((sum, e) => sum + (e.size ?? 0), 0);
    const maxTokensPerRun = await getSetting(
      "GITHUB_REVIEW_MAX_TOKENS_PER_RUN",
    );
    if (estimateTokens(estimatedBytes) > maxTokensPerRun) {
      return NextResponse.json(
        {
          error:
            "This repo is too large for automated AI review right now. Try a smaller repo, or ask an admin to raise the per-run token ceiling.",
        },
        { status: 413 },
      );
    }

    const quota = await checkGithubReviewQuota(userId);
    if (!quota.allowed) {
      return NextResponse.json({ error: quota.message }, { status: 403 });
    }

    // The trial slot is claimed atomically, right here, before any real
    // work starts -- not after checkGithubReviewQuota's own read-only
    // check above, which two concurrent requests from the same account
    // could both pass before either had claimed anything, allowing two
    // free reviews inside one window instead of one. If this specific
    // request loses that race, it's rejected now rather than after
    // spending real AI tokens on a review that was never actually free.
    if (quota.isFreeTrial) {
      const claimed = await claimFreeGithubReviewTrial(userId);
      if (!claimed) {
        return NextResponse.json(
          {
            error:
              "Free trial review already used today. Upgrade your plan for ongoing GitHub AI review access.",
          },
          { status: 403 },
        );
      }
    }

    const startTime = Date.now();

    let files: Awaited<ReturnType<typeof fetchSelectedFiles>>;
    let secretFindings: ReturnType<typeof runPatternSecretsScan>;
    let aiResult: Awaited<ReturnType<typeof runGithubAiReview>>;
    try {
      files = await fetchSelectedFiles(token, owner, repo, selected);
      secretFindings = runPatternSecretsScan(files);
      aiResult = await runGithubAiReview(
        files,
        userId,
        quota.usingOwnAi,
        repoInfo.private,
        quota.creditCovered ?? false,
      );
    } catch (err) {
      // Give the claimed slot back: a review that didn't complete must
      // not cost the user their one daily free trial. Matches this
      // route's existing "record after, not before" convention -- the
      // claim above is the exception (it has to happen before, to close
      // the race), and this release is what keeps the net effect the
      // same as recording strictly after success.
      if (quota.isFreeTrial) {
        await releaseFreeGithubReviewTrial(userId).catch(() => {});
      }
      throw err;
    }

    // A free-trial slot must also be returned when the review produced nothing
    // WITHOUT throwing: no server AI endpoint configured, the run exceeded the
    // per-run token ceiling, or zero tokens were actually spent. Otherwise the
    // user burns their one free review for an empty result.
    if (
      quota.isFreeTrial &&
      (aiResult.noEndpoint ||
        aiResult.rejectedOverCap ||
        aiResult.totalTokensUsed === 0)
    ) {
      await releaseFreeGithubReviewTrial(userId).catch(() => {});
    }

    const findings: Vulnerability[] = attachCvssScores([
      ...secretFindings,
      ...aiResult.findings,
    ]);

    const summary = {
      critical: findings.filter((f) => f.severity === SEVERITY_LEVELS.CRITICAL)
        .length,
      high: findings.filter((f) => f.severity === SEVERITY_LEVELS.HIGH).length,
      medium: findings.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM)
        .length,
      low: findings.filter((f) => f.severity === SEVERITY_LEVELS.LOW).length,
      info: findings.filter((f) => f.severity === SEVERITY_LEVELS.INFO).length,
      total: findings.length,
    };

    const duration = Date.now() - startTime;
    const dangerScore = getDangerScore(findings);
    const engineConfidence = getEngineConfidence(findings);

    const result: ScanResult = {
      url: repoFullName,
      scannedAt: new Date().toISOString(),
      duration,
      findings,
      summary,
      dangerScore,
      engineConfidence,
    };

    let scanHistoryId: number | null = null;
    try {
      // is_public = false: unlike a URL scan (a public website's HTTP
      // posture), findings here can quote actual lines of a private
      // repo's source -- including the secrets/evidence this scan exists
      // to find. Defaulting to private avoids that ever being one click
      // away from a share link the way scan_history.is_public otherwise
      // defaults to true.
      const insertResult = await pool.query(
        `INSERT INTO scan_history (user_id, url, scan_type, summary, findings, findings_count, duration, scanned_at, source, notes, is_public)
         VALUES ($1, $2, 'github', $3, $4, $5, $6, $7, 'web', $8, FALSE) RETURNING id`,
        [
          userId,
          repoFullName,
          JSON.stringify(summary),
          JSON.stringify(findings),
          summary.total,
          duration,
          result.scannedAt,
          DEFAULT_SCAN_NOTE,
        ],
      );
      scanHistoryId = insertResult.rows[0]?.id ?? null;
    } catch (err) {
      console.error(
        `[${APP_NAME}] Failed to save GitHub repo scan history:`,
        err instanceof Error ? err.message : err,
      );
    }

    return NextResponse.json({
      ...result,
      scanHistoryId,
      ref,
      filesScanned: files.length,
      filesSkippedByCaps: truncatedByCaps,
      aiTokensUsed: aiResult.totalTokensUsed,
      aiReviewSkipped: aiResult.noEndpoint,
    });
  } catch (error) {
    console.error(
      `[${APP_NAME}] GitHub repo scan error:`,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "An unexpected error occurred during the repo scan." },
      { status: 500 },
    );
  }
}
