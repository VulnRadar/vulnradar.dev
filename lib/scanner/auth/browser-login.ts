/**
 * Browser-driven form login.
 *
 * A plain `fetch` of a login page only ever sees the server-rendered HTML:
 * a React/Vue login form that the client renders after the page loads is
 * invisible to it. This module opens a real, ephemeral BrowserBase session,
 * navigates to the login page, waits for it to reach a stable loaded state
 * (the `load` event, then a quiet-network settle window so a client-side
 * fetch-then-render pattern gets a chance to finish too), and only then
 * looks for a login form.
 *
 * The browser's job stops there. It never types into or submits the form
 * itself: instead, the rendered HTML is handed to the same
 * `findLoginFormCandidates` tokenizer the plain-HTTP path already used, and
 * the login is submitted as a normal HTTP POST through `safeFetch`, carrying
 * forward any cookies the browser picked up while rendering the page (a
 * challenge-clearance cookie, a session-priming cookie set by client JS,
 * etc). This keeps the actual credential submission, CSRF handling, and
 * post-submit verification on the same well-tested code path
 * `verifySession`/`looksStillSignedOut` already implement, and keeps the
 * browser session itself short-lived: it exists only long enough to render
 * one page and read its cookies, then it is torn down.
 *
 * Ambiguity is never guessed through. If the rendered page holds more than
 * one distinct login-shaped form, or a bot-mitigation challenge page instead
 * of the real site, this fails with a specific, honest reason rather than
 * picking one and hoping.
 */

import {
  createBrowserSession,
  endBrowserSession,
  openCdpPageSession,
  type CdpConnection,
} from "@/lib/browserbase/client";
import { APP_NAME } from "@/lib/config/constants";
import {
  CONFIG_SCAN_AUTH_BROWSER_MAX_HTML_CHARS,
  CONFIG_SCAN_AUTH_BROWSER_MAX_WAIT_MS,
  CONFIG_SCAN_AUTH_BROWSER_NAV_TIMEOUT_MS,
  CONFIG_SCAN_AUTH_BROWSER_SESSION_TIMEOUT_SECONDS,
  CONFIG_SCAN_AUTH_BROWSER_SETTLE_MS,
  CONFIG_SCAN_AUTH_MAX_LOGIN_BODY_BYTES,
} from "@/lib/config/config-values";
import { safeFetch, validateScanTarget } from "@/lib/scanner/safe-fetch";
import { extractMetaCsrfToken, findLoginFormCandidates } from "./form-parser";
import {
  hostnameOf,
  looksStillSignedOut,
  readCappedBody,
  sameOrigin,
} from "./login";
import { ScanSession } from "./scan-session";
import type { BrowserCookie } from "./cookie-jar";
import type { EphemeralFormAuth } from "./types";
import type { EstablishSessionResult } from "./login";

const USER_AGENT = `${APP_NAME}/1.0 (Security Scanner; Authenticated)`;

function fail(reason: string): EstablishSessionResult {
  return { ok: false, reason };
}

/** Title/body markers a Cloudflare (or similar) JS/interstitial challenge shows. */
const CHALLENGE_TITLE_MARKERS = [
  /just a moment/i,
  /attention required.*cloudflare/i,
  /checking your browser/i,
  /verifying you are human/i,
  /one more step/i,
  /please wait.*redirecting/i,
];

const CHALLENGE_BODY_MARKERS = [
  /cf-chl/i,
  /cf_chl_opt/i,
  /cf-turnstile/i,
  /challenge-platform/i,
  /enable javascript and cookies to continue/i,
  /cf-browser-verification/i,
];

const CAPTCHA_WIDGET_MARKERS = [/g-recaptcha/i, /grecaptcha/i, /hcaptcha/i];
const CAPTCHA_PROMPT_MARKERS =
  /verify you are human|prove you are human|i'?m not a robot|complete the captcha/i;

const CLOUDFLARE_MESSAGE =
  "This site is protected by Cloudflare's bot challenge, which blocks automated login. We can't authenticate or scan behind it right now.";
const CAPTCHA_MESSAGE =
  "This site presented a CAPTCHA challenge that blocks automated login.";

/**
 * Look for evidence the browser landed on a bot-mitigation challenge page
 * instead of the real site. Returns a user-facing reason, or null when
 * nothing suggests a challenge is in the way.
 */
export function detectChallenge(input: {
  title: string;
  html: string;
  status?: number;
  headers?: Record<string, string>;
}): string | null {
  const headerKeys = Object.keys(input.headers ?? {}).map((k) =>
    k.toLowerCase(),
  );
  if (headerKeys.includes("cf-mitigated")) return CLOUDFLARE_MESSAGE;

  if (CHALLENGE_TITLE_MARKERS.some((re) => re.test(input.title))) {
    return CLOUDFLARE_MESSAGE;
  }

  const statusSuggestsChallenge = input.status === 403 || input.status === 503;
  if (
    statusSuggestsChallenge &&
    CHALLENGE_BODY_MARKERS.some((re) => re.test(input.html))
  ) {
    return CLOUDFLARE_MESSAGE;
  }
  // A challenge marker in the body is a strong enough signal on its own,
  // status code or not: the JS challenge page itself is always served with
  // this markup regardless of what status a proxy in front of it reports.
  if (CHALLENGE_BODY_MARKERS.some((re) => re.test(input.html))) {
    return CLOUDFLARE_MESSAGE;
  }

  const hasCaptchaWidget = CAPTCHA_WIDGET_MARKERS.some((re) =>
    re.test(input.html),
  );
  if (hasCaptchaWidget && CAPTCHA_PROMPT_MARKERS.test(input.html)) {
    return CAPTCHA_MESSAGE;
  }

  return null;
}

interface NetworkResponseInfo {
  url: string;
  status: number;
  headers: Record<string, string>;
}

/**
 * Navigate to `url` and wait for it to reach a stable loaded state: the
 * `load` event, then a quiet-network window so a client-rendered form
 * (fetched via XHR after `load`) gets a chance to appear too.
 *
 * Returns the responses observed (used for challenge detection against the
 * main document) and whether the page is considered settled.
 */
async function navigateAndWaitForLoad(
  cdp: CdpConnection,
  url: string,
): Promise<{ settled: boolean; responses: NetworkResponseInfo[] }> {
  const responses: NetworkResponseInfo[] = [];
  let loadFired = false;
  let lastActivity = Date.now();

  cdp.on("Page.loadEventFired", () => {
    loadFired = true;
  });
  cdp.on("Network.requestWillBeSent", () => {
    lastActivity = Date.now();
  });
  cdp.on("Network.responseReceived", (params) => {
    lastActivity = Date.now();
    const response = params.response as
      | { url?: string; status?: number; headers?: Record<string, string> }
      | undefined;
    if (response?.url) {
      responses.push({
        url: response.url,
        status: response.status ?? 0,
        headers: response.headers ?? {},
      });
    }
  });

  await cdp.send("Page.navigate", { url });

  const deadline = Date.now() + CONFIG_SCAN_AUTH_BROWSER_MAX_WAIT_MS;
  const navDeadline = Date.now() + CONFIG_SCAN_AUTH_BROWSER_NAV_TIMEOUT_MS;

  // Wait for the load event, or give up once the nav timeout passes.
  while (!loadFired && Date.now() < navDeadline && Date.now() < deadline) {
    await sleep(100);
  }

  if (!loadFired) {
    return { settled: false, responses };
  }

  // Settle: wait until the network has been quiet for the settle window,
  // capped by the overall deadline.
  while (Date.now() < deadline) {
    if (Date.now() - lastActivity >= CONFIG_SCAN_AUTH_BROWSER_SETTLE_MS) {
      return { settled: true, responses };
    }
    await sleep(100);
  }

  // Ran out of time waiting for the network to go quiet, but `load` did
  // fire, so there is a real page to inspect.
  return { settled: true, responses };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readRenderedPage(
  cdp: CdpConnection,
): Promise<{ title: string; html: string } | null> {
  try {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        title: document.title || "",
        html: document.documentElement ? document.documentElement.outerHTML.slice(0, ${CONFIG_SCAN_AUTH_BROWSER_MAX_HTML_CHARS}) : "",
      })`,
      returnByValue: true,
    });
    const value = (result.result as { value?: unknown } | undefined)?.value;
    if (typeof value !== "string") return null;
    const parsed = JSON.parse(value) as { title: string; html: string };
    return parsed;
  } catch {
    return null;
  }
}

async function readBrowserCookies(
  cdp: CdpConnection,
  origin: string,
): Promise<BrowserCookie[]> {
  try {
    const result = await cdp.send("Network.getCookies", { urls: [origin] });
    const cookies = result.cookies as
      | Array<{
          name: string;
          value: string;
          domain: string;
          path?: string;
          secure?: boolean;
          expires?: number;
        }>
      | undefined;
    return cookies ?? [];
  } catch {
    return [];
  }
}

/**
 * Run the browser-driven login handshake and return a session seeded with
 * whatever the browser and the subsequent HTTP login POST produced, or a
 * specific, honest failure reason.
 *
 * Takes an already-open `CdpConnection` so the whole flow is testable
 * against a fake connection without touching a real WebSocket or
 * BrowserBase session — see tests/lib/scanner/auth/browser-login.test.ts.
 */
export async function runLoginOverCdp(
  cdp: CdpConnection,
  auth: EphemeralFormAuth,
  origin: string,
): Promise<EstablishSessionResult> {
  const loginUrl = auth.loginUrl || `${origin}/login`;
  if (!sameOrigin(loginUrl, origin)) {
    return fail(`The login page must be on ${origin}.`);
  }

  const safety = await validateScanTarget(loginUrl);
  if (!safety.safe) {
    return fail(safety.reason || "The login page could not be safely reached.");
  }

  try {
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
  } catch {
    return fail("Could not prepare the browser session for navigation.");
  }

  const { settled, responses } = await navigateAndWaitForLoad(cdp, loginUrl);
  if (!settled) {
    return fail(
      `The login page at ${loginUrl} did not finish loading within ${Math.round(
        CONFIG_SCAN_AUTH_BROWSER_NAV_TIMEOUT_MS / 1000,
      )}s.`,
    );
  }

  const rendered = await readRenderedPage(cdp);
  if (!rendered) {
    return fail("Could not read the rendered login page.");
  }

  const mainResponse =
    responses.find((r) => stripQuery(r.url) === stripQuery(loginUrl)) ??
    responses[0];
  const challenge = detectChallenge({
    title: rendered.title,
    html: rendered.html,
    status: mainResponse?.status,
    headers: mainResponse?.headers,
  });
  if (challenge) return fail(challenge);

  const candidates = findLoginFormCandidates(rendered.html, loginUrl, {
    configuredIdentifier: auth.usernameField,
    configuredSecret: auth.passwordField,
  });

  if (candidates.length === 0) {
    return fail(
      "No login form with a password field was found on the page, even after it fully loaded and any client-side content rendered.",
    );
  }

  const distinct = dedupeCandidates(candidates);
  if (distinct.length > 1) {
    const actions = distinct.map((c) => c.action).join(", ");
    return fail(
      `Found ${distinct.length} candidate login forms on the page and could not tell which one to use (actions: ${actions}). Set the login URL and field names to disambiguate.`,
    );
  }

  const form = distinct[0];
  if (!sameOrigin(form.action, origin)) {
    return fail(
      "The login form submits to a different host, which this scanner will not do.",
    );
  }

  const session = new ScanSession({
    origin,
    authType: "form",
    loginPath: pathnameOf(loginUrl),
  });

  const browserCookies = await readBrowserCookies(cdp, origin);
  const seededNames = session.jar.seedFromBrowser(
    hostnameOf(origin),
    browserCookies,
  );
  if (seededNames.length > 0) session.adoptSessionCookies(seededNames);

  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(form.hiddenFields)) {
    body.set(name, value);
  }
  body.set(form.identifierField, auth.username);
  body.set(form.secretField, auth.password);

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "text/html,application/xhtml+xml",
    Referer: loginUrl,
    Origin: origin,
  };
  const metaCsrf = extractMetaCsrfToken(rendered.html);
  if (metaCsrf) headers["X-CSRF-Token"] = metaCsrf;
  const xsrfCookie = session.jar.valueOf("XSRF-TOKEN");
  if (xsrfCookie) headers["X-XSRF-TOKEN"] = safeDecode(xsrfCookie);

  const cookiesBefore = session.jar.headerFor(`${origin}/`) ?? "";

  let loginResponse: Response;
  try {
    loginResponse = await safeFetch(
      form.action,
      {
        method: form.method,
        headers,
        body: form.method === "POST" ? body.toString() : undefined,
        signal: AbortSignal.timeout(CONFIG_SCAN_AUTH_BROWSER_NAV_TIMEOUT_MS),
      },
      [hostnameOf(origin)],
      session,
    );
  } catch {
    return fail("The login request could not be completed.");
  }

  if (loginResponse.status >= 400) {
    return fail(
      `The target rejected the login request with ${loginResponse.status}.`,
    );
  }

  const loginBody = await readCappedBody(
    loginResponse,
    CONFIG_SCAN_AUTH_MAX_LOGIN_BODY_BYTES,
  );

  const cookiesAfter = session.jar.headerFor(`${origin}/`) ?? "";
  if (cookiesAfter === cookiesBefore) {
    return fail(
      "The login did not set or change any cookie, so no session was created. Check the credentials and the field names.",
    );
  }
  session.adoptSessionCookies(session.jar.names());

  if (looksStillSignedOut(loginBody)) {
    return fail(
      "The target still showed a login form after the credentials were submitted, so the login was rejected.",
    );
  }

  return { ok: true, session };
}

/**
 * Open a BrowserBase session, run the login handshake, and always tear the
 * browser session down afterward, success or failure.
 */
export async function establishBrowserFormSession(
  auth: EphemeralFormAuth,
  origin: string,
): Promise<EstablishSessionResult> {
  let sessionId: string | null = null;
  try {
    const bbSession = await createBrowserSession({
      timeoutSeconds: CONFIG_SCAN_AUTH_BROWSER_SESSION_TIMEOUT_SECONDS,
      keepAlive: false,
    });
    sessionId = bbSession.id;
    const connectUrl = bbSession.connectUrl;
    if (!connectUrl) {
      return fail("Could not open a browser session to attempt the login.");
    }

    const cdp = await openCdpPageSession(
      connectUrl,
      CONFIG_SCAN_AUTH_BROWSER_NAV_TIMEOUT_MS,
    );
    if (!cdp) {
      return fail(
        "Browser-driven login is not available on this deployment right now.",
      );
    }
    try {
      return await runLoginOverCdp(cdp, auth, origin);
    } finally {
      cdp.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return fail(
      `Could not start a browser session to attempt the login: ${message}`,
    );
  } finally {
    if (sessionId) await endBrowserSession(sessionId);
  }
}

function dedupeCandidates<
  T extends { action: string; secretField: string; identifierField: string },
>(candidates: T[]): T[] {
  const seen = new Set<string>();
  const distinct: T[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.action}::${candidate.identifierField}::${candidate.secretField}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(candidate);
  }
  return distinct;
}

function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
