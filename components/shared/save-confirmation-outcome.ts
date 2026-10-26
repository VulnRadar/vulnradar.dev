/**
 * What SaveConfirmationModal tells the user when a save did not go through.
 *
 * Its `onConfirm` can fail two ways: resolve with `{ ok: false, error? }` (a
 * fetch wrapper that reports the server's refusal rather than rejecting) or
 * throw. Both used to end in the modal quietly going back to its form, with
 * the reason sitting in the page's own banner underneath the scrim. These two
 * functions are the single place that turns either shape into one sentence.
 */
export const SAVE_FAILED_MESSAGE = "Your changes were not saved. Try again.";

export type SaveOutcome = { ok: boolean; error?: string } | void;

/** The message for a resolved outcome, or null when the save went through. */
export function saveFailureMessage(outcome: SaveOutcome): string | null {
  if (!outcome || outcome.ok !== false) return null;
  return outcome.error?.trim() || SAVE_FAILED_MESSAGE;
}

/** The message for a rejected `onConfirm`. */
export function saveThrownMessage(err: unknown): string {
  return err instanceof Error && err.message.trim()
    ? err.message
    : SAVE_FAILED_MESSAGE;
}
