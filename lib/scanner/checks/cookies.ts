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

/**
 * Cookies whose whole purpose is to be shared across every subdomain, so a
 * site-wide `Domain=` on them is the correct configuration rather than a
 * finding: web analytics, consent/CMP state, and display preferences
 * (locale, theme, currency, timezone). None of them authenticates anyone,
 * which is the risk `cookie-domain-broad` describes.
 *
 * Matched against the cookie name only, so a session cookie is never
 * excluded by it.
 */
const SUBDOMAIN_WIDE_BY_DESIGN =
  /^(?:_ga(?:_[\w-]+)?|_gid|_gat(?:_[\w-]+)?|_gcl_[\w-]+|_dc_gtm_[\w-]+|__utm[a-z]|_fbp|_fbc|_hj[\w-]*|_clck|_clsk|_pk_(?:id|ses|ref)[\w.-]*|ajs_[\w-]+|amplitude_[\w-]*|mp_[\w-]+|__hstc|__hssrc|__hssc|hubspotutk|intercom-[\w-]+|_uetsid|_uetvid|optanonconsent|optanonalertboxclosed|euconsent-v2|cookieconsent[\w_-]*|cookie[_-]?consent|consent[_-]?mode|gdpr[\w_-]*|locale|lang|language|next_locale|i18n[\w_-]*|theme|colou?r[_-]?(?:scheme|mode)|currency|country|region|timezone|tz)$/i;

function isSubdomainWideByDesign(name: string): boolean {
  return SUBDOMAIN_WIDE_BY_DESIGN.test(name.trim());
}

/**
 * CSRF tokens that are readable by JavaScript ON PURPOSE.
 *
 * The double-submit-cookie pattern requires the page's own script to read the
 * cookie and echo it into a request header, so HttpOnly would break the
 * protection rather than add to it. Django ships `csrftoken` with
 * CSRF_COOKIE_HTTPONLY defaulting to False and its documentation says
 * HttpOnly is not a meaningful defence for it; Laravel ships `XSRF-TOKEN`
 * specifically so Axios can read it into X-XSRF-TOKEN.
 *
 * These names contain "token", so the sensitive-cookie filter below matched
 * every one of them and reported a correctly configured Django or Laravel
 * site as missing HttpOnly on an auth cookie. That is the whole framework
 * doing the right thing, reported as a defect.
 *
 * Only the HttpOnly check consults this. Secure and SameSite still apply: a
 * CSRF token sent over plain HTTP, or with no SameSite, is a real finding.
 */
const CSRF_TOKEN_READABLE_BY_DESIGN =
  /^(?:csrftoken|csrf[_-]?token|xsrf[_-]?token|_csrf|_csrf[_-]?token|ct0)$/i;

function isCsrfTokenReadableByDesign(name: string): boolean {
  return CSRF_TOKEN_READABLE_BY_DESIGN.test(name.trim());
}

export const detectors: Record<string, DetectFn> = {
  "cookie-httponly-missing": (_url, headers) => {
    const cookies = getSetCookies(headers);
    const sensitive = cookies.filter((c) => {
      const name = parseCookieName(c).toLowerCase();
      // A double-submit CSRF token has to be readable by the page's own
      // script, so HttpOnly on it would break CSRF protection rather than
      // strengthen it. Excluded here and only here: Secure and SameSite are
      // still real findings on one.
      if (isCsrfTokenReadableByDesign(name)) return false;
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
      // Analytics, consent and display-preference cookies are shared across
      // subdomains on purpose -- that is the entire reason Google Analytics
      // writes `_ga` with Domain=.example.com, and a cookie banner that did
      // not apply site-wide would be broken. They also carry nothing worth
      // stealing from a subdomain, which is the risk this check describes.
      // Skipping them leaves the session/auth cookies that the check is for.
      if (isSubdomainWideByDesign(parseCookieName(c))) continue;
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
      // Not [^;,]+. Every RFC 1123 cookie date has a comma in it
      // ("Wed, 09 Jun 2027 10:18:14 GMT"), so the old class stopped at the
      // third character and Date.parse rejected "Wed" as invalid, which made
      // this check dead code from the day it was written. The same mistake
      // has already been fixed twice in this file.
      const expiresMatch = c.match(/expires\s*=\s*([^;]+)/i);
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
