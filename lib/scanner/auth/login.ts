/**
 * Performing the login and proving it worked.
 *
 * The credential material in `EphemeralAuthInput` comes straight from the
 * scan request: nothing here loads it from a database, and nothing here
 * writes it anywhere. It exists only in memory for the length of this one
 * login attempt.
 *
 * The second half of this file is the point. A login that silently failed
 * produces a scan of the signed-out site labelled as authenticated, which
 * is worse than not having the feature at all: the user believes their
 * protected surface was checked when it was not. So every path here ends
 * in `verifySession`, which fetches a page twice, once anonymously and once
 * with the session, and refuses to call the login a success unless the two
 * differ in a way that only being signed in explains.
 *
 * Every failure string in this file is written by hand and mentions no
 * credential material. Nothing here logs.
 */

import {
  CONFIG_SCAN_AUTH_BASELINE_DIFF_BYTES,
  CONFIG_SCAN_AUTH_MAX_COOKIE_AGE_SECONDS,
  CONFIG_SCAN_AUTH_MAX_LOGIN_BODY_BYTES,
  CONFIG_SCAN_AUTH_VERIFY_TIMEOUT_MS,
} from "@/lib/config/config-values";
import { getSettings } from "@/lib/config/runtime-config";
import { safeFetch } from "@/lib/scanner/safe-fetch";
import { safeReadBody } from "@/lib/scanner/read-bounded-body";
import { SCANNER_UA_AUTHENTICATED } from "@/lib/scanner/user-agent";
import { hasPasswordInput } from "./form-parser";
import { blockedForAuthenticatedRequest } from "./logout-guard";
import { ScanSession } from "./scan-session";
import { establishBrowserFormSession } from "./browser-login";
import type { EphemeralAuthInput } from "./types";

/** Text that only a signed-in page normally carries. */
export const SIGNED_IN_MARKER =
  /(sign[\s._-]?out|log[\s._-]?out|my account|your account|dashboard|profile settings)/i;

export type EstablishSessionResult =
  { ok: true; session: ScanSession } | { ok: false; reason: string };

/**
 * Log in with credentials supplied for this one scan and return a session
 * bound to the target's origin, or a non-secret reason the login could not
 * be trusted.
 *
 * `userId` is the account the scan belongs to. Only the "form" branch uses
 * it, and only for billing and capacity: that branch opens a real
 * BrowserBase session, which is metered against the caller's live-browser
 * minutes and takes a slot from the global concurrency queue (see
 * establishBrowserFormSession). It is required rather than optional so a new
 * caller cannot open an unmetered browser by forgetting to pass it, which is
 * exactly how this path ran unbilled and uncapped before.
 */
export async function establishScanSession(
  auth: EphemeralAuthInput,
  targetUrl: string,
  userId: number,
): Promise<EstablishSessionResult> {
  const origin = originOf(targetUrl);
  if (!origin) {
    return { ok: false, reason: "The scan target is not a valid http(s) URL." };
  }

  // `??` fallback: a resolver that returns an incomplete/empty snapshot
  // (e.g. a lenient test double) must not turn "no cap resolved" into "no
  // cap enforced" -- it falls back to the same compiled constant the
  // resolver itself would use if the database and env were both empty.
  const maxCookieAgeSeconds =
    (await getSettings(["SCAN_AUTH_MAX_COOKIE_AGE_SECONDS"] as const))
      .SCAN_AUTH_MAX_COOKIE_AGE_SECONDS ??
    CONFIG_SCAN_AUTH_MAX_COOKIE_AGE_SECONDS;

  switch (auth.method) {
    case "header": {
      const headerName = auth.headerName?.trim() || "Authorization";
      const session = new ScanSession({
        origin,
        authType: "header",
        staticHeaders: { [headerName]: auth.headerValue },
        maxCookieAgeSeconds,
      });
      return finish(session, targetUrl);
    }

    case "cookie": {
      const session = new ScanSession({
        origin,
        authType: "cookie",
        maxCookieAgeSeconds,
      });
      session.jar.seed(origin, auth.cookies);
      session.adoptSessionCookies(auth.cookies.map((cookie) => cookie.name));
      return finish(session, targetUrl);
    }

    case "form": {
      const loginResult = await establishBrowserFormSession(
        auth,
        origin,
        userId,
      );
      if (!loginResult.ok) return loginResult;
      return finish(loginResult.session, targetUrl);
    }
  }
}

async function finish(
  session: ScanSession,
  targetUrl: string,
): Promise<EstablishSessionResult> {
  const verified = await verifySession(session, targetUrl);
  if (!verified.ok) return verified;
  return { ok: true, session };
}

/**
 * Prove the session is really signed in.
 *
 * Fetch the target page twice, once with no credentials and once with the
 * session, and require a difference that only signing in explains. When the
 * two responses are indistinguishable we fail rather than guess: a false
 * "authenticated" is the outcome this whole feature has to avoid. There is
 * no per-target tuning available here (no stored profile to configure it
 * on), so this heuristic has to work generically: a status change, the
 * login form disappearing, a signed-in marker appearing, or a large enough
 * size difference.
 */
export async function verifySession(
  session: ScanSession,
  targetUrl: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const origin = session.origin;
  let verifyUrl = targetUrl;

  if (!sameOrigin(verifyUrl, origin)) verifyUrl = `${origin}/`;
  if (blockedForAuthenticatedRequest(verifyUrl) !== null) {
    verifyUrl = `${origin}/`;
  }

  // `??` fallback: a resolver that returns an incomplete/empty snapshot
  // (e.g. a lenient test double) must fall back to the same compiled
  // constants the resolver itself uses when the database and env are both
  // empty, not to `undefined` -- an unfallback'd undefined here would feed
  // AbortSignal.timeout(undefined) (throws) and an uncapped read.
  const rawTimingSettings = await getSettings([
    "SCAN_AUTH_BASELINE_DIFF_BYTES",
    "SCAN_AUTH_VERIFY_TIMEOUT_MS",
    "SCAN_AUTH_MAX_LOGIN_BODY_BYTES",
  ] as const);
  const baselineDiffBytes =
    rawTimingSettings.SCAN_AUTH_BASELINE_DIFF_BYTES ??
    CONFIG_SCAN_AUTH_BASELINE_DIFF_BYTES;
  const verifyTimeoutMs =
    rawTimingSettings.SCAN_AUTH_VERIFY_TIMEOUT_MS ??
    CONFIG_SCAN_AUTH_VERIFY_TIMEOUT_MS;
  const maxLoginBodyBytes =
    rawTimingSettings.SCAN_AUTH_MAX_LOGIN_BODY_BYTES ??
    CONFIG_SCAN_AUTH_MAX_LOGIN_BODY_BYTES;

  const anonymous = await probe(
    verifyUrl,
    origin,
    undefined,
    verifyTimeoutMs,
    maxLoginBodyBytes,
  );
  const authenticated = await probe(
    verifyUrl,
    origin,
    session,
    verifyTimeoutMs,
    maxLoginBodyBytes,
  );

  if (!authenticated) {
    return {
      ok: false,
      reason: `The authenticated request to ${verifyUrl} could not be completed.`,
    };
  }

  if (session.lost) {
    return {
      ok: false,
      reason:
        session.reason ??
        "The target did not accept the session immediately after the login.",
    };
  }

  if (authenticated.status === 401 || authenticated.status === 403) {
    return {
      ok: false,
      reason: `The target answered ${authenticated.status} to the authenticated request, so the credentials were not accepted.`,
    };
  }

  if (!anonymous) {
    // No baseline to compare against. Accept only a clearly signed-in page.
    if (SIGNED_IN_MARKER.test(authenticated.body)) return { ok: true };
    return {
      ok: false,
      reason:
        "The login could not be confirmed because the target could not be reached without credentials for comparison.",
    };
  }

  const statusChanged = anonymous.status !== authenticated.status;
  const loginFormGone =
    hasPasswordInput(anonymous.body) && !hasPasswordInput(authenticated.body);
  const markerAppeared =
    SIGNED_IN_MARKER.test(authenticated.body) &&
    !SIGNED_IN_MARKER.test(anonymous.body);
  const sizeChanged =
    Math.abs(authenticated.body.length - anonymous.body.length) >=
    baselineDiffBytes;

  if (statusChanged || loginFormGone || markerAppeared || sizeChanged) {
    return { ok: true };
  }

  return {
    ok: false,
    reason:
      "The login could not be confirmed: the page looks the same signed in as signed out.",
  };
}

interface Probe {
  status: number;
  body: string;
}

async function probe(
  url: string,
  origin: string,
  session: ScanSession | undefined,
  verifyTimeoutMs: number,
  maxLoginBodyBytes: number,
): Promise<Probe | null> {
  try {
    const response = await safeFetch(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": SCANNER_UA_AUTHENTICATED,
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(verifyTimeoutMs),
      },
      [hostnameOf(origin)],
      session,
    );
    const body = await readCappedBody(
      response,
      maxLoginBodyBytes,
      verifyTimeoutMs,
    );
    return { status: response.status, body };
  } catch {
    return null;
  }
}

/**
 * True when `html` still looks like the signed-out login page: a password
 * field is present and no signed-in marker appears. Shared by the form
 * login path (HTTP or browser-driven) as the classic silent-failure check.
 */
export function looksStillSignedOut(html: string): boolean {
  return hasPasswordInput(html) && !SIGNED_IN_MARKER.test(html);
}

/**
 * Read a response body, stopping at `maxBytes` or after `timeoutMs`, whichever
 * comes first. Never throws.
 *
 * This is safeReadBody with the one extra case the login paths need: a
 * response whose `body` is null (a mocked or already-consumed one) is read
 * through `text()` instead of being treated as empty. The loop that used to
 * live here had no read timeout, so a target that answered the login or the
 * verification fetch with headers and then trickled the body held the scan
 * slot until the socket closed. `timeoutMs` defaults to safeReadBody's.
 */
export async function readCappedBody(
  response: Response,
  maxBytes: number,
  timeoutMs?: number,
): Promise<string> {
  if (!response.body) {
    try {
      return (await response.text()).slice(0, maxBytes);
    } catch {
      return "";
    }
  }
  return safeReadBody(response, maxBytes, timeoutMs);
}

export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin.toLowerCase() === origin.toLowerCase();
  } catch {
    return false;
  }
}

export function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return "";
  }
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}
