import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { APP_NAME, SEVERITY_LEVELS, DEFAULT_SCAN_NOTE } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { getDangerScore, getEngineConfidence } from "@/lib/scanner/safety-rating";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { getDecryptedGithubToken } from "@/lib/github/github-connections";
import {
  getRepoDefaultBranch,
  listRepoTree,
} from "@/lib/github/github-api";
import { filterScannableFiles, type RepoFilterCaps } from "@/lib/github/repo-filter";
import {
  estimateTokens,
  fetchSelectedFiles,
  runPatternSecretsScan,
} from "@/lib/scanner/github-repo-scan";
import { runGithubAiReview } from "@/lib/ai/review-source";
import { checkGithubReviewQuota } from "@/lib/billing/github-review-usage";

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
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const repoFullName = body.repoFullName?.trim();
    if (!repoFullName || !REPO_FULL_NAME_RE.test(repoFullName)) {
      return NextResponse.json(
        { error: "repoFullName is required and must look like 'owner/repo'." },
        { status: 400 },
      );
    }
    const [owner, repo] = repoFullName.split("/");

    const token = await getDecryptedGithubToken(userId);
    if (!token) {
      return NextResponse.json(
        { error: "Connect your GitHub account first." },
        { status: 400 },
      );
    }

    const ref = body.ref?.trim() || (await getRepoDefaultBranch(token, owner, repo));

    const tree = await listRepoTree(token, owner, repo, ref);

    const caps: RepoFilterCaps = {
      maxFiles: await getSetting("GITHUB_REVIEW_MAX_FILES"),
      maxTotalBytes: await getSetting("GITHUB_REVIEW_MAX_TOTAL_BYTES"),
      maxFileBytes: await getSetting("GITHUB_REVIEW_MAX_FILE_BYTES"),
    };
    const { selected, truncatedByCaps } = filterScannableFiles(tree.entries, caps);

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
    const maxTokensPerRun = await getSetting("GITHUB_REVIEW_MAX_TOKENS_PER_RUN");
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

    const startTime = Date.now();

    const files = await fetchSelectedFiles(token, owner, repo, selected);
    const secretFindings = runPatternSecretsScan(files);

    const aiResult = await runGithubAiReview(files, userId, quota.usingOwnAi);

    const findings: Vulnerability[] = [...secretFindings, ...aiResult.findings];

    const summary = {
      critical: findings.filter((f) => f.severity === SEVERITY_LEVELS.CRITICAL).length,
      high: findings.filter((f) => f.severity === SEVERITY_LEVELS.HIGH).length,
      medium: findings.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM).length,
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
      const insertResult = await pool.query(
        `INSERT INTO scan_history (user_id, url, scan_type, summary, findings, findings_count, duration, scanned_at, source, notes)
         VALUES ($1, $2, 'github', $3, $4, $5, $6, $7, 'web', $8) RETURNING id`,
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
