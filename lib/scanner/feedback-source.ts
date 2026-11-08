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
 * The note is the only thing that tells the two apart today, and it is reliable
 * in both directions: the verifier inserts with ON CONFLICT DO NOTHING, so it
 * never lands on a row a person already decided, and POST /scan/feedback
 * overwrites `notes` on conflict, so a person clicking a verdict the AI filled
 * in makes the row theirs.
 */

/** The exact `notes` value the AI verifier writes on the rows it creates. */
export const AI_FEEDBACK_NOTE = "Set automatically from an AI verify verdict.";

export function isAiFeedbackNote(notes: string | null | undefined): boolean {
  return notes === AI_FEEDBACK_NOTE;
}

/**
 * Appended to a query on scan_finding_feedback so only rows a person wrote
 * match. COALESCE because `notes` is optional on a human verdict, and a bare
 * `notes <> '...'` is NULL for exactly those rows, which would drop every
 * human verdict that came without a comment.
 */
export const HUMAN_FEEDBACK_SQL = `COALESCE(notes, '') <> '${AI_FEEDBACK_NOTE}'`;
