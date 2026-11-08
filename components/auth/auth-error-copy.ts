import { APP_NAME } from "@/lib/config/client-constants";

/**
 * The sentence behind every `?error=` code /login and /signup can be sent to.
 *
 * The URL only ever selects a sentence here, it never supplies one. These
 * pages used to print `?message=` in their error alert, so a link to the real
 * login page could carry "call this number to restore your account" in the
 * product's own voice, and the second decodeURIComponent on an already decoded
 * value threw on a lone `%`.
 *
 * Maps rather than object literals because the keys are attacker-chosen:
 * `?error=constructor` on a plain object finds a function.
 */
type Copy = string | ((provider: string | null) => string);

const PROVIDER_LABELS = new Map([
  ["google", "Google"],
  ["github", "GitHub"],
  ["discord", "Discord"],
]);

const DISCORD_RETRY =
  "That Discord login could not be verified. Start it again from this page.";
const DISCORD_REJECTED =
  "Discord rejected the connection. If you run this instance, check that DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and the OAuth2 redirect URL match the Discord developer portal.";
const OAUTH_EXPIRED = "That sign-in took too long and expired. Start it again.";
const OAUTH_FAILED = "That sign-in did not go through. Try again.";

const LOGIN_ERRORS = new Map<string, Copy>([
  [
    "discord_not_linked",
    "No account is linked to that Discord login. Create an account with your email first, then connect Discord from your profile.",
  ],
  [
    "discord_denied",
    "Discord login was cancelled. Nothing was shared with us.",
  ],
  [
    "discord_expired",
    "That Discord login took too long and expired. Start it again.",
  ],
  [
    "invalid_token",
    "That link is missing its token, so there is nothing to verify. Sign in and request a new verification email.",
  ],
  [
    "discord_not_configured",
    "Discord sign-in is not set up on this instance yet.",
  ],
  ["discord_invalid_state", DISCORD_RETRY],
  ["discord_invalid", DISCORD_RETRY],
  ["discord_token_failed", DISCORD_REJECTED],
  ["discord_failed", DISCORD_REJECTED],
  ["discord_user_failed", DISCORD_REJECTED],
  // Google/GitHub/Discord sign-up-or-sign-in (app/api/v3/auth/oauth/), separate
  // from the discord_* codes above, which belong to the account-linking flow.
  [
    "oauth_email_in_use",
    // Without a provider this has to hold for every way the callback reaches
    // this code: a password account, an account on another provider, an
    // unverified claim on the address, and a different identity of the same
    // provider.
    (provider) =>
      provider
        ? `An account with this email already exists. Sign in with ${provider} instead.`
        : "An account with this email already exists, and this sign-in cannot open it. Use your password or the provider you signed up with, or contact support if neither works.",
  ],
  [
    "oauth_no_account",
    (provider) =>
      provider
        ? `No ${APP_NAME} account uses this ${provider} account yet. Sign up with ${provider} first.`
        : "No account uses that sign-in yet. Sign up first.",
  ],
  ["oauth_denied", "That sign-in was cancelled. Nothing was shared with us."],
  ["oauth_expired", OAUTH_EXPIRED],
  ["oauth_invalid_state", OAUTH_EXPIRED],
  [
    "oauth_email_unverified",
    "That provider account has no verified email, so we cannot use it to sign in.",
  ],
  [
    "oauth_account_disabled",
    "This account has been suspended. Please contact support.",
  ],
  [
    "oauth_not_configured",
    "That sign-in option is not set up on this instance yet.",
  ],
  ["oauth_token_failed", OAUTH_FAILED],
  ["oauth_user_failed", OAUTH_FAILED],
  ["oauth_failed", OAUTH_FAILED],
  ["oauth_invalid", OAUTH_FAILED],
  [
    "logins_paused",
    "Sign-in is paused on this instance right now. Try again later.",
  ],
  ["session_expired", "Your session expired. Sign in again to continue."],
]);

const SIGNUP_ERRORS = new Map<string, Copy>([
  [
    "oauth_already_exists",
    (provider) =>
      provider
        ? `A ${APP_NAME} account already uses this ${provider} account. Sign in with ${provider} instead.`
        : "You already have an account connected to that sign-in. Sign in instead.",
  ],
  [
    "signups_paused",
    "Sign-ups are paused on this instance right now. Try again later.",
  ],
]);

function resolve(
  errors: Map<string, Copy>,
  code: string,
  provider: string | null,
): string | undefined {
  const copy = errors.get(code);
  if (typeof copy !== "function") return copy;
  return copy((provider && PROVIDER_LABELS.get(provider)) || null);
}

export function loginErrorCopy(
  code: string | null,
  provider: string | null,
): string {
  if (!code) return "";
  // The callbacks can emit a code this list does not know yet. Without a
  // catch-all that renders an empty string, and a failed sign-in looks like a
  // normal login form with nothing wrong.
  return (
    resolve(LOGIN_ERRORS, code, provider) ??
    "Sign-in failed. Try again, or use another method."
  );
}

export function signupErrorCopy(
  code: string | null,
  provider: string | null,
): string {
  if (!code) return "";
  return resolve(SIGNUP_ERRORS, code, provider) ?? "";
}
