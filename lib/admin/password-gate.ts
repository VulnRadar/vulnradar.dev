import { PASSWORD_GATED_ACTIONS } from "@/components/admin/config";

/**
 * Every PATCH action that changes a purchased credit balance. Both need the
 * calling admin's own password: granting adds real, non-expiring spendable
 * value, and removing is just as capable of damage (zeroing a customer's paid
 * balance), so neither is allowed to a hijacked session on its own.
 */
const CREDIT_BALANCE_ACTIONS: ReadonlySet<string> = new Set([
  "grant_credits",
  "adjust_credits",
]);

/**
 * Whether an admin action needs the calling admin's own password.
 *
 * PASSWORD_GATED_ACTIONS is the set the route and the panel have always shared,
 * so the re-auth prompt and the server check cannot drift. Every action that
 * moves a credit balance is gated as well, whichever way it moves it.
 *
 * Both halves ask this one function: the route enforces it and the panel uses
 * it to decide when to show the password dialog. No server imports, because the
 * panel is a client component.
 */
export function isPasswordGatedAction(action: string): boolean {
  return (
    PASSWORD_GATED_ACTIONS.has(action) || CREDIT_BALANCE_ACTIONS.has(action)
  );
}
