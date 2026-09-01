import {
  OAUTH_PROVIDERS,
  getOAuthClientId,
  getOAuthClientSecret,
  type OAuthProviderId,
} from "@/lib/auth/oauth-providers";
import { APP_NAME } from "@/lib/config/constants";

/**
 * Authorization-code exchange and normalized userinfo lookup for each OAuth
 * sign-up/sign-in provider. Kept in one module (rather than one per
 * provider) because the shape callers need back is identical -- an access
 * token, then a verified email -- only the wire format differs.
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

export async function exchangeOAuthCode(
  provider: OAuthProviderId,
  code: string,
  redirectUri: string,
): Promise<OAuthTokenResult | null> {
  const clientId = getOAuthClientId(provider);
  const clientSecret = getOAuthClientSecret(provider);
  if (!clientId || !clientSecret) return null;

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

  let res: Response;
  try {
    res = await fetch(providerConfig.tokenUrl, {
      method: "POST",
      headers,
      body,
    });
  } catch (err) {
    console.error(`[oauth-userinfo] ${provider} token request failed:`, err);
    return null;
  }
  if (!res.ok) return null;

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  // GitHub returns HTTP 200 with an `error` field in the body instead of a
  // non-2xx status when the code/secret is wrong -- res.ok alone would miss
  // that.
  if (data.error || typeof data.access_token !== "string") return null;
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
  let res: Response;
  try {
    res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.error("[oauth-userinfo] google userinfo request failed:", err);
    return null;
  }
  if (!res.ok) return null;

  const data = await res.json();
  if (typeof data.email !== "string") return null;

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

  let userRes: Response;
  try {
    userRes = await fetch("https://api.github.com/user", { headers });
  } catch (err) {
    console.error("[oauth-userinfo] github user request failed:", err);
    return null;
  }
  if (!userRes.ok) return null;
  const user = await userRes.json();

  // GitHub's /user.email is only populated when the user made their email
  // public; it also doesn't say whether the address is verified. /user/emails
  // (needs the user:email scope, which this flow always requests) is the
  // only reliable source of a verified email.
  let email: string | null = typeof user.email === "string" ? user.email : null;
  let emailVerified = false;

  try {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers,
    });
    if (emailsRes.ok) {
      const emails: Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }> = await emailsRes.json();
      const primaryVerified = emails.find((e) => e.primary && e.verified);
      if (primaryVerified) {
        email = primaryVerified.email;
        emailVerified = true;
      } else if (email) {
        emailVerified =
          emails.find((e) => e.email === email)?.verified ?? false;
      }
    }
  } catch (err) {
    console.error("[oauth-userinfo] github emails request failed:", err);
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
  let res: Response;
  try {
    res = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.error("[oauth-userinfo] discord user request failed:", err);
    return null;
  }
  if (!res.ok) return null;

  const data = await res.json();
  if (typeof data.email !== "string") return null;

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
