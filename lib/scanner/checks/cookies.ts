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
};
