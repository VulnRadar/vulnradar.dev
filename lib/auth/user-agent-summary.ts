/**
 * Turns a raw User-Agent header into a short "Chrome on Windows" style
 * summary for the sessions / trusted-devices lists in the profile security
 * tab (components/profile/tabs/profile-security-tab.tsx). No UA-parsing
 * helper or dependency exists anywhere else in this codebase -- every other
 * call site (lib/email/email.ts's security-alert emails, the admin session
 * view in app/api/v3/admin/route.ts) prints the raw string verbatim rather
 * than summarizing it. This is deliberately coarse: it exists so a user can
 * tell "is this my laptop or a stranger's phone" at a glance, not as an
 * analytics-grade UA parser, so it doesn't warrant pulling in a library.
 *
 * Order matters below: several browsers spoof `Chrome/` and/or `Safari/`
 * tokens in their own UA string, so the more specific checks run first.
 */
export function summarizeUserAgent(
  userAgent: string | null | undefined,
): string {
  if (!userAgent || userAgent === "unknown") return "Unknown device";

  let browser = "Unknown browser";
  if (/edg\//i.test(userAgent)) browser = "Edge";
  else if (/opr\//i.test(userAgent) || /\bopera\b/i.test(userAgent))
    browser = "Opera";
  else if (/crios\//i.test(userAgent)) browser = "Chrome";
  else if (/fxios\//i.test(userAgent)) browser = "Firefox";
  else if (/firefox\//i.test(userAgent)) browser = "Firefox";
  else if (/chrome\//i.test(userAgent) && !/chromium/i.test(userAgent))
    browser = "Chrome";
  else if (/chromium\//i.test(userAgent)) browser = "Chromium";
  else if (/version\//i.test(userAgent) && /safari\//i.test(userAgent))
    browser = "Safari";
  else if (/curl\//i.test(userAgent)) browser = "curl";
  else if (/postmanruntime/i.test(userAgent)) browser = "Postman";
  else if (/python-requests|python-urllib/i.test(userAgent))
    browser = "API client";

  let os = "";
  if (/windows/i.test(userAgent)) os = "Windows";
  else if (/iphone|ipad|ipod/i.test(userAgent)) os = "iOS";
  else if (/mac os x/i.test(userAgent)) os = "Mac";
  else if (/android/i.test(userAgent)) os = "Android";
  else if (/linux/i.test(userAgent)) os = "Linux";

  return os ? `${browser} on ${os}` : browser;
}
