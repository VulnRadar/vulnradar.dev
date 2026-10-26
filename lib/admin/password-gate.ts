import { PASSWORD_GATED_ACTIONS } from "@/components/admin/config";

/**
 * Whether an admin action needs the calling admin's own password.
 *
 * PASSWORD_GATED_ACTIONS is the set the route and the panel share, so the
 * re-auth prompt and the server check cannot drift. Both credit actions are in
 * it: granting adds real, non-expiring spendable value, and removing can zero a
 * customer's paid balance, so neither is allowed to a hijacked session alone.
 *
 * Both halves ask this one function: the route enforces it and the panel uses
 * it to decide when to show the password dialog. No server imports, because the
 * panel is a client component.
 */
export function isPasswordGatedAction(action: string): boolean {
  return PASSWORD_GATED_ACTIONS.has(action);
}
