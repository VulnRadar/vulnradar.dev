import type { ScanResult } from "@/lib/scanner/types";
import { pluralize } from "@/lib/ui/plural";
import type { AiReviewCoverage, GithubScanOutcome } from "./types";

/**
 * POST /api/v3/scan/github's body as the /repos page keeps it: the ScanResult
 * on its own and the GitHub extras beside it, every extra defaulted so a
 * response from an older server still renders.
 */
export function parseGithubScanResponse(
  data: Record<string, unknown>,
): GithubScanOutcome {
  const {
    scanHistoryId,
    ref,
    filesScanned,
    filesSkippedByCaps,
    aiTokensUsed,
    aiReviewSkipped,
    aiReviewStoppedAtBudget,
    aiReviewStoppedAtRunCap,
    aiReviewCoverage,
    aiReviewAllowanceMessage,
    ...result
  } = data;
  return {
    result: result as unknown as ScanResult,
    scanHistoryId: typeof scanHistoryId === "number" ? scanHistoryId : null,
    ref: typeof ref === "string" ? ref : "",
    filesScanned: Number(filesScanned) || 0,
    filesSkippedByCaps: Number(filesSkippedByCaps) || 0,
    aiTokensUsed: Number(aiTokensUsed) || 0,
    aiReviewSkipped: aiReviewSkipped === true,
    aiReviewStoppedAtBudget: aiReviewStoppedAtBudget === true,
    aiReviewStoppedAtRunCap: aiReviewStoppedAtRunCap === true,
    aiReviewCoverage: parseCoverage(aiReviewCoverage),
    aiReviewAllowanceMessage:
      typeof aiReviewAllowanceMessage === "string" && aiReviewAllowanceMessage
        ? aiReviewAllowanceMessage
        : null,
  };
}

function parseCoverage(raw: unknown): AiReviewCoverage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  const filesReviewed = n(c.filesReviewed);
  const filesTotal = n(c.filesTotal);
  if (filesReviewed === null || filesTotal === null) return null;
  return {
    filesReviewed,
    filesTotal,
    batchesReviewed: n(c.batchesReviewed) ?? 0,
    batchesFailed: n(c.batchesFailed),
    batchesTotal: n(c.batchesTotal) ?? 0,
    filesSkippedOverRunCap: Array.isArray(c.filesSkippedOverRunCap)
      ? c.filesSkippedOverRunCap.filter(
          (p): p is string => typeof p === "string",
        )
      : [],
  };
}

/**
 * The notice for a repo scan reopened from history. GET /api/v3/history/[id]
 * spreads scan_history.result_meta over the row, and the scan route stores
 * the same coverage keys there that its response carries, so the one parser
 * reads both and a reopened scan says what the live result said. A scan
 * stored before coverage was kept carries none of the keys and gets no
 * notice, which is what it got before.
 */
export function historyAiReviewNotice(
  data: Record<string, unknown>,
): AiReviewNotice | null {
  return aiReviewNotice(parseGithubScanResponse(data));
}

export interface AiReviewNotice {
  /** skipped: no AI endpoint. not_run: a limit stopped it before the first
   *  batch. failed: no batch was answered and at least one call failed.
   *  partial: some files covered. */
  kind: "skipped" | "not_run" | "failed" | "partial";
  title: string;
  paragraphs: string[];
  /** Files the AI review covered, or null when the server did not say. */
  filesReviewed: number | null;
}

/** How many skipped paths the notice names before it counts the rest. */
const NAMED_SKIPPED_FILES = 3;

function skippedOverCapClause(paths: string[]): string {
  if (paths.length === 1) {
    return `The file ${paths[0]} is larger than this server's per-run AI review limit on its own and was skipped`;
  }
  const named = paths.slice(0, NAMED_SKIPPED_FILES);
  const rest = paths.length - named.length;
  const list =
    rest > 0
      ? `${named.join(", ")} and ${rest} more`
      : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `${pluralize(paths.length, "file")} are each larger than this server's per-run AI review limit on their own and were skipped (${list})`;
}

/**
 * What the result has to say about the AI review whenever it did not cover
 * the whole repo: it did not run, it skipped files over the server's per-run
 * limit, it stopped at the account's allowance or that limit, or the provider
 * failed on part of it. Null when it covered every file. A repo review that
 * is partly AI-reviewed must never read as a complete one, and the pattern
 * scan, which always covers every file, is said to have done so.
 *
 * Each cause is said in the order the run met it, so a first batch whose call
 * failed before a limit stopped the run reads as a failure and then a stop.
 * It used to read as "the first batch is over the limit", about a batch that
 * had been sent.
 */
export function aiReviewNotice(
  outcome: GithubScanOutcome,
): AiReviewNotice | null {
  const coverage = outcome.aiReviewCoverage;
  const total = coverage?.filesTotal ?? outcome.filesScanned;
  const reviewed = coverage?.filesReviewed ?? null;
  const skippedFiles = coverage?.filesSkippedOverRunCap ?? [];
  const incomplete = reviewed !== null && reviewed < total;
  if (
    !outcome.aiReviewSkipped &&
    !outcome.aiReviewStoppedAtBudget &&
    !outcome.aiReviewStoppedAtRunCap &&
    !incomplete &&
    skippedFiles.length === 0
  ) {
    return null;
  }

  const patternLine =
    outcome.filesScanned === 1
      ? "The pattern-based secret scan still checked the one file."
      : `The pattern-based secret scan still checked all ${outcome.filesScanned} files.`;

  if (outcome.aiReviewSkipped) {
    return {
      kind: "skipped",
      title: "AI review did not run",
      paragraphs: [
        "No AI provider is configured, yours or this server's, so no file got an AI review.",
        patternLine,
      ],
      filesReviewed: 0,
    };
  }

  // Null from a server, or a stored scan, that predates the count. Then a
  // shortfall with no stop and nothing skipped can only have been failures,
  // which is how it was told before the count existed.
  const failedBatches = coverage?.batchesFailed ?? null;
  const anySent =
    coverage && failedBatches !== null
      ? coverage.batchesReviewed + failedBatches > 0
      : reviewed !== 0;
  const stop = outcome.aiReviewStoppedAtRunCap
    ? "run_cap"
    : outcome.aiReviewStoppedAtBudget
      ? "budget"
      : null;
  const inferredFailure =
    failedBatches === null && stop === null && skippedFiles.length === 0;
  const failed =
    (failedBatches !== null && failedBatches > 0) || inferredFailure;

  const clauses: string[] = [];
  if (skippedFiles.length > 0) {
    clauses.push(skippedOverCapClause(skippedFiles));
  }
  if (failed) {
    clauses.push(
      reviewed === 0 && stop === null
        ? "the AI provider returned an error or timed out on every batch"
        : failedBatches === null
          ? "the AI provider returned an error or timed out on part of the repo"
          : `the AI provider returned an error or timed out on ${pluralize(failedBatches, "batch", "batches")}`,
    );
  }
  if (stop === "run_cap") {
    clauses.push(
      anySent
        ? "the rest of the repo is over this server's per-run AI review limit"
        : skippedFiles.length > 0
          ? "the files left are over this server's per-run AI review limit"
          : "the first batch of files is over this server's per-run AI review limit",
    );
  } else if (stop === "budget") {
    clauses.push(
      anySent
        ? "your GitHub review allowance ran out before the rest of the repo"
        : "your GitHub review allowance did not cover the first batch of files",
    );
  }
  if (clauses.length === 0) {
    clauses.push("the AI review did not reach every file");
  }

  const missed = reviewed === null ? null : total - reviewed;
  const consequence =
    missed === null
      ? "so it did not reach every file"
      : reviewed === 0
        ? "so no file got an AI review"
        : `so ${pluralize(missed, "file")} got no AI review`;
  const joined =
    clauses.length > 1
      ? `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`
      : clauses[0];
  const cause = `${joined.charAt(0).toUpperCase()}${joined.slice(1)}, ${consequence}.`;

  if (reviewed === 0) {
    return {
      kind: failed ? "failed" : "not_run",
      title: failed ? "AI review failed" : "AI review did not run",
      paragraphs: [
        cause,
        patternLine,
        ...(stop === "budget" && !anySent && outcome.aiReviewAllowanceMessage
          ? [outcome.aiReviewAllowanceMessage]
          : []),
      ],
      filesReviewed: 0,
    };
  }

  return {
    kind: "partial",
    title:
      reviewed === null
        ? "AI review stopped early"
        : `AI review covered ${reviewed} of ${pluralize(total, "file")}`,
    paragraphs: [
      `${cause} Treat the AI findings as a partial review.`,
      patternLine,
    ],
    filesReviewed: reviewed,
  };
}

/** The "AI review" stat: tokens for a whole review, coverage otherwise. */
export function aiReviewStatValue(
  outcome: GithubScanOutcome,
  notice: AiReviewNotice | null,
): string {
  if (!notice) return `${outcome.aiTokensUsed.toLocaleString()} tokens`;
  if (notice.kind === "skipped") return "Skipped";
  if (notice.kind === "not_run") return "Not run";
  if (notice.kind === "failed") return "Failed";
  if (notice.filesReviewed === null) return "Partial";
  const total = outcome.aiReviewCoverage?.filesTotal ?? outcome.filesScanned;
  return `${notice.filesReviewed} of ${pluralize(total, "file")}`;
}
