/**
 * OAuth sign-up/sign-in provider registry (Google, GitHub, Discord).
 *
 * Each provider follows the same "invisible until configured" shape used
 * elsewhere in this codebase (Turnstile via TURNSTILE_ENABLED, AI via the
 * `configured` field from /api/v3/ai/info): a provider's button only
 * renders once its own client id/secret env vars are set, and the OAuth
 * routes refuse to start a flow for an unconfigured provider. No provider
 * is ever a hard requirement.
 *
 * Discord here is a SEPARATE flow from the existing account-linking
 * integration (lib/discord/discord-utils.ts, app/api/v3/auth/discord/):
 * this one can create a brand new account from a first-time sign-in, the
 * linking flow only ever attaches Discord to an account that already
 * exists. Both reuse the same DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET --
 * one Discord application can register multiple OAuth2 redirect URIs, so
 * a second Discord app is not needed -- but they have their own state
 * signing (lib/auth/oauth-state.ts), their own callback route
 * (app/api/v3/auth/oauth/discord/callback/route.ts), and never share a
 * code path.
 */

export type OAuthProviderId = "google" | "github" | "discord";

export const OAUTH_PROVIDER_IDS: readonly OAuthProviderId[] = [
  "google",
  "github",
  "discord",
];

interface OAuthProviderConfig {
  id: OAuthProviderId;
  label: string;
  clientIdEnv: "GOOGLE_CLIENT_ID" | "GITHUB_CLIENT_ID" | "DISCORD_CLIENT_ID";
  clientSecretEnv:
    "GOOGLE_CLIENT_SECRET" | "GITHUB_CLIENT_SECRET" | "DISCORD_CLIENT_SECRET";
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
}

export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderConfig> = {
  google: {
    id: "google",
    label: "Google",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
  },
  github: {
    id: "github",
    label: "GitHub",
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
  },
  discord: {
    id: "discord",
    label: "Discord",
    clientIdEnv: "DISCORD_CLIENT_ID",
    clientSecretEnv: "DISCORD_CLIENT_SECRET",
    authorizeUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    scope: "identify email",
  },
};

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

export function getOAuthClientId(
  provider: OAuthProviderId,
): string | undefined {
  return process.env[OAUTH_PROVIDERS[provider].clientIdEnv];
}

export function getOAuthClientSecret(
  provider: OAuthProviderId,
): string | undefined {
  return process.env[OAUTH_PROVIDERS[provider].clientSecretEnv];
}

/** True only once BOTH the client id and secret are set for this provider. */
export function isOAuthProviderConfigured(provider: OAuthProviderId): boolean {
  return (
    Boolean(getOAuthClientId(provider)) &&
    Boolean(getOAuthClientSecret(provider))
  );
}

/** Label for an `auth_provider` DB value that isn't a known OAuth provider
 *  (i.e. `null` or `'password'`), used when composing collision messages. */
export function oauthLabelForAuthProvider(
  authProvider: string | null,
): string | null {
  if (!authProvider) return null;
  if (!isOAuthProviderId(authProvider)) return null;
  return OAUTH_PROVIDERS[authProvider].label;
}
