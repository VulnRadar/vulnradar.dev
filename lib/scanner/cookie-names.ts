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

/**
 * A whole word of a session or auth cookie name, after camelCase is split.
 * Whole words only: a prefix match took `author_pref` for `auth`,
 * `sidebar_state` for `sid` and `tokenizer` for `token`.
 */
const SENSITIVE_COOKIE_WORD =
  /(?:^|[_.-])(?:sess|session|sid|auth|token|jwt|access|refresh|login|secret|password|passwd|pwd)(?:$|[_.-])/;

/**
 * Persistent-login cookies (`remember_me`, Laravel's `remember_web_<hash>`).
 * `remember` alone is not enough: `remember_theme` remembers a preference.
 */
const REMEMBER_LOGIN = /(?:^|[_.-])remember(?:me|[_.-](?:me|token|web))/;

/** Any CSRF or XSRF cookie, whatever else its name says. */
const CSRF_NAME = /csrf|xsrf/i;

/**
 * Whether the name suggests the cookie carries a session or credential.
 *
 * A CSRF cookie is not one, even though its name contains "token": the
 * double-submit pattern needs script to read it, the same call
 * sensitive-meta-tags makes for the csrf meta tag.
 */
export function isSessionLikeName(name: string): boolean {
  const n = name.trim();
  if (isCsrfTokenReadableByDesign(n) || CSRF_NAME.test(n)) return false;
  const words = n.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  // PHPSESSID and JSESSIONID are one run with no separator, and IIS appends a
  // random suffix to ASPSESSIONID.
  return (
    SENSITIVE_COOKIE_WORD.test(words) ||
    /sess(?:ion)?id$|^aspsessionid/.test(words) ||
    REMEMBER_LOGIN.test(words)
  );
}
