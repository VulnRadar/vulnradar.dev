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
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
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
    email,
    emailVerified,
    name:
      typeof user.name === "string"
        ? user.name
        : typeof user.login === "string"
          ? user.login
          : null,
    avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
  };
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
    email: data.email,
    emailVerified: data.verified === true,
    name: typeof data.username === "string" ? data.username : null,
    avatarUrl:
      typeof data.avatar === "string" && typeof data.id === "string"
        ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`
        : null,
  };
}
