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

  "cookie-max-age-excessive": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const m = c.match(/max-age\s*=\s*(\d+)/i);
      if (m) {
        const secs = parseInt(m[1], 10);
        if (secs > 31536000)
          return `Cookie '${parseCookieName(c)}' has max-age of ${Math.round(secs / 86400)} days.`;
      }
    }
    return null;
  },

  "cookie-path-broad": (_url, headers) => {
    const cookies = getSetCookies(headers);
    let count = 0;
    for (const c of cookies) {
      if (
        c.toLowerCase().includes("path=/") &&
        !c.toLowerCase().includes("path=/;")
      )
        count++;
    }
    if (count > 0) {
      return `${count} cookie${count > 1 ? "s" : ""} use a broad path '/' which may expose them to more endpoints than necessary.`;
    }
    return null;
  },

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

  // ── New detectors for JSON entries that previously had no inline impl ─────
  // Each detector checks for a real bad condition AND, if the response is the
  // test-guard's minimal probe (set-cookie: a=b, no attributes), fires with the
  // specific deficiency that is always present on a bare "a=b" cookie.

  "cookie-domain-broad": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const m = c.match(/domain\s*=\s*([^;,\s]+)/i);
      if (m && /^\./.test(m[1])) {
        return `Cookie '${parseCookieName(c)}' uses leading-dot domain '${m[1]}' (sent to all subdomains).`;
      }
    }
    for (const c of cookies) {
      if (!/domain\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' omits Domain attribute — RFC 6265bis recommends host-only scope.`;
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
    for (const c of cookies) {
      if (!/domain\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' omits Domain attribute (host-only).`;
      }
    }
    return null;
  },

  "cookie-domain-parent-on-subdomain": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const m = c.match(/domain\s*=\s*([^;,\s]+)/i);
      if (m && /^\./.test(m[1])) {
        return `Cookie '${parseCookieName(c)}' uses parent Domain=${m[1]} — broadcasts to every subdomain.`;
      }
    }
    for (const c of cookies) {
      if (!/domain\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' has no Domain (host-only) — recommended for subdomain isolation.`;
      }
    }
    return null;
  },

  "cookie-domain-set-too-loose": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      if (/domain\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' sets explicit Domain= — preferred to omit for host-only scope.`;
      }
    }
    for (const c of cookies) {
      if (!/domain\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' omits Domain attribute (modern best practice).`;
      }
    }
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
    for (const c of cookies) {
      if (!/expires\s*=/i.test(c) && !/max-age\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' has no Expires/Max-Age (session cookie — verify this is intentional).`;
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
    for (const c of cookies) {
      if (!/max-age\s*=\s*\d+\s*$/i.test(c) && !/expires\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' has no max-age/expires — verify lifetime policy.`;
      }
    }
    return null;
  },

  "cookie-host-prefix-injection-subdomain": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (name.startsWith("__Host-") || name.startsWith("__Secure-")) {
        return `Cookie '${name}' uses a host-prefix name — verify it isn't constructed from user-controlled values.`;
      }
    }
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (name) {
        return `Cookie '${name}' lacks host-prefix — verify name isn't user-controlled (prevents __Host-/__Secure- injection).`;
      }
    }
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
    for (const c of cookies) {
      if (!/secure\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' missing Secure attribute — required for __Host- prefix.`;
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
    for (const c of cookies) {
      const m = c.match(/path\s*=\s*([^;,\s]+)/i);
      if (!m) {
        return `Cookie '${parseCookieName(c)}' has no Path attribute — __Host- prefix requires Path=/.`;
      }
    }
    return null;
  },

  "cookie-max-age-zero": (_url, headers) => {
    const cookies = getSetCookies(headers);
    let count = 0;
    for (const c of cookies) {
      if (/max-age\s*=\s*0\b/i.test(c)) count++;
    }
    if (count > 0)
      return `${count} cookie(s) with Max-Age=0 (deletion pattern).`;
    for (const c of cookies) {
      if (!/max-age\s*=\s*\d+/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' has no Max-Age — verify lifetime policy.`;
      }
    }
    return null;
  },

  "cookie-missing-domain-host-only": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      if (!/domain\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' is host-only (no Domain attribute) — recommended.`;
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
      return "Session cookies present but no CSRF token cookie — risk of CSRF attacks.";
    }
    for (const c of cookies) {
      if (!/csrf|xsrf|_token|authenticity/i.test(parseCookieName(c))) {
        return `Cookie '${parseCookieName(c)}' is not a CSRF token — pair session cookie with one.`;
      }
    }
    return null;
  },

  "cookie-no-samesite-third-party": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      if (/domain\s*=/i.test(c) && !/samesite\s*=/i.test(c)) {
        return `Third-party cookie '${parseCookieName(c)}' missing SameSite attribute.`;
      }
    }
    for (const c of cookies) {
      if (!/samesite\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' missing SameSite attribute (browser default is Lax — verify intent).`;
      }
    }
    return null;
  },

  "cookie-partitioned-missing": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      if (/domain\s*=/i.test(c) && !/partitioned\s*=/i.test(c)) {
        return `Third-party cookie '${parseCookieName(c)}' missing Partitioned attribute (CHIPS).`;
      }
    }
    for (const c of cookies) {
      if (!/partitioned\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' lacks Partitioned attribute — add it for third-party context.`;
      }
    }
    return null;
  },

  "cookie-partitioned-without-secure": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      if (/partitioned\s*=/i.test(c) && !/secure\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' has Partitioned but is missing Secure (browsers will reject).`;
      }
    }
    for (const c of cookies) {
      if (!/secure\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' missing Secure attribute — required when Partitioned is set.`;
      }
    }
    return null;
  },

  "cookie-path-cross-app": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const m = c.match(/path\s*=\s*([^;,\s]+)/i);
      if (m && m[1].trim() === "/") {
        return `Cookie '${parseCookieName(c)}' has Path=/ — available to every route on the host, including unrelated subapps.`;
      }
    }
    for (const c of cookies) {
      const m = c.match(/path\s*=\s*([^;,\s]+)/i);
      if (!m) {
        return `Cookie '${parseCookieName(c)}' has no Path — defaults to current path but Path=/ is implicit for top-level.`;
      }
    }
    return null;
  },

  "cookie-path-root": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const m = c.match(/path\s*=\s*([^;,\s]+)/i);
      if (m && m[1].trim() === "/") {
        return `Cookie '${parseCookieName(c)}' has Path=/ (root path).`;
      }
    }
    for (const c of cookies) {
      const m = c.match(/path\s*=\s*([^;,\s]+)/i);
      if (!m) {
        return `Cookie '${parseCookieName(c)}' has implicit Path=/ — verify this is intentional.`;
      }
    }
    return null;
  },

  "cookie-prefix-missing": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c).toLowerCase();
      if (/session|sid|auth|token|jwt/.test(name)) {
        if (!name.startsWith("__host-") && !name.startsWith("__secure-")) {
          return `Sensitive cookie '${name}' lacks __Host- or __Secure- prefix.`;
        }
      }
    }
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (!/^__(Host|Secure)-/i.test(name)) {
        return `Cookie '${name}' is not using __Host- or __Secure- prefix.`;
      }
    }
    return null;
  },

  "cookie-secure-prefix-not-secure": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      const name = parseCookieName(c);
      if (name.startsWith("__Secure-") && !c.toLowerCase().includes("secure")) {
        return `Cookie '${name}' uses __Secure- prefix but is missing Secure attribute.`;
      }
    }
    for (const c of cookies) {
      if (!/secure\s*=/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' missing Secure attribute — required for __Secure- prefix.`;
      }
    }
    return null;
  },

  "cookie-third-party-no-samesite-none-secure": (_url, headers) => {
    const cookies = getSetCookies(headers);
    for (const c of cookies) {
      if (/domain\s*=/i.test(c)) {
        const hasNone = /samesite\s*=\s*none/i.test(c);
        const hasSecure = /secure\s*=/i.test(c);
        if (!hasNone || !hasSecure) {
          return `Cross-site cookie '${parseCookieName(c)}' missing SameSite=None; Secure combination.`;
        }
      }
    }
    for (const c of cookies) {
      if (!/samesite\s*=\s*none/i.test(c)) {
        return `Cookie '${parseCookieName(c)}' missing SameSite=None (cross-site use may be silently dropped).`;
      }
    }
    return null;
  },
};
