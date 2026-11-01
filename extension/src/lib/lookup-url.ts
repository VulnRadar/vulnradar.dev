// What the extension may send about an address, and which addresses it may act
// on at all without being asked.
//
// Two kinds of request leave the browser on their own: the Site Alerts lookup
// on every page you open, and auto-scan. Both used to send the tab's full URL
// to VulnRadar. That URL carries the query string, so a password-reset link, a
// magic-login link or an OAuth redirect went to a third party the moment its
// page loaded, and a private address (localhost, a router, an intranet host)
// was sent only to be rejected. This module is the one place that decides what
// an unattended request may contain.
//
// Pure on purpose: no browser APIs, so it is imported by the background worker,
// the API layer and the tests alike.

/** Suffixes that never name a host on the public internet. Exported so the
 *  README and the docs page, which list them, can be held to this list. */
export const NON_PUBLIC_SUFFIXES: readonly string[] = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".test",
  ".home.arpa",
];

/**
 * True for a hostname that can name a site on the public internet.
 *
 * False for: a single-label name (localhost, a bare intranet name), an IPv4 or
 * IPv6 literal, and the reserved or conventionally private suffixes above. An
 * IPv4 literal is recognised by its last label being numeric or 0x-hex, because
 * that is how the URL parser accepts every notation of one (127.1, 0x7f.1,
 * 2130706433) and a real top-level domain is never numeric.
 */
export function isPublicHostname(hostname: string): boolean {
  let h = hostname.trim().toLowerCase();
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (!h) return false;
  // URL.hostname keeps the brackets on an IPv6 literal.
  if (h.startsWith("[") || h.includes(":")) return false;
  if (!h.includes(".")) return false;
  const labels = h.split(".");
  const last = labels[labels.length - 1] ?? "";
  if (/^(?:\d+|0x[0-9a-f]*)$/.test(last)) return false;
  for (const suffix of NON_PUBLIC_SUFFIXES) {
    if (h === suffix.slice(1) || h.endsWith(suffix)) return false;
  }
  return true;
}

/**
 * The only form of an address the Site Alerts lookup may send: scheme, host,
 * port and path. Userinfo, query and fragment are dropped, so what leaves the
 * browser is what a page's address already says about the site, not what a
 * login or reset flow put in it.
 *
 * Null when the address is not http or https, or its host is not public: the
 * caller then makes no request and shows no card.
 */
export function lookupUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!isPublicHostname(u.hostname)) return null;
  return `${u.origin}${u.pathname}`;
}

/**
 * Stems that mark a query parameter as carrying a credential wherever they
 * appear in its name, so the run-together spellings (apikey, accesstoken,
 * sessionid, PHPSESSID, jwt) count as well as api_key and accessToken. Each is
 * specific enough that no ordinary parameter name contains it.
 */
const CREDENTIAL_STEMS: readonly string[] = [
  "token",
  "secret",
  "session",
  "sessid",
  "passw",
  "apikey",
  "authkey",
  "accesskey",
  "privatekey",
  "authoriz",
  "jwt",
  "ticket",
  "credential",
  "signature",
  "bearer",
];

/**
 * Short words that are credentials only on their own: matched against the
 * words of the parameter name, so api_key, reset_code and x-auth count while
 * "keyword", "monkey", "zipcode" and "author" do not.
 */
const CREDENTIAL_WORDS: ReadonlySet<string> = new Set([
  "code",
  "key",
  "sig",
  "otp",
  "reset",
  "auth",
]);

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * True when the address looks like it carries a credential: userinfo, or a
 * query parameter named like a token, code, key, secret, signature, OTP,
 * reset or session. An unattended scan skips these outright, because the
 * address would be sent to VulnRadar and stored in the account's history.
 */
export function carriesCredential(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return true;
  for (const name of u.searchParams.keys()) {
    const squashed = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (CREDENTIAL_STEMS.some((stem) => squashed.includes(stem))) return true;
    if (nameWords(name).some((w) => CREDENTIAL_WORDS.has(w))) return true;
  }
  return false;
}

/** The address without its fragment. A fragment never reaches a server, and
 *  an OAuth implicit-flow redirect puts the access token in it. */
export function withoutFragment(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}
