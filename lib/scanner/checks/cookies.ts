/**
 * Cookies detectors.
 *
 * Reads the Set-Cookie headers from the response and inspects each one
 * for missing flags, suspicious prefixes, and config-level issues.
 */

import {
  getSetCookies,
  parseCookieName,
  cookieHasAttribute,
  type EvidenceFn as DetectFn,
} from "../_helpers";

// "cookie-security" used to have a second, simpler implementation here. It
// was dead: the check's definition lives in checks-data/headers.json with
// category "headers", and registry.ts's resolveDetector always prefers the
// bundle that owns the definition's category, so headers.ts's copy has always
// been the one that runs. The dead copy was also the worse of the two, since
// it flagged every cookie rather than only session/auth-shaped ones, which
// meant a maintainer "fixing" a `_ga` false positive here would have changed
// nothing at all. ref: AUDIT-009#dup-09
export const detectors: Record<string, DetectFn> = {
  "cookie-httponly-missing": (_url, headers) => {
    const cookies = getSetCookies(headers);
    const sensitive = cookies.filter((c) => {
      const name = parseCookieName(c).toLowerCase();
      return (
        name.includes("session") ||
        name.includes("token") ||
        name.includes("auth") ||
        name.includes("jwt")
      );
    });
    const missing = sensitive.filter((c) => !cookieHasAttribute(c, "httponly"));
    return missing.length > 0
      ? `${missing.length} cookie(s) missing HttpOnly: ${missing.map(parseCookieName).join(", ")}`
      : null;
  },

  "cookie-secure-missing": (_url, headers) => {
    const cookies = getSetCookies(headers);
    const sensitive = cookies.filter((c) => {
      const name = parseCookieName(c).toLowerCase();
      return (
        name.includes("session") ||
        name.includes("token") ||
        name.includes("auth") ||
        name.includes("jwt")
      );
    });
    const missing = sensitive.filter((c) => !cookieHasAttribute(c, "secure"));
    return missing.length > 0
      ? `${missing.length} cookie(s) missing Secure: ${missing.map(parseCookieName).join(", ")}`
      : null;
  },

  "cookie-samesite-missing": (_url, headers) => {
    const cookies = getSetCookies(headers);
    const sensitive = cookies.filter((c) => {
      const name = parseCookieName(c).toLowerCase();
      return (
        name.includes("session") ||
        name.includes("token") ||
        name.includes("auth") ||
        name.includes("jwt")
      );
    });
    const missing = sensitive.filter((c) => !cookieHasAttribute(c, "samesite"));
    return missing.length > 0
      ? `${missing.length} cookie(s) missing SameSite: ${missing.map(parseCookieName).join(", ")}`
      : null;
  },

  "cookie-prefix-invalid": (_url, _headers) => {
    // This umbrella check compared the cookie name against a lowercase
    // "__host-" prefix, which real __Host- cookies (capital H, per
    // RFC 6265bis and every implementation) never match, making it a dead
    // check in practice; it also had no __Secure- branch at all. The precise,
    // correctly-cased checks already exist separately: cookie-host-prefix-
    // not-secure, cookie-host-prefix-wrong-path, and cookie-secure-prefix-
    // not-secure. Disabled here rather than fixed as a second, duplicate
    // implementation of those checks.
    return null;
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
      const parts = c.split(";").slice(1);
      const sameSiteNone = parts.some(
        (p) => p.trim().toLowerCase() === "samesite=none",
      );
      if (sameSiteNone && !cookieHasAttribute(c, "secure")) {
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
      const name = parseCookieName(c).toLowerCase();
      const isSessionLike =
        /session|auth|token/i.test(name) || /(^|[_.-])sid($|[_.-])/i.test(name);
      if (!isSessionLike) continue;
      if (!cookieHasAttribute(c, "httponly"))
        issues.push(`${name} missing HttpOnly`);
      if (!cookieHasAttribute(c, "secure"))
        issues.push(`${name} missing Secure`);
      if (!cookieHasAttribute(c, "samesite"))
        issues.push(`${name} missing SameSite`);
    }
    return issues.length > 0
      ? `Session cookie has issues: ${issues.join(", ")}.`
      : null;
  },

  // ── Per-attribute detectors ───────────────────────────────────────────────
  // Fallback branches that fired for ANY cookie regardless of the actual
  // misconfiguration have been removed. Only the primary condition (the real
  // bad behaviour) triggers a finding.

  // Per RFC 6265bis, a leading dot on Domain= is stripped and ignored --
  // Domain=example.com and Domain=.example.com send the cookie to every
  // subdomain identically. Both syntaxes used to be split into separate
  // checks (one flagging the leading-dot form, one flagging its absence),
  // which meant the "no leading dot" check fired on the RFC-6265bis-correct
  // syntax and told the site to add back the deprecated dot -- backwards
  // advice for the one form that was already fine. A single check on
  // whether Domain= is present at all (regardless of dot) covers the real
  // risk described in riskImpact/explanation above.
  "cookie-domain-broad": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      // Only the attribute segments (after name=value): a "domain=" inside the
      // cookie VALUE (e.g. a stored return-URL like `last=/x?domain=acme.com`)
      // is not the Domain attribute and must not trip this.
      const domainAttr = c
        .split(";")
        .slice(1)
        .map((p) => p.trim())
        .find((p) => /^domain\s*=/i.test(p));
      if (domainAttr) {
        const value = domainAttr.replace(/^domain\s*=\s*/i, "").trim();
        if (/\./.test(value)) {
          return `Cookie '${parseCookieName(c)}' sets Domain=${value} (sent to all subdomains).`;
        }
      }
    }
    return null;
  },

  "cookie-domain-no-leading-dot": () => null, // merged into cookie-domain-broad, see comment above

  "cookie-domain-parent-on-subdomain": () => null, // duplicate of cookie-domain-broad

  "cookie-domain-set-too-loose": (_url, _headers) => {
    // Setting an explicit Domain= attribute is extremely common and not a
    // vulnerability on its own. The real issue (cross-subdomain sharing) is
    // caught by cookie-domain-broad.
    return null;
  },

  "cookie-expires-in-past": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      // Capture up to the next ';' only, NOT [^;,\s]+ -- every RFC-1123 cookie
      // date ("Thu, 01 Jan 1970 00:00:00 GMT") contains a comma and spaces, so
      // the old class stopped at "Thu", new Date("Thu") was Invalid, and this
      // check never fired on a genuinely past-dated cookie.
      const m = c.match(/expires\s*=\s*([^;]+)/i);
      if (m) {
        const value = m[1].trim();
        const d = new Date(value);
        if (!isNaN(d.getTime()) && d.getTime() < Date.now()) {
          return `Cookie '${parseCookieName(c)}' has Expires=${value} (already in the past).`;
        }
      }
    }
    return null;
  },

  "cookie-expires-too-far": (_url, headers) => {
    const cookies = getSetCookies(headers);
    // Long-lived, non-sensitive cookies (analytics, marketing, locale/theme
    // preference, consent acknowledgement) are standard practice and not a
    // vulnerability. Restrict to session/auth-like cookies, matching every
    // other per-attribute check in this file.
    const sensitive = cookies.filter((c) => {
      const name = parseCookieName(c).toLowerCase();
      return (
        name.includes("session") ||
        name.includes("token") ||
        name.includes("auth") ||
        name.includes("jwt")
      );
    });
    for (const c of sensitive) {
      // [^;]+ not [^;,\s]+: a numeric max-age has no comma/space so it is
      // unaffected, but an Expires date is an RFC-1123 string with both, which
      // the old class truncated at the weekday -- so the Expires branch below
      // never ran. Trimmed before use.
      const m = c.match(/(?:max-age|expires)\s*=\s*([^;]+)/i);
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
      if (name.startsWith("__Host-") && !cookieHasAttribute(c, "secure")) {
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
        /^connect\.sid$/i.test(name)
      ) {
        return `Cookie name '${parseCookieName(c)}' reveals backend framework.`;
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
      // SameSite=Strict or Lax on all session cookies provides CSRF
      // protection (Lax blocks cross-site POST, which covers most CSRF).
      const sessionCookies = cookies.filter((c) =>
        /session|sid|auth/i.test(parseCookieName(c).toLowerCase()),
      );
      if (sessionCookies.every((c) => /samesite\s*=\s*(strict|lax)/i.test(c)))
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

  // ── Additional attribute / naming heuristics ──────────────────────────────

  "cookie-samesite-invalid-value": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const m = c.match(/samesite\s*=\s*([^;,\s]*)/i);
      if (m && m[1]) {
        const v = m[1].toLowerCase();
        if (!["strict", "lax", "none"].includes(v)) {
          return `Cookie '${parseCookieName(c)}' has invalid SameSite value '${m[1]}' — browsers ignore or reinterpret unrecognized values instead of applying the intended protection.`;
        }
      }
    }
    return null;
  },

  "cookie-duplicate-name-different-path": (_url, headers) => {
    const cookies = getSetCookies(headers);
    const byName = new Map<string, Set<string>>();
    for (const c of cookies) {
      const name = parseCookieName(c);
      const pathMatch = c.match(/path\s*=\s*([^;,\s]+)/i);
      const path = pathMatch ? pathMatch[1] : "/";
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name)!.add(path);
    }
    for (const [name, paths] of byName) {
      if (paths.size > 1) {
        return `Cookie '${name}' is set multiple times with different Path values (${[...paths].join(", ")}) — the browser stores both, and code reading document.cookie may see the wrong one.`;
      }
    }
    return null;
  },

  "cookie-jwt-value-not-httponly": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const eq = c.indexOf("=");
      if (eq === -1) continue;
      const value = c
        .slice(eq + 1)
        .split(";")[0]
        .trim();
      if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
        if (!/httponly/i.test(c)) {
          return `Cookie '${parseCookieName(c)}' holds a JWT-shaped value but lacks HttpOnly — the token is readable via document.cookie by any injected script.`;
        }
      }
    }
    return null;
  },

  "f5-bigip-cookie-exposes-internal-ip": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (/^BIGipServer/i.test(name)) {
        return `Cookie '${name}' is an F5 BIG-IP persistence cookie — its value encodes the internal pool member's IP address and port unless the load balancer's cookie insert mode is set to encrypt it.`;
      }
    }
    return null;
  },

  "netscaler-cookie-exposes-internal-server": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (/^NSC_/i.test(name) || /^citrix_ns_id/i.test(name)) {
        return `Cookie '${name}' is a Citrix NetScaler/ADC persistence cookie — depending on configuration its value can encode the backend server's internal IP and port.`;
      }
    }
    return null;
  },

  "cookie-maxage-expires-conflict": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const maxAgeMatch = c.match(/max-age\s*=\s*(\d+)/i);
      const expiresMatch = c.match(/expires\s*=\s*([^;,]+)/i);
      if (!maxAgeMatch || !expiresMatch) continue;
      const maxAgeSecs = parseInt(maxAgeMatch[1], 10);
      const expiresDate = new Date(expiresMatch[1].trim());
      if (isNaN(expiresDate.getTime())) continue;
      const expiresSecs = (expiresDate.getTime() - Date.now()) / 1000;
      if (Math.abs(expiresSecs - maxAgeSecs) > 3600) {
        return `Cookie '${parseCookieName(c)}' has Max-Age=${maxAgeSecs}s but Expires resolves to a different lifetime (~${Math.round(expiresSecs)}s) — legacy browsers using Expires get a different session lifetime than modern ones using Max-Age.`;
      }
    }
    return null;
  },
};
