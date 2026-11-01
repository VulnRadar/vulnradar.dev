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
  fetchSelectedFiles,
  runPatternSecretsScan,
} from "@/lib/scanner/github-repo-scan";
import { planGithubReview, runGithubAiReview } from "@/lib/ai/review-source";
import {
  resolveNewScanTeamIds,
  attachNewScanTeams,
} from "@/lib/teams/scan-teams";
import { attachCvssScores } from "@/lib/scanner/cvss";
import {
  checkGithubReviewQuota,
  releaseFreeGithubReviewTrial,
  reserveGithubReviewTokens,
  settleGithubReviewTokens,
  type GithubReviewReservation,
} from "@/lib/billing/github-review-usage";
import {
  checkRateLimit as checkGlobalRateLimit,
  RATE_LIMITS,
} from "@/lib/rate-limiting/rate-limit";
import { scanningPausedResponse } from "@/lib/admin/service-state";
import { notifyScanComplete } from "@/lib/webhooks/scan-notifications";

const REPO_FULL_NAME_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

// POST /api/v3/scan/github — run a security review against a connected
// GitHub repo's source instead of a live URL. Session-only (no API key
// path yet — this is a new, separate scanning mode from the URL scanner).
export async function POST(request: Request) {
  try {
    // PAUSE_SCANNING (and MAINTENANCE_MODE, which implies it). This pipeline
    // never touches lib/scanner/execute-scan.ts, so it needs its own gate:
    // pausing only the URL scanner would leave repository scans running while
    // the admin panel reported scanning as paused.
    const paused = await scanningPausedResponse();
    if (paused) return paused;

    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.userId;

    let body: { repoFullName?: string; ref?: string; teamId?: number | null };
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

    // Optional team assignment, same contract as the URL scan routes.
    // Omitted means a personal scan: nothing here is shared with a team
    // unless the request explicitly named ones the caller can manage.
    const teamAssignment = await resolveNewScanTeamIds(userId, body);
    if (!teamAssignment.ok) {
      return NextResponse.json(
        { error: teamAssignment.error },
        { status: 400 },
      );
    }

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
    //
    // Only a plan with no GitHub review of its own is refused here: the free
    // plan once its trial is used and no credits are left, where the scan is
    // the trial. A plan whose window is used up still gets the pattern scan,
    // the same answer as an account with one token left, and the response
    // says why the AI review did not run. It used to get a 403 with no scan
    // at all, the one case left where the AI allowance decided whether the
    // pattern scan ran.
    const preQuota = await checkGithubReviewQuota(userId);
    if (!preQuota.allowed && preQuota.limitTokens === 0) {
      return NextResponse.json({ error: preQuota.message }, { status: 403 });
    }
    const allowanceSpent = preQuota.allowed
      ? null
      : (preQuota.message ?? "Your GitHub review allowance is used up.");

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

    // Planned from tree metadata (byte sizes), before fetching a single byte
    // of content or spending an AI call: the batches that fit under
    // GITHUB_REVIEW_MAX_TOKENS_PER_RUN and what they can cost at worst.
    //
    // A repo past the per-run ceiling used to be refused here with a 413, and
    // a repo past what the account had left was refused at the reservation
    // with a 403, pattern scan included both times. Neither limit is about the
    // pattern scan, which is cheap and deterministic, so it now covers every
    // selected file whatever the AI allowance, and the AI review covers what
    // the two limits admit and says where it stopped.
    const plan = await planGithubReview(selected.map((e) => e.size ?? 0));

    // The reservation takes the plan's estimate out of the window and the
    // credit balance (or claims the free trial, atomically) before any content
    // is fetched or any AI call made, needing only the first batch's worst
    // case. The run is held to whatever it got and the finally below settles
    // it with the real count. When not even the first batch fits under the
    // ceiling there is nothing to reserve.
    let reservation: GithubReviewReservation | null = null;
    let allowanceMessage: string | null = allowanceSpent;
    if (plan.batchesWithinCap > 0 && allowanceSpent === null) {
      const gate = await reserveGithubReviewTokens(
        userId,
        plan.estimate,
        plan.firstBatch,
      );
      if (gate.allowed) {
        reservation = gate.reservation;
      } else if (gate.busy) {
        return NextResponse.json({ error: gate.message }, { status: 429 });
      } else {
        allowanceMessage = gate.message;
      }
    }

    const startTime = Date.now();

    let files: Awaited<ReturnType<typeof fetchSelectedFiles>>;
    let secretFindings: ReturnType<typeof runPatternSecretsScan>;
    let aiResult: Awaited<ReturnType<typeof runGithubAiReview>>;
    let tokensSpent = 0;
    try {
      files = await fetchSelectedFiles(token, owner, repo, selected);
      secretFindings = runPatternSecretsScan(files);
      // No reservation means a budget of zero, not null: null is "nothing
      // caps this run" and would send every batch the ceiling admits.
      aiResult = await runGithubAiReview(
        files,
        userId,
        repoInfo.private,
        reservation ? reservation.budget : 0,
      );
      tokensSpent = aiResult.totalTokensUsed;
    } catch (err) {
      // Give the claimed slot back: a review that didn't complete must
      // not cost the user their one daily free trial. The claim has to
      // happen before the run to close the race; this release is what
      // keeps the net effect the same as recording strictly after success.
      if (reservation?.isFreeTrial) {
        await releaseFreeGithubReviewTrial(userId).catch(() => {});
      }
      throw err;
    } finally {
      if (reservation) {
        try {
          await settleGithubReviewTokens(reservation, tokensSpent);
        } catch (err) {
          console.error(
            `[${APP_NAME}] Failed to settle GitHub review tokens (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    // A free-trial slot must also be returned when the review produced nothing
    // WITHOUT throwing: no server AI endpoint configured, the run exceeded the
    // per-run token ceiling, or zero tokens were actually spent. Otherwise the
    // user burns their one free review for an empty result.
    if (
      reservation?.isFreeTrial &&
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
        `INSERT INTO scan_history (user_id, url, scan_type, summary, findings, findings_count, duration, scanned_at, source, notes, is_public, team_id)
         VALUES ($1, $2, 'github', $3, $4, $5, $6, $7, 'web', $8, FALSE, $9) RETURNING id`,
        [
          userId,
          repoFullName,
          JSON.stringify(summary),
          JSON.stringify(findings),
          summary.total,
          duration,
          result.scannedAt,
          DEFAULT_SCAN_NOTE,
          teamAssignment.primaryTeamId,
        ],
      );
      scanHistoryId = insertResult.rows[0]?.id ?? null;
      // The INSERT above carries the primary team; this writes the rest of
      // the set into scan_history_teams and is a no-op below two teams.
      if (scanHistoryId !== null) {
        await attachNewScanTeams(scanHistoryId, teamAssignment.teamIds);
      }
    } catch (err) {
      console.error(
        `[${APP_NAME}] Failed to save GitHub repo scan history:`,
        err instanceof Error ? err.message : err,
      );
    }

    // The shared notification tail (lib/webhooks/scan-notifications.ts).
    // A repo scan fired nothing at all before this. It reports a
    // `repository` target rather than a `url` one: "owner/repo" is not a URL
    // and the payload builder must not present it as one, so the generic
    // webhook body carries `repository` and no `url` key for this path.
    //
    // No `incomplete` list: this pipeline has no timed-out-branch concept to
    // report. A file it could not fetch or decode is skipped by
    // fetchSelectedFiles and surfaces as filesScanned being lower than what
    // was selected, and an AI review that did not run or stopped early
    // surfaces as aiReviewSkipped, aiReviewStoppedAtBudget,
    // aiReviewStoppedAtRunCap and aiReviewCoverage. Both are in the response,
    // neither is an ScanResult.incomplete area, so inventing one here would be
    // a claim the scan cannot back.
    if (scanHistoryId !== null) {
      void notifyScanComplete({
        userId,
        scanId: scanHistoryId,
        target: { kind: "repository", value: repoFullName },
        summary,
        findings,
        duration,
        scannedAt: result.scannedAt,
      });
    }

    // The plan works from tree sizes and the run from the content it built,
    // so when the plan found no batch under the ceiling but the content turned
    // out smaller, the zero budget is what stopped the run. The reason is
    // still the ceiling: more allowance would not have changed it.
    const ceilingBlocked = plan.batchesWithinCap === 0;
    const stoppedAtRunCap =
      aiResult.stoppedAtRunCap || (ceilingBlocked && aiResult.stoppedAtBudget);

    return NextResponse.json({
      ...result,
      scanHistoryId,
      ref,
      filesScanned: files.length,
      filesSkippedByCaps: truncatedByCaps,
      aiTokensUsed: aiResult.totalTokensUsed,
      aiReviewSkipped: aiResult.noEndpoint,
      // True when the account's allowance and credits ran out before every
      // file was reviewed, including before the first one; the AI findings
      // cover the files before that point and the pattern scan covers all.
      aiReviewStoppedAtBudget: aiResult.stoppedAtBudget && !ceilingBlocked,
      // True when GITHUB_REVIEW_MAX_TOKENS_PER_RUN stopped it instead.
      aiReviewStoppedAtRunCap: stoppedAtRunCap,
      aiReviewCoverage: {
        filesReviewed: aiResult.filesReviewed,
        filesTotal: aiResult.filesTotal,
        batchesReviewed: aiResult.batchesReviewed,
        batchesTotal: aiResult.batchesTotal,
      },
      // Why the account could not cover even the first batch, and what would.
      aiReviewAllowanceMessage: allowanceMessage,
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
