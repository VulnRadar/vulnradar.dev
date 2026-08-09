/**
 * Cookies detectors.
 *
 * Reads the Set-Cookie headers from the response and inspects each one
 * for missing flags, suspicious prefixes, and config-level issues.
 */

import {
  getSetCookies,
  parseCookieName,
  type EvidenceFn as DetectFn,
} from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  "cookie-security": (_url, headers) => {
    const setCookies = getSetCookies(headers);
    if (setCookies.length === 0) return null;
    const issues: string[] = [];
    for (const cookie of setCookies) {
      const lower = cookie.toLowerCase();
      const name = parseCookieName(cookie);
      if (!lower.includes("httponly") && !name.startsWith("__Host-"))
        issues.push(`${name} missing HttpOnly`);
      if (!lower.includes("secure")) issues.push(`${name} missing Secure`);
      if (!lower.includes("samesite")) issues.push(`${name} missing SameSite`);
    }
    return issues.length > 0 ? issues.slice(0, 5).join("; ") : null;
  },

  "cookie-httponly-missing": (_url, headers) => {
    const cookies = getSetCookies(headers);
    const missing = cookies.filter(
      (c) => !c.toLowerCase().includes("httponly"),
    );
    return missing.length > 0
      ? `${missing.length} cookie(s) missing HttpOnly: ${missing.map(parseCookieName).join(", ")}`
      : null;
  },

  "cookie-secure-missing": (_url, headers) => {
    const cookies = getSetCookies(headers);
    const missing = cookies.filter((c) => !c.toLowerCase().includes("secure"));
    return missing.length > 0
      ? `${missing.length} cookie(s) missing Secure: ${missing.map(parseCookieName).join(", ")}`
      : null;
  },

  "cookie-samesite-missing": (_url, headers) => {
    const cookies = getSetCookies(headers);
    const missing = cookies.filter(
      (c) => !c.toLowerCase().includes("samesite"),
    );
    return missing.length > 0
      ? `${missing.length} cookie(s) missing SameSite: ${missing.map(parseCookieName).join(", ")}`
      : null;
  },

  "cookie-prefix-invalid": (_url, headers) => {
    const cookies = getSetCookies(headers);
    const bad: string[] = [];
    for (const c of cookies) {
      const name = parseCookieName(c);
      const lower = c.toLowerCase();
      if (name.startsWith("__host-") && !lower.includes("secure"))
        bad.push(`${name} (missing Secure)`);
      if (name.startsWith("__host-") && !lower.includes("path=/"))
        bad.push(`${name} (path not /)`);
    }
    return bad.length > 0 ? `Cookie prefix violation: ${bad.join(", ")}` : null;
  },

  "cookie-no-secure-prefix": (_url, headers) => {
    const cookies = getSetCookies(headers);
    if (cookies.length === 0) return null;
    const sensitive = cookies.filter((c) => {
      const name = parseCookieName(c).toLowerCase();
      return (
        name.includes("session") ||
        name.includes("token") ||
        name.includes("auth") ||
        name.includes("jwt")
      );
    });
    const noPrefixed = sensitive.filter((c) => {
      const name = parseCookieName(c);
      return !name.startsWith("__Host-") && !name.startsWith("__Secure-");
    });
    return noPrefixed.length > 0
      ? `${noPrefixed.length} sensitive cookie(s) lack __Host- or __Secure- prefix: ${noPrefixed.map(parseCookieName).join(", ")}`
      : null;
  },

  "set-cookie-samesite-none-no-secure": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const lower = c.toLowerCase();
      if (lower.includes("samesite=none") && !lower.includes("secure")) {
        return `Cookie has SameSite=None without Secure flag: ${parseCookieName(c)}.`;
      }
    }
    return null;
  },

  "cookie-max-age-excessive": () => null, // duplicate of cookie-expires-too-far
  "cookie-path-broad": () => null, // duplicate of cookie-path-cross-app

  "session-cookie-flags": (_url, headers) => {
    const cookies = getSetCookies(headers);
    if (cookies.length === 0) return null;
    const issues: string[] = [];
    for (const c of cookies) {
      const lower = c.toLowerCase();
      const name = parseCookieName(c).toLowerCase();
      if (!/session|sid|auth/i.test(name)) continue;
      if (!lower.includes("httponly")) issues.push(`${name} missing HttpOnly`);
      if (!lower.includes("secure")) issues.push(`${name} missing Secure`);
      if (!lower.includes("samesite")) issues.push(`${name} missing SameSite`);
    }
    return issues.length > 0
      ? `Session cookie has issues: ${issues.join(", ")}.`
      : null;
  },

  // ── Per-attribute detectors ───────────────────────────────────────────────
  // Fallback branches that fired for ANY cookie regardless of the actual
  // misconfiguration have been removed. Only the primary condition (the real
  // bad behaviour) triggers a finding.

  "cookie-domain-broad": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const m = c.match(/domain\s*=\s*([^;,\s]+)/i);
      if (m && /^\./.test(m[1])) {
        return `Cookie '${parseCookieName(c)}' uses leading-dot domain '${m[1]}' (sent to all subdomains).`;
      }
    }
    return null;
  },

  "cookie-domain-no-leading-dot": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const m = c.match(/domain\s*=\s*([^;,\s]+)/i);
      if (m && !/^\./.test(m[1]) && /\./.test(m[1])) {
        return `Cookie '${parseCookieName(c)}' sets Domain=${m[1]} without leading dot — modern guidance recommends omitting Domain altogether.`;
      }
    }
    return null;
  },

  "cookie-domain-parent-on-subdomain": () => null, // duplicate of cookie-domain-broad

  "cookie-domain-set-too-loose": (_url, _headers) => {
    // Setting an explicit Domain= attribute is extremely common and not a
    // vulnerability on its own. The real issues (leading dot, cross-subdomain)
    // are caught by cookie-domain-broad and cookie-domain-no-leading-dot.
    return null;
  },

  "cookie-expires-in-past": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const m = c.match(/expires\s*=\s*([^;,\s]+)/i);
      if (m) {
        const d = new Date(m[1]);
        if (!isNaN(d.getTime()) && d.getTime() < Date.now()) {
          return `Cookie '${parseCookieName(c)}' has Expires=${m[1]} (already in the past).`;
        }
      }
    }
    return null;
  },

  "cookie-expires-too-far": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const m = c.match(/(?:max-age|expires)\s*=\s*([^;,\s]+)/i);
      if (m) {
        const v = m[1].trim();
        if (/^\d+$/.test(v)) {
          const secs = parseInt(v, 10);
          if (secs > 31536000) {
            return `Cookie '${parseCookieName(c)}' max-age=${secs} (~${Math.round(secs / 86400)} days) exceeds 1 year.`;
          }
        } else {
          const d = new Date(v);
          if (!isNaN(d.getTime())) {
            const days = (d.getTime() - Date.now()) / 86400000;
            if (days > 365) {
              return `Cookie '${parseCookieName(c)}' Expires=${v} (~${Math.round(days)} days) exceeds 1 year.`;
            }
          }
        }
      }
    }
    return null;
  },

  "cookie-host-prefix-injection-subdomain": (_url, _headers) => {
    // Cookies that use __Host- or __Secure- prefixes are correctly hardened.
    // We cannot determine from the response whether the name was constructed
    // from user input, so firing here produces false positives on properly-
    // secured cookies. The real prefix violations are caught by
    // cookie-prefix-invalid, cookie-host-prefix-not-secure, and
    // cookie-host-prefix-wrong-path.
    return null;
  },

  "cookie-host-prefix-not-secure": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (name.startsWith("__Host-") && !c.toLowerCase().includes("secure")) {
        return `Cookie '${name}' uses __Host- prefix but is missing Secure.`;
      }
    }
    return null;
  },

  "cookie-host-prefix-wrong-path": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (name.startsWith("__Host-")) {
        const pathMatch = c.match(/path\s*=\s*([^;,\s]+)/i);
        if (!pathMatch || pathMatch[1].trim() !== "/") {
          return `Cookie '${name}' uses __Host- prefix but Path is not '/' (found ${pathMatch ? pathMatch[1] : "missing"}).`;
        }
      }
    }
    return null;
  },

  "cookie-max-age-zero": (_url, _headers) => {
    // Max-Age=0 is the standard mechanism for deleting a cookie (logout flows,
    // session cleanup). This is correct behavior, not a security issue.
    return null;
  },

  "cookie-name-disclosure": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c).toLowerCase();
      if (
        name === "phpsessid" ||
        name === "jsessionid" ||
        /^asp\.net_sessionid$/i.test(name) ||
        /^express\.sess$/i.test(name)
      ) {
        return `Cookie name '${parseCookieName(c)}' reveals backend framework.`;
      }
    }
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (/^[a-z]+$/i.test(name) && name.length === 1) {
        return `Cookie name '${name}' is a single-letter opaque identifier — verify it isn't a default framework cookie.`;
      }
    }
    return null;
  },

  "cookie-no-csrf-token": (_url, headers) => {
    const cookies = getSetCookies(headers);
    let hasSession = false;
    let hasCsrf = false;
    for (const c of cookies) {
      const name = parseCookieName(c).toLowerCase();
      if (/session|sid|auth/i.test(name)) hasSession = true;
      if (/csrf|xsrf|_token|authenticity/i.test(name)) hasCsrf = true;
    }
    if (hasSession && !hasCsrf) {
      // SameSite=Strict on all session cookies provides CSRF protection
      const sessionCookies = cookies.filter((c) =>
        /session|sid|auth/i.test(parseCookieName(c).toLowerCase()),
      );
      if (sessionCookies.every((c) => /samesite\s*=\s*strict/i.test(c)))
        return null;
      return "Session cookies present but no CSRF token cookie — risk of CSRF attacks.";
    }
    return null;
  },

  "cookie-no-samesite-third-party": (_url, _headers) => {
    // An explicit Domain= attribute does not mean a cookie is "third-party"
    // or "cross-site" — a cookie scoped to a parent domain for subdomain SSO
    // (Domain=example.com set by www.example.com so api.example.com can read
    // it) is a completely ordinary, first-party pattern at any company with
    // multiple subdomains, and is not determinable as cross-site from a
    // single response. This also duplicated
    // cookie-third-party-no-samesite-none-secure's firing condition whenever
    // SameSite was absent entirely. Disabled; genuinely cross-site cookies
    // (SameSite=None already declared) are correctly covered by
    // set-cookie-samesite-none-no-secure. ref: AUDIT-008#scanner-08
    return null;
  },

  "cookie-partitioned-missing": (_url, _headers) => {
    // Same flawed premise as cookie-no-samesite-third-party: Domain= does not
    // indicate the cookie is used in a genuinely cross-site/third-party iframe
    // context, which is what Partitioned (CHIPS) actually targets. Cannot be
    // determined from a single response. ref: AUDIT-008#scanner-08
    return null;
  },

  "cookie-partitioned-without-secure": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      // Partitioned and Secure are boolean flags (no = sign), check attributes after first ;
      const attrs = c.includes(";") ? c.substring(c.indexOf(";")) : "";
      if (/\bpartitioned\b/i.test(attrs) && !/\bsecure\b/i.test(attrs)) {
        return `Cookie '${parseCookieName(c)}' has Partitioned but is missing Secure (browsers will reject).`;
      }
    }
    return null;
  },

  "cookie-path-cross-app": (_url, _headers) => {
    // Path=/ is the most common and typically correct setting for session and
    // auth cookies — it ensures the cookie is sent with every request to the
    // host. Flagging Path=/ generates noise on virtually every authenticated
    // web application. Only flag when a MORE restrictive path is needed (e.g.
    // for multi-app hosting on the same domain), which we cannot determine
    // from the response alone.
    return null;
  },

  "cookie-path-root": () => null, // duplicate of cookie-path-cross-app
  "cookie-prefix-missing": () => null, // duplicate of cookie-no-secure-prefix

  "cookie-secure-prefix-not-secure": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (name.startsWith("__Secure-")) {
        // Check attributes only (after first ;) so the prefix name "Secure" doesn't match itself.
        const attrs = c.includes(";") ? c.substring(c.indexOf(";")) : "";
        if (!/\bsecure\b/i.test(attrs)) {
          return `Cookie '${name}' uses __Secure- prefix but is missing Secure attribute.`;
        }
      }
    }
    // Removed fallback that fired for any cookie missing Secure; that is
    // already covered by cookie-secure-missing.
    return null;
  },

  "cookie-third-party-no-samesite-none-secure": (_url, _headers) => {
    // Same flawed premise as cookie-no-samesite-third-party: an explicit
    // Domain= attribute alone does not make a cookie "cross-site" — it's the
    // standard way to share a cookie across subdomains for first-party SSO,
    // which is extremely common at any company with multiple subdomains and
    // is not evidence the cookie needs SameSite=None. As written, this fired
    // on ordinary Domain-scoped cookies using SameSite=Lax/Strict (a
    // perfectly secure, arguably *more* secure configuration) and demanded
    // SameSite=None, which is worse remediation advice, not better. The real,
    // precise check — SameSite=None already declared but Secure missing —
    // is covered correctly by set-cookie-samesite-none-no-secure, which
    // doesn't depend on guessing "third-party" from Domain=.
    // Disabled. ref: AUDIT-008#scanner-08
    return null;
  },
};
