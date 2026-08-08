/**
 * An authenticated session, bound to exactly one origin.
 *
 * The whole safety story of authenticated scanning lives in this class plus
 * the hook `safeFetch` uses to call it:
 *
 *   1. `authHeadersFor` returns null for any URL outside `origin`. A
 *      redirect that leaves the origin therefore gets no cookies and no
 *      auth header. There is no code path that attaches credentials to an
 *      off-origin request, because there is no other place credentials are
 *      attached.
 *   2. `authHeadersFor` also returns null for a sign-out or destructive
 *      URL, and `safeFetch` refuses the request outright.
 *   3. `observe` watches for the target dropping the session and records
 *      it, so a scan that silently degraded to anonymous is reported rather
 *      than presented as authenticated.
 *
 * Cookie values and the static auth header value are secrets. Nothing here
 * logs them, and `describe()` deliberately reports counts, not contents.
 */

import { ScanCookieJar, readSetCookies } from "./cookie-jar";
import { blockedForAuthenticatedRequest } from "./logout-guard";
import type { ScanAuthType, ScanSessionBinding } from "./types";

export interface ScanSessionInit {
  /** Normalised origin, for example "https://app.example.com". */
  origin: string;
  authType: ScanAuthType;
  /** Path of the login page, used to spot a mid-scan bounce back to it. */
  loginPath?: string | null;
  /** Static headers such as Authorization. Values are secrets. */
  staticHeaders?: Record<string, string>;
}

function normalizeOriginOrNull(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

export class ScanSession implements ScanSessionBinding {
  readonly origin: string;
  readonly authType: ScanAuthType;
  readonly jar = new ScanCookieJar();

  private readonly staticHeaders: Record<string, string>;
  private readonly loginPath: string | null;
  /** Cookies the login handshake produced. Losing one of these means logout. */
  private sessionCookieNames: string[] = [];
  private lostReason: string | null = null;

  constructor(init: ScanSessionInit) {
    const origin = normalizeOriginOrNull(init.origin);
    if (!origin) {
      throw new Error("A scan session needs a valid http(s) origin.");
    }
    this.origin = origin;
    this.authType = init.authType;
    this.staticHeaders = { ...(init.staticHeaders ?? {}) };
    this.loginPath = init.loginPath ? normalizePath(init.loginPath) : null;
  }

  get lost(): boolean {
    return this.lostReason !== null;
  }

  get reason(): string | null {
    return this.lostReason;
  }

  /** Record that the session stopped working. The first reason wins. */
  markLost(reason: string): void {
    if (this.lostReason === null) this.lostReason = reason;
  }

  /** Freeze the current cookie set as the ones that prove we are signed in. */
  adoptSessionCookies(names: string[]): void {
    for (const name of names) {
      if (name && !this.sessionCookieNames.includes(name)) {
        this.sessionCookieNames.push(name);
      }
    }
  }

  /** True when `url` is on the origin this session is bound to. */
  inScope(url: string): boolean {
    return normalizeOriginOrNull(url) === this.origin;
  }

  authHeadersFor(url: string): Record<string, string> | null {
    // Scope check first. Everything else is irrelevant off-origin.
    if (!this.inScope(url)) return null;
    // Never hand credentials to a sign-out or destructive URL.
    if (blockedForAuthenticatedRequest(url) !== null) return null;

    const headers: Record<string, string> = { ...this.staticHeaders };
    const cookie = this.jar.headerFor(url);
    if (cookie) headers.Cookie = cookie;
    return Object.keys(headers).length > 0 ? headers : null;
  }

  observe(url: string, status: number, headers: Headers): void {
    if (!this.inScope(url)) return;

    const { cleared } = this.jar.applySetCookies(url, readSetCookies(headers));

    // The target explicitly deleted a cookie we were relying on.
    for (const name of cleared) {
      if (this.sessionCookieNames.includes(name)) {
        this.markLost(
          "The target cleared the session cookie during the scan, so the rest of the scan ran signed out.",
        );
        return;
      }
    }

    // The target rejected an authenticated request.
    if (status === 401 || status === 403) {
      this.markLost(
        `The target answered ${status} to an authenticated request, so the session was no longer accepted.`,
      );
      return;
    }

    // The target bounced us back to the login page.
    if (status >= 300 && status < 400 && this.loginPath) {
      const location = headers.get("location");
      if (location) {
        try {
          const next = new URL(location, url);
          if (normalizePath(next.pathname) === this.loginPath) {
            this.markLost(
              "The target redirected back to the login page during the scan, so the session had expired.",
            );
          }
        } catch {
          /* unparseable Location: nothing to conclude */
        }
      }
    }
  }

  /** Non-secret description, safe to log or return in a scan result. */
  describe(): {
    origin: string;
    authType: ScanAuthType;
    cookieCount: number;
    staticHeaderNames: string[];
    lost: boolean;
  } {
    return {
      origin: this.origin,
      authType: this.authType,
      cookieCount: this.jar.size,
      staticHeaderNames: Object.keys(this.staticHeaders),
      lost: this.lost,
    };
  }
}

function normalizePath(path: string): string {
  const withoutTrailing = path.replace(/\/+$/, "");
  return (withoutTrailing || "/").toLowerCase();
}
