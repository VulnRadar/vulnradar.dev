/**
 * Who wrote a scan_finding_feedback row: the person, or the AI verifier.
 *
 * lib/ai/verify-findings.ts pre-fills "Mark this result" from its own verdict,
 * so a `possible_fp` is stored as `verdict = 'false_positive'` under the user's
 * id, and in the production export that was 3,456 rows out of 3,468. Every
 * place that reads the verdict to hide a finding (the regression alert, the
 * digest, the owner's view and the CI gate built on it) treated those rows as
 * the user's decision, so a model being wrong about a finding silenced a real
 * issue that nobody had looked at. Owner decision T2: AI rows are kept, and
 * they never suppress.
 *
 * The `source` column is the record, and the only one: the verifier writes
 * 'ai', POST /scan/feedback writes 'human' on insert and on the update that
 * makes a row the AI filled in the person's own, and the triage carry-over
 * copies it. There used to be a second definition, the note the verifier
 * writes, which every reader compared against while the column was written by
 * the boot backfill alone, so a person who overrode an AI row was human by
 * note and 'ai' by source. The note is now only text, and the boot backfill
 * reads it once, for the rows the verifier wrote before the column existed
 * (lib/database/boot/backfills.ts).
 */

/**
 * The exact `notes` value the AI verifier writes on the rows it creates. Only
 * the boot backfill reads it, to mark the rows written before `source`.
 */
export const AI_FEEDBACK_NOTE = "Set automatically from an AI verify verdict.";

export type FeedbackSource = "human" | "ai";

export function isAiFeedback(row: { source?: string | null }): boolean {
  return row.source === "ai";
}

/**
 * Appended to a query on scan_finding_feedback so only rows a person wrote
 * match. The column is NOT NULL with a 'human' default, so a bare comparison
 * keeps every human verdict, with or without a comment.
 */
export const HUMAN_FEEDBACK_SQL = "source = 'human'";
