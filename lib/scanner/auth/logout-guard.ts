/**
 * Logout and destructive-URL detection.
 *
 * Crawling a site while signed in walks straight into the navigation, and
 * the navigation contains a "Sign out" link and, on plenty of apps, a
 * "Delete" link that acts on a GET. Requesting either one ends the scan or
 * damages the user's data.
 *
 * `safeFetch` refuses to send an authenticated request to anything these
 * predicates flag. The predicates are exported so a crawler can also drop
 * such links before they ever reach the queue.
 *
 * These match on the URL only. They are intentionally broad: a false
 * positive costs one skipped page, a false negative costs the user their
 * session or their data.
 */

/**
 * Path segments that end a session. Matched against each path segment and
 * against the whole path with separators normalised, so /logout,
 * /auth/sign-out, /users/sign_out and /account/logOut all match.
 */
const LOGOUT_PATTERNS: RegExp[] = [
  /(^|[^a-z0-9])(log|sign)[\s._-]*(out|off)([^a-z0-9]|$)/i,
  /(^|[^a-z0-9])(signoff|logoff|logout|signout)([^a-z0-9]|$)/i,
  /(^|[^a-z0-9])(session|sessions)[/_-](destroy|delete|end|revoke)([^a-z0-9]|$)/i,
  /(^|[^a-z0-9])(end[\s._-]?session|revoke[\s._-]?session|kill[\s._-]?session)([^a-z0-9]|$)/i,
  /(^|[^a-z0-9])(disconnect|deauth|deauthorize|deauthorise|unauthenticate)([^a-z0-9]|$)/i,
];

/**
 * Path segments that change or destroy state. Many frameworks expose these
 * over GET, and a signed-in crawler will happily follow them.
 */
const DESTRUCTIVE_SEGMENTS =
  /^(delete|destroy|remove|deactivate|disable|purge|drop|wipe|terminate|cancel|revoke|reset|unsubscribe|uninstall|erase|trash|archive|close-account|close_account)$/i;

/** Query strings that trigger a logout or a destructive action. */
const DESTRUCTIVE_QUERY_KEYS = new Set([
  "logout",
  "signout",
  "sign_out",
  "log_out",
  "loggedout",
  "delete",
  "destroy",
  "remove",
  "revoke",
  "deactivate",
]);

const DESTRUCTIVE_QUERY_VALUES =
  /^(logout|signout|sign_out|log_out|delete|destroy|remove|revoke|deactivate|disable|purge|terminate|cancel)$/i;

const ACTION_QUERY_KEYS = new Set([
  "action",
  "do",
  "op",
  "mode",
  "cmd",
  "task",
  "_method",
  "method",
]);

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return null;
  }
}

function searchParamsOf(url: string): URLSearchParams | null {
  try {
    return new URL(url).searchParams;
  } catch {
    return null;
  }
}

/** True when requesting this URL would probably end the session. */
export function isLogoutUrl(url: string): boolean {
  const path = pathOf(url);
  if (path === null) return false;
  const decodedPath = safeDecode(path);
  if (LOGOUT_PATTERNS.some((pattern) => pattern.test(decodedPath))) return true;

  const params = searchParamsOf(url);
  if (!params) return false;
  for (const [rawKey, rawValue] of params) {
    const key = rawKey.toLowerCase();
    const value = rawValue.toLowerCase();
    if (
      key === "logout" ||
      key === "signout" ||
      key === "sign_out" ||
      key === "log_out"
    ) {
      return true;
    }
    if (
      ACTION_QUERY_KEYS.has(key) &&
      /^(logout|signout|sign_out|log_out|logoff|signoff)$/i.test(value)
    ) {
      return true;
    }
  }
  return false;
}

/** True when requesting this URL would probably change or destroy state. */
export function isDestructiveUrl(url: string): boolean {
  const path = pathOf(url);
  if (path === null) return false;
  const segments = safeDecode(path)
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  if (segments.some((segment) => DESTRUCTIVE_SEGMENTS.test(segment))) {
    return true;
  }

  const params = searchParamsOf(url);
  if (!params) return false;
  for (const [rawKey, rawValue] of params) {
    const key = rawKey.toLowerCase();
    const value = rawValue;
    if (DESTRUCTIVE_QUERY_KEYS.has(key) && value !== "0" && value !== "false") {
      return true;
    }
    if (ACTION_QUERY_KEYS.has(key) && DESTRUCTIVE_QUERY_VALUES.test(value)) {
      return true;
    }
  }
  return false;
}

/**
 * The single predicate `safeFetch` consults before attaching a session.
 * Returns a non-secret reason when the URL must not be requested with
 * credentials attached, or null when it is safe.
 */
export function blockedForAuthenticatedRequest(url: string): string | null {
  if (isLogoutUrl(url)) {
    return "Refusing to request a sign-out URL with an authenticated session.";
  }
  if (isDestructiveUrl(url)) {
    return "Refusing to request a destructive URL with an authenticated session.";
  }
  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
