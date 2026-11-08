import { APP_NAME } from "@/lib/config/client-constants";

/**
 * The sentence behind every `?error=` code the Google, GitHub and Discord
 * connect callbacks send to /profile?tab=social. The URL only selects a
 * sentence, it never supplies one, for the reason components/auth/
 * auth-error-copy.ts gives: this is a signed-in page, and a link could carry
 * "call this number to restore your account" in the product's own voice.
 *
 * A Map because the key is chosen by whoever wrote the link: `?error=constructor`
 * on a plain object finds a function.
 */
const IMPERSONATION_BLOCKED =
  "You are signed in as this user from the admin panel. Linking a sign-in provider is not available through an impersonation session. Stop impersonating and use the admin action for it, which asks for your password and is recorded.";

const SOCIAL_ERRORS = new Map([
  ["oauth_impersonation_blocked", IMPERSONATION_BLOCKED],
  ["discord_impersonation_blocked", IMPERSONATION_BLOCKED],
  [
    "oauth_already_linked",
    `That account is already connected to a different ${APP_NAME} account.`,
  ],
  [
    "discord_already_linked",
    `That Discord account is already connected to a different ${APP_NAME} account.`,
  ],
  [
    "oauth_creating_identity",
    "This account was created with that provider, so it can only connect the identity that uses its email address.",
  ],
  [
    "discord_creating_identity",
    "This account was created with Discord, so it can only connect the Discord account that uses its email address.",
  ],
  [
    "oauth_email_unverified",
    "That account has no verified email, so it cannot be connected.",
  ],
  [
    "oauth_session_expired",
    "Your session changed before the provider answered. Sign in again and retry.",
  ],
]);

export function socialErrorCopy(code: string): string {
  return (
    SOCIAL_ERRORS.get(code) ??
    "We could not complete that connection. Try again."
  );
}
