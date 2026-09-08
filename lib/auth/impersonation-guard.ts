import { NextResponse } from "next/server";

/**
 * Refuses the handful of actions an impersonation session must never take.
 *
 * An impersonation session (lib/auth/impersonation.ts) is a real `sessions`
 * row whose `user_id` is the TARGET and whose `impersonated_by` is the staff
 * member. Every route below that point sees an ordinary signed-in user, which
 * is the whole point: staff reproduce what the customer sees. It is not a
 * licence to change who the customer is.
 *
 * Four routes write the account's credentials or destroy it outright and, at
 * the time this was added, none of them wrote an audit row of any kind:
 * `PUT /api/v3/auth/update` (email and password), `2fa/disable`,
 * `2fa/backup-codes` and `DELETE /api/v3/account/delete`. Changing the email
 * redirects every future password reset, which the admin panel itself treats
 * as account takeover in one step and gates behind a password prompt. Through
 * impersonation the same change needed no password, produced no record, and
 * lib/auth/authorization.ts's actor rewrite could not help, because that only
 * corrects rows somebody is already writing.
 *
 * Blocking rather than auditing, deliberately. An audit row makes it
 * traceable afterwards; refusing means it cannot happen. Nothing legitimate is
 * lost: staff who genuinely need to reset a password or clear a second factor
 * have admin actions for exactly that, which are password-gated, rank-checked
 * and logged. Reproducing a customer's bug never requires changing their
 * email.
 *
 * tests/lib/auth/impersonation-guard.test.ts enumerates the routes that write
 * these columns and fails when one appears that neither calls this nor is
 * listed as a deliberate exception, because the failure mode is the next such
 * route rather than these four.
 */
export function refuseWhileImpersonating(
  /** Structural rather than a named session type: getSession()'s return type
   *  is declared inline and exports no alias to import. */
  session: { impersonatedBy?: number } | null,
  action: string,
): NextResponse | null {
  if (!session?.impersonatedBy) return null;
  return NextResponse.json(
    {
      error: `You are signed in as this user from the admin panel. ${action} is not available through an impersonation session. Stop impersonating and use the admin action for it, which asks for your password and is recorded.`,
      impersonationBlocked: true,
    },
    { status: 403 },
  );
}
