/**
 * Authenticated scanning: shared types.
 *
 * Ephemeral model. There is no stored credential anywhere in this codebase:
 * a caller supplies login material directly in a single scan request, it
 * lives in memory for the length of that one request, and it is never
 * written to a table, a log line, an audit record, or the persisted scan
 * result. `EphemeralAuthInput` is the only type here that ever carries
 * plaintext credential material.
 */

/** How the scanner obtains an authenticated session for this one scan. */
export type ScanAuthType = "form" | "header" | "cookie";

/**
 * A one-time form login: submit a username/password into a login page.
 * `loginUrl` defaults to `${origin}/login` when omitted. `usernameField`
 * and `passwordField` only need to be set when auto-detection of the
 * rendered login form picks the wrong input.
 */
export interface EphemeralFormAuth {
  method: "form";
  username: string;
  password: string;
  loginUrl?: string;
  usernameField?: string;
  passwordField?: string;
}

/** A one-time static header, for example a bearer token. */
export interface EphemeralHeaderAuth {
  method: "header";
  headerName?: string;
  headerValue: string;
}

/** One-time session cookie injection. */
export interface EphemeralCookieAuth {
  method: "cookie";
  cookies: Array<{ name: string; value: string }>;
}

/**
 * Login material for a single scan request. Never persisted, never logged,
 * never echoed back in a response or an error message.
 */
export type EphemeralAuthInput =
  EphemeralFormAuth | EphemeralHeaderAuth | EphemeralCookieAuth;

/**
 * The contract `safeFetch` uses to attach an authenticated session to a
 * request. Declaring it here keeps `safe-fetch.ts` free of any runtime
 * dependency on the rest of this directory.
 */
export interface ScanSessionBinding {
  /** Origin the session is bound to, for example "https://app.example.com". */
  readonly origin: string;
  /**
   * Headers to attach when requesting `url`, or null when `url` is outside
   * the session's scope. Returning null is what stops a session from
   * following a redirect off-origin.
   */
  authHeadersFor(url: string): Record<string, string> | null;
  /**
   * Absorb a response for an in-scope URL: store new cookies and look for
   * evidence that the session has been dropped by the target.
   */
  observe(url: string, status: number, headers: Headers): void;
  /** True once the session is known to have stopped working mid-scan. */
  readonly lost: boolean;
}

/** What the scan reports back to the user about its authentication state. */
export interface ScanAuthReport {
  /**
   * "authenticated": logged in and still logged in at the end.
   * "lost": logged in, then the target dropped the session mid-scan.
   * "failed": the login never worked. The scan does not run.
   */
  status: "authenticated" | "lost" | "failed";
  method: ScanAuthType;
  /** Non-secret explanation, present for "lost" and "failed". */
  reason?: string;
}
