/**
 * What a cookie NAME says about the cookie.
 *
 * One definition, shared by the page-context `sessionLike` flag, the per-cookie
 * page checks and the code checks. It used to live as a private regex in each,
 * and they disagreed: a Laravel `XSRF-TOKEN` matched `token` in one and was
 * excluded in another, and a CamelCase `MoodleSession` matched in neither.
 */

/**
 * CSRF tokens that are readable by JavaScript ON PURPOSE.
 *
 * The double-submit-cookie pattern requires the page's own script to read the
 * cookie and echo it into a request header, so HttpOnly would break the
 * protection rather than add to it. Django ships `csrftoken` with
 * CSRF_COOKIE_HTTPONLY defaulting to False; Laravel ships `XSRF-TOKEN`
 * specifically so Axios can read it into X-XSRF-TOKEN.
 *
 * Only HttpOnly and "is this a session" questions consult this. Secure and
 * SameSite still apply to these cookies: a CSRF token sent over plain HTTP, or
 * with no SameSite, is a real finding.
 */
const CSRF_TOKEN_READABLE_BY_DESIGN =
  /^(?:csrftoken|csrf[_-]?token|xsrf[_-]?token|_csrf|_csrf[_-]?token|ct0)$/i;

export function isCsrfTokenReadableByDesign(name: string): boolean {
  return CSRF_TOKEN_READABLE_BY_DESIGN.test(name.trim());
}

const SESSION_NAME =
  /^(?:.*[-_.])?(?:sess|session|sid|sessid|jsessionid|phpsessid|asp\.net_sessionid|auth|token|jwt|access_token|refresh_token|remember|login)/i;

/** A CamelCase name has no separator before "Session" (`MoodleSession`). */
const CAMEL_SESSION_NAME = /[a-z]Session(?:Id|ID)?$/;

/**
 * Whether the name suggests the cookie carries a session or credential.
 * A CSRF token readable by design is not one, even though its name contains
 * "token".
 */
export function isSessionLikeName(name: string): boolean {
  const n = name.trim();
  if (isCsrfTokenReadableByDesign(n)) return false;
  return SESSION_NAME.test(n) || CAMEL_SESSION_NAME.test(n);
}
