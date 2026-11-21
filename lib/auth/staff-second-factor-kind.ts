/**
 * The vocabulary of the staff second factor (lib/auth/staff-step-up.ts), in a
 * file with nothing server-only in it, so the dialogs in front of an update
 * or an impersonation (components/admin/shared/staff-second-factor-dialog.tsx)
 * name the same factors and say the same refusals the server sends.
 */

/** The code a refusal carries, so a client can tell it from a password refusal. */
export const SECOND_FACTOR_REQUIRED = "SECOND_FACTOR_REQUIRED";

/**
 * What the account has to show: `none` it has no two-factor at all, `totp`
 * an authenticator code, `email` the mailed step-up, `authenticator` it has
 * to add an authenticator app first, because email codes cannot be the
 * second factor for it.
 */
export type SecondFactorKind = "none" | "totp" | "email" | "authenticator";

export function isSecondFactorKind(value: unknown): value is SecondFactorKind {
  return (
    value === "none" ||
    value === "totp" ||
    value === "email" ||
    value === "authenticator"
  );
}

export const SECOND_FACTOR_MESSAGES = {
  none: "Turn on two-step sign-in under Profile > Security to apply updates or impersonate.",
  authenticator:
    "Add an authenticator app to apply updates or impersonate from an account without a password.",
  noMail:
    "This server cannot send email, so an email code cannot confirm this. Add an authenticator app under Profile > Security to apply updates or impersonate.",
  totpMissing:
    "Enter the 6-digit code from your authenticator app. Backup codes are not accepted here.",
  totpWrong:
    "That code from your authenticator app did not match. Backup codes are not accepted here.",
  totpReplayed: "Code already used. Wait for the next 30-second window.",
  totpBroken:
    "Your authenticator setup cannot be read. Turn two-step sign-in off and on again under Profile > Security.",
  emailMissing: "Confirm with a code from your email first.",
} as const;
