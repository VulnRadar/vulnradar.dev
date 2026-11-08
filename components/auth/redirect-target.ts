import { safeRedirect } from "@/lib/auth/safe-redirect";
import {
  EMAIL_VERIFICATION_TOKEN_LIFETIME,
  ROUTES,
} from "@/lib/config/client-constants";

/**
 * Carries a `?redirect=` target between the auth screens. Every read and write
 * goes back through safeRedirect, so a value that was edited in the address
 * bar or in the cookie jar is judged the same as one that was never checked.
 */

/**
 * Appends the target to an auth link. The dashboard is left off because it is
 * where every sign-in already ends up, and a crawlable /login link to
 * /signup?redirect=%2Fdashboard would be a second URL for the same page.
 */
export function withRedirect(
  href: string,
  redirectTo: string | null | undefined,
): string {
  const safe = safeRedirect(redirectTo, ROUTES.DASHBOARD);
  if (safe === ROUTES.DASHBOARD) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}redirect=${encodeURIComponent(safe)}`;
}

const POST_VERIFY_COOKIE = "post_verify_redirect";

/**
 * A verification link can only be opened from the inbox, which is a new page
 * with no memory of the signup that sent it, so the target waits in a cookie
 * for as long as the link itself can work. Scoped to /verify-email: the one
 * page that reads it, and the only one it has any reason to be sent to.
 */
function cookieAttributes(): string {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  return `Path=${ROUTES.VERIFY_EMAIL}; SameSite=Lax${secure}`;
}

/** Stores the target, or clears an older signup's when there is none. */
export function rememberPostVerifyRedirect(
  redirectTo: string | null | undefined,
): void {
  const safe = safeRedirect(redirectTo, "");
  document.cookie = safe
    ? `${POST_VERIFY_COOKIE}=${encodeURIComponent(safe)}; Max-Age=${EMAIL_VERIFICATION_TOKEN_LIFETIME}; ${cookieAttributes()}`
    : `${POST_VERIFY_COOKIE}=; Max-Age=0; ${cookieAttributes()}`;
}

export function readPostVerifyRedirect(fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const prefix = `${POST_VERIFY_COOKIE}=`;
  const raw = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
  if (!raw) return fallback;
  try {
    return safeRedirect(decodeURIComponent(raw), fallback);
  } catch {
    return fallback;
  }
}
