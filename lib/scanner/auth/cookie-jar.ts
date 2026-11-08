/**
 * A small cookie jar for authenticated scanning.
 *
 * This is deliberately not a general-purpose RFC 6265 implementation. It
 * exists to hold the cookies one target hands us during a login and to hand
 * them back on subsequent requests to that same target. Every rule here
 * errs toward sending a cookie to fewer places rather than more:
 *
 *   - A Domain attribute is only accepted when the requesting host is that
 *     domain or a subdomain of it. A target cannot set a cookie for a
 *     sibling or a parent it does not control.
 *   - A Secure cookie is never sent over plain http.
 *   - Every cookie expires at most CONFIG_SCAN_AUTH_MAX_COOKIE_AGE_SECONDS
 *     from now, no matter what the target asked for, so nothing outlives a
 *     scan.
 *
 * Cookie values are secrets. Nothing in this file logs, stringifies, or
 * otherwise exposes a value: `names()` returns names only.
 */

import { CONFIG_SCAN_AUTH_MAX_COOKIE_AGE_SECONDS } from "@/lib/config/config-values";

interface StoredCookie {
  name: string;
  value: string;
  /** Lowercased host the cookie is scoped to, with no leading dot. */
  domain: string;
  /** True when the cookie had no Domain attribute: exact host match only. */
  hostOnly: boolean;
  path: string;
  secure: boolean;
  /** Epoch milliseconds, or null for a session cookie. */
  expiresAt: number | null;
}

/** Shape returned by CDP's `Network.getCookies`. */
export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  /** Epoch seconds, or absent/-1 for a session cookie. */
  expires?: number;
}

function cookieKey(c: Pick<StoredCookie, "name" | "domain" | "path">): string {
  return `${c.domain}\u0000${c.path}\u0000${c.name}`;
}

/**
 * Default path per RFC 6265 5.1.4: the request path up to, but not
 * including, the rightmost slash.
 */
function defaultPath(pathname: string): string {
  if (!pathname.startsWith("/")) return "/";
  const lastSlash = pathname.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return pathname.slice(0, lastSlash);
}

/** RFC 6265 5.1.4 path matching. */
function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  if (cookiePath.endsWith("/")) return true;
  return requestPath[cookiePath.length] === "/";
}

/** True when `host` is `domain` or a subdomain of it. */
function domainMatches(host: string, domain: string): boolean {
  if (host === domain) return true;
  return host.endsWith(`.${domain}`);
}

export class ScanCookieJar {
  private readonly cookies = new Map<string, StoredCookie>();
  /**
   * Admin-configurable via SCAN_AUTH_MAX_COOKIE_AGE_SECONDS. Defaults to the
   * compiled constant so a caller that doesn't resolve the live setting
   * (tests, or any code that predates this parameter) keeps today's
   * behavior. Production call sites (lib/scanner/auth/login.ts,
   * lib/scanner/auth/browser-login.ts) resolve the live value via
   * getSetting()/getSettings() and pass it in here, since this class's own
   * methods are synchronous and cannot await the resolver themselves.
   */
  private readonly maxCookieAgeSeconds: number;

  constructor(
    maxCookieAgeSeconds: number = CONFIG_SCAN_AUTH_MAX_COOKIE_AGE_SECONDS,
  ) {
    this.maxCookieAgeSeconds = maxCookieAgeSeconds;
  }

  /** Names of every cookie currently held. Values are never exposed. */
  names(): string[] {
    return [...this.cookies.values()].map((c) => c.name);
  }

  get size(): number {
    return this.cookies.size;
  }

  has(name: string): boolean {
    for (const c of this.cookies.values()) {
      if (c.name === name) return true;
    }
    return false;
  }

  /**
   * Seed the jar with cookies the user supplied directly (cookie injection).
   * They are bound to the exact host of `origin` and to path "/".
   */
  seed(origin: string, cookies: Array<{ name: string; value: string }>): void {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return;
    }
    const host = parsed.hostname.toLowerCase();
    const secure = parsed.protocol === "https:";
    for (const { name, value } of cookies) {
      if (!name) continue;
      const stored: StoredCookie = {
        name,
        value,
        domain: host,
        hostOnly: true,
        path: "/",
        secure,
        expiresAt: null,
      };
      this.cookies.set(cookieKey(stored), stored);
    }
  }

  /**
   * Seed the jar with cookies read out of a real browser session (CDP
   * `Network.getCookies`), after a browser-driven login handshake. Only
   * cookies whose Domain is `host` itself or a domain `host` is a subdomain
   * of are accepted — the same domain-scoping guard `applyOne` enforces for
   * a Set-Cookie header, applied here because a real browser can pick up
   * cookies for the exact navigated host that this jar must still not hand
   * to an unrelated one. Returns the names accepted.
   */
  seedFromBrowser(host: string, cookies: BrowserCookie[]): string[] {
    const accepted: string[] = [];
    const lowerHost = host.toLowerCase();
    const ceiling = Date.now() + this.maxCookieAgeSeconds * 1000;

    for (const cookie of cookies) {
      if (!cookie.name) continue;
      const domain = cookie.domain.replace(/^\./, "").toLowerCase();
      if (!domain) continue;
      if (!domainMatches(lowerHost, domain)) continue;

      const expiresAt =
        typeof cookie.expires === "number" && cookie.expires > 0
          ? Math.min(cookie.expires * 1000, ceiling)
          : ceiling;

      const stored: StoredCookie = {
        name: cookie.name,
        value: cookie.value,
        domain,
        hostOnly: domain === lowerHost,
        path: cookie.path && cookie.path.startsWith("/") ? cookie.path : "/",
        secure: !!cookie.secure,
        expiresAt,
      };
      this.cookies.set(cookieKey(stored), stored);
      accepted.push(cookie.name);
    }
    return accepted;
  }

  /**
   * Apply every Set-Cookie header from a response.
   * Returns the names of cookies that were newly created or changed, and the
   * names of cookies the target explicitly cleared.
   */
  applySetCookies(
    requestUrl: string,
    headers: string[],
  ): { stored: string[]; cleared: string[] } {
    const stored: string[] = [];
    const cleared: string[] = [];
    for (const header of headers) {
      const outcome = this.applyOne(requestUrl, header);
      const name = parseCookieName(header);
      if (!name) continue;
      if (outcome === "stored" && !stored.includes(name)) stored.push(name);
      if (outcome === "cleared" && !cleared.includes(name)) cleared.push(name);
    }
    return { stored, cleared };
  }

  private applyOne(
    requestUrl: string,
    header: string,
  ): "stored" | "cleared" | "rejected" {
    let request: URL;
    try {
      request = new URL(requestUrl);
    } catch {
      return "rejected";
    }

    const parts = header.split(";");
    const nameValue = parts.shift();
    if (!nameValue) return "rejected";
    const eq = nameValue.indexOf("=");
    if (eq <= 0) return "rejected";
    const name = nameValue.slice(0, eq).trim();
    const value = nameValue.slice(eq + 1).trim();
    if (!name) return "rejected";

    const requestHost = request.hostname.toLowerCase();
    let domain = requestHost;
    let hostOnly = true;
    let path = defaultPath(request.pathname);
    let secure = false;
    let expiresAt: number | null = null;
    let sawMaxAge = false;

    for (const attr of parts) {
      const sep = attr.indexOf("=");
      const key = (sep === -1 ? attr : attr.slice(0, sep)).trim().toLowerCase();
      const raw = sep === -1 ? "" : attr.slice(sep + 1).trim();

      if (key === "domain" && raw) {
        const candidate = raw.replace(/^\./, "").toLowerCase();
        // Reject a Domain the requesting host is not part of. This is the
        // guard that stops a target from minting cookies for hosts it does
        // not control.
        if (!candidate || !domainMatches(requestHost, candidate)) {
          return "rejected";
        }
        domain = candidate;
        hostOnly = false;
      } else if (key === "path" && raw.startsWith("/")) {
        path = raw;
      } else if (key === "secure") {
        secure = true;
      } else if (key === "max-age") {
        const seconds = Number.parseInt(raw, 10);
        if (Number.isFinite(seconds)) {
          sawMaxAge = true;
          expiresAt = seconds <= 0 ? 0 : Date.now() + seconds * 1000;
        }
      } else if (key === "expires" && !sawMaxAge && raw) {
        const parsedDate = Date.parse(raw);
        if (!Number.isNaN(parsedDate)) expiresAt = parsedDate;
      }
    }

    const candidate: StoredCookie = {
      name,
      value,
      domain,
      hostOnly,
      path,
      secure,
      expiresAt,
    };
    const key = cookieKey(candidate);

    // An expiry in the past, or an empty value, is the standard way a
    // target deletes a cookie. Treat both as a logout signal.
    const isDeletion =
      (expiresAt !== null && expiresAt <= Date.now()) || value === "";
    if (isDeletion) {
      this.cookies.delete(key);
      return "cleared";
    }

    // Cap the lifetime so nothing survives past the scan that created it.
    const ceiling = Date.now() + this.maxCookieAgeSeconds * 1000;
    candidate.expiresAt =
      expiresAt === null ? ceiling : Math.min(expiresAt, ceiling);

    this.cookies.set(key, candidate);
    return "stored";
  }

  /**
   * Build the Cookie header for a URL, or null when no cookie applies.
   * Expired entries are dropped as a side effect.
   */
  headerFor(url: string): string | null {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return null;
    }
    const host = target.hostname.toLowerCase();
    const isSecure = target.protocol === "https:";
    const now = Date.now();
    const matched: StoredCookie[] = [];

    for (const [key, cookie] of this.cookies) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
        this.cookies.delete(key);
        continue;
      }
      if (cookie.secure && !isSecure) continue;
      if (cookie.hostOnly) {
        if (host !== cookie.domain) continue;
      } else if (!domainMatches(host, cookie.domain)) {
        continue;
      }
      if (!pathMatches(target.pathname || "/", cookie.path)) continue;
      matched.push(cookie);
    }

    if (matched.length === 0) return null;
    // Longer paths first, per RFC 6265 5.4.
    matched.sort((a, b) => b.path.length - a.path.length);
    return matched.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  /** Read a single cookie value. Used only to echo a CSRF cookie back. */
  valueOf(name: string): string | null {
    for (const cookie of this.cookies.values()) {
      if (cookie.name === name) return cookie.value;
    }
    return null;
  }
}

function parseCookieName(header: string): string {
  const first = header.split(";")[0] ?? "";
  const eq = first.indexOf("=");
  return eq <= 0 ? "" : first.slice(0, eq).trim();
}
