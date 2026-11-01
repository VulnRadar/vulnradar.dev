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
    batchesTotal: n(c.batchesTotal) ?? 0,
  };
}

export interface AiReviewNotice {
  /** skipped: no AI endpoint. not_run: a limit stopped it before the first
   *  batch. failed: every batch it sent failed. partial: some files covered. */
  kind: "skipped" | "not_run" | "failed" | "partial";
  title: string;
  paragraphs: string[];
  /** Files the AI review covered, or null when the server did not say. */
  filesReviewed: number | null;
}

/**
 * What the result has to say about the AI review whenever it did not cover
 * the whole repo: it did not run, it stopped at the account's allowance or
 * the server's per-run limit, or the provider failed on part of it. Null when
 * it covered every file. A repo review that is partly AI-reviewed must never
 * read as a complete one, and the pattern scan, which always covers every
 * file, is said to have done so.
 */
export function aiReviewNotice(
  outcome: GithubScanOutcome,
): AiReviewNotice | null {
  const coverage = outcome.aiReviewCoverage;
  const total = coverage?.filesTotal ?? outcome.filesScanned;
  const reviewed = coverage?.filesReviewed ?? null;
  const incomplete = reviewed !== null && reviewed < total;
  if (
    !outcome.aiReviewSkipped &&
    !outcome.aiReviewStoppedAtBudget &&
    !outcome.aiReviewStoppedAtRunCap &&
    !incomplete
  ) {
    return null;
  }

  const patternLine =
    outcome.filesScanned === 1
      ? "The pattern-based secret scan still checked the one file."
      : `The pattern-based secret scan still checked all ${outcome.filesScanned} files.`;
  const none = reviewed === 0 || outcome.aiReviewSkipped;
  const missed = reviewed === null ? null : total - reviewed;
  const partialTitle =
    reviewed === null
      ? "AI review stopped early"
      : `AI review covered ${reviewed} of ${pluralize(total, "file")}`;
  const missedClause =
    missed === null
      ? "so it did not reach every file"
      : `so ${pluralize(missed, "file")} got no AI review`;
  const partialNote = "Treat the AI findings as a partial review.";

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

  if (outcome.aiReviewStoppedAtRunCap) {
    return none
      ? {
          kind: "not_run",
          title: "AI review did not run",
          paragraphs: [
            "The first batch of files is over this server's per-run AI review limit, so no file got an AI review.",
            patternLine,
          ],
          filesReviewed: 0,
        }
      : {
          kind: "partial",
          title: partialTitle,
          paragraphs: [
            `The rest of the repo is over this server's per-run AI review limit, ${missedClause}. ${partialNote}`,
            patternLine,
          ],
          filesReviewed: reviewed,
        };
  }

  if (outcome.aiReviewStoppedAtBudget) {
    return none
      ? {
          kind: "not_run",
          title: "AI review did not run",
          paragraphs: [
            "Your GitHub review allowance did not cover the first batch of files, so no file got an AI review.",
            patternLine,
            ...(outcome.aiReviewAllowanceMessage
              ? [outcome.aiReviewAllowanceMessage]
              : []),
          ],
          filesReviewed: 0,
        }
      : {
          kind: "partial",
          title: partialTitle,
          paragraphs: [
            `Your GitHub review allowance ran out partway, ${missedClause}. ${partialNote}`,
            patternLine,
          ],
          filesReviewed: reviewed,
        };
  }

  return none
    ? {
        kind: "failed",
        title: "AI review failed",
        paragraphs: [
          "The AI provider returned an error or timed out on every batch, so no file got an AI review.",
          patternLine,
        ],
        filesReviewed: 0,
      }
    : {
        kind: "partial",
        title: partialTitle,
        paragraphs: [
          `The AI provider returned an error or timed out on part of the repo, ${missedClause}. ${partialNote}`,
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
