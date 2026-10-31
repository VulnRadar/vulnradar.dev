import {
  OAUTH_PROVIDERS,
  getOAuthClientId,
  getOAuthClientSecret,
  type OAuthProviderId,
} from "@/lib/auth/oauth-providers";
import { APP_NAME } from "@/lib/config/constants";
import { logError } from "@/lib/logging/log";

/**
 * Authorization-code exchange and normalized userinfo lookup for each OAuth
 * sign-up/sign-in provider. Kept in one module (rather than one per
 * provider) because the shape callers need back is identical -- an access
 * token, then a verified email -- only the wire format differs.
 *
 * Every failure here returns null, and the callback turns null into a bare
 * redirect to /login?error=..., so this module is the only place the reason
 * can be recorded. A rotated client secret, a redirect URI that no longer
 * matches and a provider outage all reach the user as the same "did not go
 * through" and used to leave nothing in any log. See failure() below for
 * exactly what is, and is never, written down.
 */

export interface OAuthTokenResult {
  accessToken: string;
}

export interface OAuthUserInfo {
  // The provider's own stable account identifier (Google's `sub`, GitHub's
  // numeric user id, Discord's snowflake) -- NOT the email, which can
  // change or be reused. The sign-up/sign-in callback matches accounts by
  // email and never reads this field, but the account-linking flow
  // (app/api/v3/auth/oauth/[provider]/route.ts's ?action=link) has to key
  // users.google_id/github_id off something that can't be spoofed by
  // changing an email address. Null only if the provider's response
  // omitted the field entirely.
  id: string | null;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  // GitHub's @handle (the `login`), kept SEPARATE from `name` (which stays
  // the display name, falling back to the login only when no display name is
  // set). Unlike the display name, the login is the account's real
  // github.com/<login> URL. Populated only for the github provider; absent
  // (undefined) for Google and Discord, which have no equivalent handle.
  login?: string | null;
}

// GitHub's API rejects requests with no User-Agent header.
const USER_AGENT = `${APP_NAME}-OAuth`;

// Every call in this module sits between a person who just clicked "Sign in
// with X" and a redirect, so a provider that accepts the connection and then
// says nothing would hold that request open until the platform gave up. The
// signal also covers reading the body, which is where a stalled provider
// usually stalls.
const PROVIDER_TIMEOUT_MS = 10_000;

type OAuthStage = "token" | "userinfo" | "emails";

/**
 * RFC 6749 error codes are short ASCII tokens (invalid_grant, invalid_client,
 * redirect_uri_mismatch), and GitHub's are the same shape
 * (incorrect_client_credentials, bad_verification_code). Anything else in an
 * `error` field is not a code, and it is the field a provider might fill with
 * prose that quotes what we sent, so it is dropped rather than logged.
 */
const PROVIDER_ERROR_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

function errorCodeOf(value: unknown): string | undefined {
  return typeof value === "string" && PROVIDER_ERROR_CODE.test(value)
    ? value
    : undefined;
}

/** The `error` code from a failed response's JSON body, if it has one. */
async function providerErrorCode(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json();
    return errorCodeOf((body as { error?: unknown } | null)?.error);
  } catch {
    return undefined;
  }
}

/**
 * Record why a sign-in step failed. The context is deliberately only the
 * provider, the stage, the HTTP status and the provider's own error code:
 * enough to tell invalid_client (a bad secret) from redirect_uri_mismatch from
 * an outage at a glance. Never the response body or error_description (which
 * can quote the authorization code), the code, the redirect URI, an access
 * token or anything about the person signing in.
 */
function failure(
  provider: OAuthProviderId,
  stage: OAuthStage,
  message: string,
  detail: { status?: number; providerError?: string; timedOut?: boolean } = {},
): void {
  logError("oauth", message, undefined, { provider, stage, ...detail });
}

/**
 * fetch with the module-wide timeout. Returns null after logging when the
 * request could not be completed (network error, DNS failure or the timeout),
 * so every caller has one failure shape to handle. The log message is
 * "<stage> request failed" and the Error is passed through for its stack; a
 * timeout is marked so it can be told from a refused connection.
 */
async function providerFetch(
  provider: OAuthProviderId,
  stage: OAuthStage,
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (err) {
    logError("oauth", `${stage} request failed`, err, {
      provider,
      stage,
      timedOut: isTimeout(err) ? true : undefined,
    });
    return null;
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

/**
 * res.json() that cannot throw. A provider error page served with a 200, a
 * truncated body or a stalled stream used to surface as an unhandled
 * rejection out of the callback route instead of the "did not go through"
 * redirect every other failure here ends in. Resolves undefined (which JSON
 * itself can never produce) after logging.
 */
async function readJson(
  provider: OAuthProviderId,
  stage: OAuthStage,
  res: Response,
): Promise<unknown> {
  try {
    return await res.json();
  } catch (err) {
    failure(provider, stage, `${stage} response was not JSON`, {
      status: res.status,
      timedOut: isTimeout(err) ? true : undefined,
    });
    return undefined;
  }
}

/** readJson for the endpoints whose body must be an object. */
async function readJsonObject(
  provider: OAuthProviderId,
  stage: OAuthStage,
  res: Response,
): Promise<Record<string, unknown> | null> {
  const body = await readJson(provider, stage, res);
  if (body === undefined) return null;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    failure(provider, stage, `${stage} response was not a JSON object`, {
      status: res.status,
    });
    return null;
  }
  return body as Record<string, unknown>;
}

async function userinfoRejected(
  provider: OAuthProviderId,
  res: Response,
): Promise<void> {
  failure(provider, "userinfo", "userinfo endpoint returned an error status", {
    status: res.status,
    providerError: await providerErrorCode(res),
  });
}

/**
 * A 200 whose body has no email. Either the OAuth app was registered without
 * the email scope, which is a self-hosting setup mistake that breaks every
 * sign-in, or this one account has no email to share.
 */
function noEmail(provider: OAuthProviderId, res: Response): void {
  failure(provider, "userinfo", "userinfo response has no email", {
    status: res.status,
  });
}

export async function exchangeOAuthCode(
  provider: OAuthProviderId,
  code: string,
  redirectUri: string,
): Promise<OAuthTokenResult | null> {
  const clientId = getOAuthClientId(provider);
  const clientSecret = getOAuthClientSecret(provider);
  if (!clientId || !clientSecret) {
    failure(provider, "token", "client credentials are not configured");
    return null;
  }

  const providerConfig = OAUTH_PROVIDERS[provider];
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // GitHub's token endpoint defaults to a form-encoded response body unless
  // asked for JSON.
  if (provider === "github") headers.Accept = "application/json";

  const res = await providerFetch(provider, "token", providerConfig.tokenUrl, {
    method: "POST",
    headers,
    body,
  });
  if (!res) return null;
  if (!res.ok) {
    failure(provider, "token", "token endpoint returned an error status", {
      status: res.status,
      providerError: await providerErrorCode(res),
    });
    return null;
  }

  const data = await readJsonObject(provider, "token", res);
  if (!data) return null;

  // GitHub returns HTTP 200 with an `error` field in the body instead of a
  // non-2xx status when the code/secret is wrong -- res.ok alone would miss
  // that.
  if (data.error || typeof data.access_token !== "string") {
    failure(provider, "token", "token response carried no access token", {
      status: res.status,
      providerError: errorCodeOf(data.error),
    });
    return null;
  }
  return { accessToken: data.access_token };
}

export async function fetchOAuthUserInfo(
  provider: OAuthProviderId,
  accessToken: string,
): Promise<OAuthUserInfo | null> {
  switch (provider) {
    case "google":
      return fetchGoogleUserInfo(accessToken);
    case "github":
      return fetchGithubUserInfo(accessToken);
    case "discord":
      return fetchDiscordUserInfo(accessToken);
  }
}

async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<OAuthUserInfo | null> {
  const res = await providerFetch(
    "google",
    "userinfo",
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res) return null;
  if (!res.ok) {
    await userinfoRejected("google", res);
    return null;
  }

  const data = await readJsonObject("google", "userinfo", res);
  if (!data) return null;
  if (typeof data.email !== "string") {
    noEmail("google", res);
    return null;
  }

  return {
    id: typeof data.sub === "string" ? data.sub : null,
    email: data.email,
    emailVerified:
      data.email_verified === true || data.email_verified === "true",
    name: typeof data.name === "string" ? data.name : null,
    avatarUrl: typeof data.picture === "string" ? data.picture : null,
  };
}

async function fetchGithubUserInfo(
  accessToken: string,
): Promise<OAuthUserInfo | null> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
  };

  const userRes = await providerFetch(
    "github",
    "userinfo",
    "https://api.github.com/user",
    { headers },
  );
  if (!userRes) return null;
  if (!userRes.ok) {
    await userinfoRejected("github", userRes);
    return null;
  }
  const user = await readJsonObject("github", "userinfo", userRes);
  if (!user) return null;

  // GitHub's /user.email is only populated when the user made their email
  // public; it also doesn't say whether the address is verified. /user/emails
  // (needs the user:email scope, which this flow always requests) is the
  // only reliable source of a verified email.
  let email: string | null = typeof user.email === "string" ? user.email : null;
  let emailVerified = false;

  // A failure from here down is not a null return: the sign-in carries on
  // with whatever /user gave, unverified, and is refused further along.
  const emailsRes = await providerFetch(
    "github",
    "emails",
    "https://api.github.com/user/emails",
    { headers },
  );
  if (emailsRes?.ok) {
    const body = await readJson("github", "emails", emailsRes);
    if (Array.isArray(body)) {
      const emails = body.filter(isGithubEmailEntry);
      const primaryVerified = emails.find(
        (e) => e.primary === true && e.verified === true,
      );
      if (primaryVerified) {
        email = primaryVerified.email;
        emailVerified = true;
      } else if (email) {
        emailVerified =
          emails.find((e) => e.email === email)?.verified === true;
      }
    } else if (body !== undefined) {
      failure("github", "emails", "emails response was not a JSON array", {
        status: emailsRes.status,
      });
    }
  } else if (emailsRes) {
    // Without the user:email scope this 404s, the sign-in carries on with an
    // unverified address, and the user is turned away as "email unverified"
    // with no trace of why.
    failure("github", "emails", "emails endpoint rejected the request", {
      status: emailsRes.status,
      providerError: await providerErrorCode(emailsRes),
    });
  }

  return {
    id:
      typeof user.id === "number" || typeof user.id === "string"
        ? String(user.id)
        : null,
    email,
    emailVerified,
    name:
      typeof user.name === "string"
        ? user.name
        : typeof user.login === "string"
          ? user.login
          : null,
    // The @handle itself, unconditionally -- not the display-name fallback
    // above. This is what forms a real github.com/<login> URL.
    login: typeof user.login === "string" ? user.login : null,
    // ?s=128 for the same reason as the Discord branch below: with
    // images.unoptimized on, githubusercontent's default-resolution avatar is
    // downloaded whole to fill a 14px circle. GitHub already carries a query
    // string on these URLs (?v=4), so append rather than assume.
    avatarUrl:
      typeof user.avatar_url === "string"
        ? withAvatarSize(user.avatar_url, "s", 128)
        : null,
  };
}

interface GithubEmailEntry {
  email: string;
  primary: boolean;
  verified: boolean;
}

function isGithubEmailEntry(value: unknown): value is GithubEmailEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { email?: unknown }).email === "string"
  );
}

/** Append a provider size cap to an avatar URL without clobbering whatever
 *  query string it already carries, and without failing the whole sign-in if
 *  the provider ever hands back something URL() cannot parse. */
function withAvatarSize(url: string, param: string, size: number): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has(param)) {
      parsed.searchParams.set(param, String(size));
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

async function fetchDiscordUserInfo(
  accessToken: string,
): Promise<OAuthUserInfo | null> {
  const res = await providerFetch(
    "discord",
    "userinfo",
    "https://discord.com/api/users/@me",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res) return null;
  if (!res.ok) {
    await userinfoRejected("discord", res);
    return null;
  }

  const data = await readJsonObject("discord", "userinfo", res);
  if (!data) return null;
  if (typeof data.email !== "string") {
    noEmail("discord", res);
    return null;
  }

  return {
    id: typeof data.id === "string" ? data.id : null,
    email: data.email,
    emailVerified: data.verified === true,
    name: typeof data.username === "string" ? data.username : null,
    // ?size=128 matters: next.config.mjs sets images.unoptimized, so every
    // next/image is a pass-through <img> with no resizing. Without the cap
    // Discord's CDN serves the full-resolution PNG (up to 1024px) and the
    // browser downloads all of it to paint a 14px circle on /public-scans.
    // The Discord CONNECT flow (app/api/v3/account/discord/route.ts) already
    // caps its URL the same way; only this sign-in path did not.
    avatarUrl:
      typeof data.avatar === "string" && typeof data.id === "string"
        ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=128`
        : null,
  };
}
