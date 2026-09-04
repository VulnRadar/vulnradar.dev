/**
 * Browser-driven form login tests.
 *
 * The browser-session boundary is `CdpConnection` (send/on/close): tests
 * exercise `runLoginOverCdp` against a fake connection that never touches a
 * real WebSocket or BrowserBase session, matching this repo's rule to mock
 * at the network/session boundary and no lower. `establishBrowserFormSession`
 * (the outer wrapper that opens and always tears down the real session) is
 * covered separately by mocking lib/browserbase/client, one level up.
 *
 * `dns/promises` and `fetch` are mocked the same way tests/lib/scanner/auth/
 * login.test.ts mocks them, since the login POST and the post-login
 * `verifySession` both go through the real `safeFetch`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

// lib/browserbase/client.ts (imported below, unmocked -- only
// establishBrowserFormSession is mocked out one level up) now resolves
// BROWSERBASE_MAX_TTL_SECONDS through the DB-backed settings resolver.
// This suite never calls createBrowserSession, but the resolver module
// imports the real DB pool at load time, which throws without a
// DATABASE_URL. Stub it out at the module boundary like the other
// settings-resolver tests do.
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn(async () => 360),
  getSettings: vi.fn(async () => ({})),
}));

// Billing + capacity boundary for the BrowserBase session
// establishBrowserFormSession opens. Mocked here, one level above the
// database each of these modules would otherwise reach, so the suite can
// both drive their refusal branches and assert the slot/meter bookkeeping
// this path used to skip entirely. vi.hoisted because the vi.mock factories
// below are lifted above the static imports at the bottom of this block.
const meter = vi.hoisted(() => ({
  checkBrowserbaseQuota: vi.fn(),
  recordBrowserbaseSeconds: vi.fn(),
  acquireConcurrencySlot: vi.fn(),
  releaseConcurrencySlot: vi.fn(),
  getUserPlan: vi.fn(),
}));
vi.mock("@/lib/billing/browserbase-usage", () => ({
  checkBrowserbaseQuota: meter.checkBrowserbaseQuota,
  recordBrowserbaseSeconds: meter.recordBrowserbaseSeconds,
}));
vi.mock("@/lib/browserbase/concurrency-queue", () => ({
  acquireConcurrencySlot: meter.acquireConcurrencySlot,
  releaseConcurrencySlot: meter.releaseConcurrencySlot,
}));
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: meter.getUserPlan,
}));

// Speed up the settle-window poll in navigateAndWaitForLoad without
// touching the timeout/limit constants other modules under test rely on.
vi.mock("@/lib/config/config-values", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/config/config-values")>();
  return {
    ...actual,
    CONFIG_SCAN_AUTH_BROWSER_SETTLE_MS: 5,
    CONFIG_SCAN_AUTH_BROWSER_NAV_TIMEOUT_MS: 2000,
    CONFIG_SCAN_AUTH_BROWSER_MAX_WAIT_MS: 3000,
  };
});

import {
  detectChallenge,
  runLoginOverCdp,
} from "@/lib/scanner/auth/browser-login";
import type { CdpConnection } from "@/lib/browserbase/client";
import type { EphemeralFormAuth } from "@/lib/scanner/auth/types";

function htmlResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/html", ...(init.headers ?? {}) },
  });
}

interface FakeCdpOptions {
  rendered: { title: string; html: string };
  cookies?: Array<{
    name: string;
    value: string;
    domain: string;
    path?: string;
    secure?: boolean;
  }>;
  mainResponse?: {
    url: string;
    status: number;
    headers: Record<string, string>;
  };
  fireLoad?: boolean;
}

function makeFakeCdp(opts: FakeCdpOptions): CdpConnection {
  const handlers = new Map<
    string,
    Array<(p: Record<string, unknown>) => void>
  >();
  return {
    async send(method, params) {
      if (method === "Page.navigate") {
        if (opts.mainResponse) {
          for (const h of handlers.get("Network.responseReceived") ?? []) {
            h({ response: opts.mainResponse });
          }
        }
        if (opts.fireLoad !== false) {
          for (const h of handlers.get("Page.loadEventFired") ?? []) h({});
        }
        return {};
      }
      if (method === "Runtime.evaluate") {
        return { result: { value: JSON.stringify(opts.rendered) } };
      }
      if (method === "Network.getCookies") {
        return { cookies: opts.cookies ?? [] };
      }
      return {};
    },
    on(method, handler) {
      const list = handlers.get(method) ?? [];
      list.push(handler);
      handlers.set(method, list);
      return undefined as never as ReturnType<CdpConnection["on"]>;
    },
    close() {},
  };
}

const AUTH: EphemeralFormAuth = {
  method: "form",
  username: "admin",
  password: "hunter2",
};

const ORIGIN = "https://app.example.com";

const LOGIN_FORM_HTML = `
<html><head><title>Sign in</title></head><body>
<form method="post" action="/accounts/login/">
  <input type="hidden" name="csrfmiddlewaretoken" value="tok-123">
  <input type="text" name="username">
  <input type="password" name="password">
</form>
</body></html>`;

/** The account a form login is billed to. */
const USER_ID = 42;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  meter.checkBrowserbaseQuota.mockReset();
  meter.checkBrowserbaseQuota.mockResolvedValue({ allowed: true });
  meter.recordBrowserbaseSeconds.mockReset();
  meter.recordBrowserbaseSeconds.mockResolvedValue(undefined);
  meter.acquireConcurrencySlot.mockReset();
  meter.acquireConcurrencySlot.mockResolvedValue({
    acquired: true,
    queued: false,
  });
  meter.releaseConcurrencySlot.mockReset();
  meter.releaseConcurrencySlot.mockResolvedValue(undefined);
  meter.getUserPlan.mockReset();
  meter.getUserPlan.mockResolvedValue("pro");
});

describe("detectChallenge", () => {
  it("flags a Cloudflare JS-challenge title", () => {
    const reason = detectChallenge({
      title: "Just a moment...",
      html: "<html></html>",
    });
    expect(reason).toMatch(/cloudflare/i);
  });

  it("flags the cf-mitigated response header", () => {
    const reason = detectChallenge({
      title: "app.example.com",
      html: "<html>real content</html>",
      headers: { "cf-mitigated": "challenge" },
    });
    expect(reason).toMatch(/cloudflare/i);
  });

  it("flags a CAPTCHA widget paired with a human-verification prompt", () => {
    const reason = detectChallenge({
      title: "Verify",
      html: '<div class="g-recaptcha"></div><p>Please verify you are human</p>',
    });
    expect(reason).toMatch(/captcha/i);
  });

  it("does not flag a recaptcha widget with no verification prompt nearby", () => {
    // A contact form using reCAPTCHA is not a login-blocking challenge.
    const reason = detectChallenge({
      title: "Contact us",
      html: '<div class="g-recaptcha"></div><form>...</form>',
    });
    expect(reason).toBeNull();
  });

  it("does not flag a login page whose bundle merely references cf-turnstile with no verification prompt", () => {
    // Regression guard: a site (including this one -- see
    // components/auth/signup-form.tsx) can legitimately embed Cloudflare
    // Turnstile on its OWN form. That is not evidence the scanner itself
    // is being challenged/blocked -- only a human-facing "verify you are
    // human" style prompt alongside it is.
    const reason = detectChallenge({
      title: "Sign in",
      html: '<div class="cf-turnstile" data-sitekey="x"></div><form>...</form>',
    });
    expect(reason).toBeNull();
  });

  it("flags a cf-turnstile widget paired with a human-verification prompt", () => {
    const reason = detectChallenge({
      title: "Verify",
      html: '<div class="cf-turnstile"></div><p>Please verify you are human</p>',
    });
    expect(reason).toMatch(/captcha/i);
  });

  it("returns null for an ordinary login page", () => {
    const reason = detectChallenge({ title: "Sign in", html: LOGIN_FORM_HTML });
    expect(reason).toBeNull();
  });
});

describe("runLoginOverCdp: challenge detection blocks the login attempt", () => {
  it("fails with the Cloudflare reason and never attempts a login POST", async () => {
    const fetchMock = vi.mocked(fetch);
    const cdp = makeFakeCdp({
      rendered: { title: "Just a moment...", html: "<html>checking...</html>" },
    });

    const result = await runLoginOverCdp(cdp, AUTH, ORIGIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/cloudflare/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("runLoginOverCdp: form detection", () => {
  it("fails clearly when no login form is found after the page loads", async () => {
    const cdp = makeFakeCdp({
      rendered: {
        title: "Home",
        html: "<html><body>No form here</body></html>",
      },
    });
    const result = await runLoginOverCdp(cdp, AUTH, ORIGIN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no login form/i);
    }
  });

  it("fails clearly, listing both actions, when the page holds two distinct login forms", async () => {
    const html = `
      <html><head><title>Sign in</title></head><body>
      <form action="/login">
        <input type="text" name="username">
        <input type="password" name="password">
      </form>
      <form action="/admin-login">
        <input type="text" name="admin_user">
        <input type="password" name="admin_pass">
      </form>
      </body></html>`;
    const cdp = makeFakeCdp({ rendered: { title: "Sign in", html } });
    const result = await runLoginOverCdp(cdp, AUTH, ORIGIN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/2 candidate login forms/i);
      expect(result.reason).toContain("/login");
      expect(result.reason).toContain("/admin-login");
    }
  });

  it("fails when the login form submits off-origin", async () => {
    const html = `<html><head><title>Sign in</title></head><body>
      <form action="https://attacker.example.com/collect">
        <input type="text" name="username">
        <input type="password" name="password">
      </form></body></html>`;
    const cdp = makeFakeCdp({ rendered: { title: "Sign in", html } });
    const result = await runLoginOverCdp(cdp, AUTH, ORIGIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/different host/i);
  });
});

describe("runLoginOverCdp: successful login", () => {
  it("submits via HTTP, carries forward a browser-picked-up cookie, and adopts the session cookie", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      htmlResponse(
        '<html><body>Welcome back! <a href="/logout">Sign out</a></body></html>',
        { headers: { "set-cookie": "sessionid=abc123; Path=/" } },
      ),
    );

    const cdp = makeFakeCdp({
      rendered: { title: "Sign in", html: LOGIN_FORM_HTML },
      cookies: [
        {
          name: "cf_clearance",
          value: "clearance-tok",
          domain: "app.example.com",
          secure: true,
        },
      ],
    });

    const result = await runLoginOverCdp(cdp, AUTH, ORIGIN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.jar.has("cf_clearance")).toBe(true);
      expect(result.session.jar.has("sessionid")).toBe(true);
    }

    // The POST carried the browser cookie and the submitted credentials.
    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(submitUrl).toBe("https://app.example.com/accounts/login/");
    expect(String(submitInit.body)).toContain("username=admin");
    expect(String(submitInit.body)).toContain("password=hunter2");
    const headers = submitInit.headers as Headers;
    expect(headers.get("Cookie")).toBe("cf_clearance=clearance-tok");
  });

  it("fails when the target still shows the login form after submitting", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      htmlResponse(LOGIN_FORM_HTML, {
        headers: { "set-cookie": "sessionid=newanon; Path=/" },
      }),
    );
    const cdp = makeFakeCdp({
      rendered: { title: "Sign in", html: LOGIN_FORM_HTML },
    });

    const result = await runLoginOverCdp(cdp, AUTH, ORIGIN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/still showed a login form/i);
      expect(result.reason).not.toContain("hunter2");
    }
  });

  it("fails when the target sets no cookie at all", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      htmlResponse("<html><body>Welcome, no cookies here</body></html>"),
    );
    const cdp = makeFakeCdp({
      rendered: { title: "Sign in", html: LOGIN_FORM_HTML },
    });

    const result = await runLoginOverCdp(cdp, AUTH, ORIGIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/did not set or change/i);
  });
});

describe("establishBrowserFormSession: session lifecycle", () => {
  it("reports unavailability when no CDP connection can be opened, without throwing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/browserbase/client", () => ({
      createBrowserSession: vi.fn(async () => ({
        id: "sess_1",
        status: "RUNNING",
        url: "",
        connectUrl: "wss://example/connect",
      })),
      endBrowserSession: vi.fn(async () => undefined),
      openCdpPageSession: vi.fn(async () => null),
    }));

    const { establishBrowserFormSession: establish } =
      await import("@/lib/scanner/auth/browser-login");
    const result = await establish(AUTH, ORIGIN, USER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not available/i);
    vi.doUnmock("@/lib/browserbase/client");
    vi.resetModules();
  });

  it("always ends the browser session, even when the login itself fails", async () => {
    vi.resetModules();
    const endBrowserSession = vi.fn(async () => undefined);
    vi.doMock("@/lib/browserbase/client", () => ({
      createBrowserSession: vi.fn(async () => ({
        id: "sess_2",
        status: "RUNNING",
        url: "",
        connectUrl: "wss://example/connect",
      })),
      endBrowserSession,
      openCdpPageSession: vi.fn(async () =>
        makeFakeCdp({
          rendered: { title: "Home", html: "<html>no form</html>" },
        }),
      ),
    }));

    const { establishBrowserFormSession: establish } =
      await import("@/lib/scanner/auth/browser-login");
    const result = await establish(AUTH, ORIGIN, USER_ID);
    expect(result.ok).toBe(false);
    expect(endBrowserSession).toHaveBeenCalledWith("sess_2");
    vi.doUnmock("@/lib/browserbase/client");
    vi.resetModules();
  });
});

/**
 * A BrowserBase session costs real money and the deployment's account has a
 * hard concurrency ceiling, so every other path that opens one checks the
 * caller's live-browser allowance, takes a queue slot, and bills the seconds
 * back (POST /api/v3/browser/sessions, lib/scanner/page-screenshot.ts). This
 * one did none of the three: a form login opened a session unmetered and
 * uncapped, so repeated form logins were both free and a way for one account
 * to exhaust the whole deployment's concurrency.
 */
describe("establishBrowserFormSession: metering and capacity", () => {
  /** Mocks lib/browserbase/client with a session that comes up but renders a
   *  page holding no login form, so the login fails AFTER a real session
   *  exists: the case where a slot is held and seconds were really spent. */
  function mockClientWithLiveSession(id: string, createThrows = false) {
    vi.doMock("@/lib/browserbase/client", () => ({
      createBrowserSession: vi.fn(async () => {
        if (createThrows) throw new Error("browserbase is down");
        return { id, status: "RUNNING", url: "", connectUrl: "wss://c" };
      }),
      endBrowserSession: vi.fn(async () => undefined),
      openCdpPageSession: vi.fn(async () =>
        makeFakeCdp({
          rendered: { title: "Home", html: "<html>no form</html>" },
        }),
      ),
    }));
  }

  it("opens no browser session at all once the account's live-browser allowance is used up", async () => {
    vi.resetModules();
    const createBrowserSession = vi.fn();
    vi.doMock("@/lib/browserbase/client", () => ({
      createBrowserSession,
      endBrowserSession: vi.fn(async () => undefined),
      openCdpPageSession: vi.fn(async () => null),
    }));
    meter.checkBrowserbaseQuota.mockResolvedValue({
      allowed: false,
      message: "You've used your 5 live-browser minute(s) for this month.",
    });

    const { establishBrowserFormSession: establish } =
      await import("@/lib/scanner/auth/browser-login");
    const result = await establish(AUTH, ORIGIN, USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/live-browser minute/i);
    expect(createBrowserSession).not.toHaveBeenCalled();
    // Nothing was reserved, so nothing may be released: a stray release here
    // would hand a slot back that was never taken and inflate the cap.
    expect(meter.acquireConcurrencySlot).not.toHaveBeenCalled();
    expect(meter.releaseConcurrencySlot).not.toHaveBeenCalled();
    expect(meter.recordBrowserbaseSeconds).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/browserbase/client");
    vi.resetModules();
  });

  it("opens no browser session when the global concurrency queue has no slot free", async () => {
    vi.resetModules();
    const createBrowserSession = vi.fn();
    vi.doMock("@/lib/browserbase/client", () => ({
      createBrowserSession,
      endBrowserSession: vi.fn(async () => undefined),
      openCdpPageSession: vi.fn(async () => null),
    }));
    meter.acquireConcurrencySlot.mockResolvedValue({
      acquired: false,
      queued: true,
    });

    const { establishBrowserFormSession: establish } =
      await import("@/lib/scanner/auth/browser-login");
    const result = await establish(AUTH, ORIGIN, USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/capacity is full/i);
    expect(createBrowserSession).not.toHaveBeenCalled();
    expect(meter.releaseConcurrencySlot).not.toHaveBeenCalled();
    expect(meter.recordBrowserbaseSeconds).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/browserbase/client");
    vi.resetModules();
  });

  it("takes exactly one slot, releases it, and bills the seconds once when the login fails after the session came up", async () => {
    vi.resetModules();
    mockClientWithLiveSession("sess_meter_1");

    const { establishBrowserFormSession: establish } =
      await import("@/lib/scanner/auth/browser-login");
    const result = await establish(AUTH, ORIGIN, USER_ID);

    expect(result.ok).toBe(false);
    expect(meter.acquireConcurrencySlot).toHaveBeenCalledTimes(1);
    // A slot taken must always be handed back, including on the failure
    // paths, or the cap silently shrinks with every failed login.
    expect(meter.releaseConcurrencySlot).toHaveBeenCalledTimes(1);
    expect(meter.recordBrowserbaseSeconds).toHaveBeenCalledTimes(1);
    expect(meter.recordBrowserbaseSeconds.mock.calls[0][0]).toBe(USER_ID);
    expect(meter.recordBrowserbaseSeconds.mock.calls[0][1]).toBeGreaterThan(0);
    vi.doUnmock("@/lib/browserbase/client");
    vi.resetModules();
  });

  it("admits a paid plan to the queue ahead of free", async () => {
    vi.resetModules();
    mockClientWithLiveSession("sess_meter_2");

    const { establishBrowserFormSession: establish } =
      await import("@/lib/scanner/auth/browser-login");
    await establish(AUTH, ORIGIN, USER_ID);
    expect(meter.acquireConcurrencySlot).toHaveBeenCalledWith(true);

    meter.acquireConcurrencySlot.mockClear();
    meter.getUserPlan.mockResolvedValue("free");
    await establish(AUTH, ORIGIN, USER_ID);
    expect(meter.acquireConcurrencySlot).toHaveBeenCalledWith(false);

    vi.doUnmock("@/lib/browserbase/client");
    vi.resetModules();
  });

  it("releases the slot and bills nothing when the session never came up", async () => {
    vi.resetModules();
    mockClientWithLiveSession("sess_meter_3", true);

    const { establishBrowserFormSession: establish } =
      await import("@/lib/scanner/auth/browser-login");
    const result = await establish(AUTH, ORIGIN, USER_ID);

    expect(result.ok).toBe(false);
    expect(meter.releaseConcurrencySlot).toHaveBeenCalledTimes(1);
    // Nothing ran on BrowserBase's side, so nothing may be charged -- and a
    // caller retrying after this pays for its own session, never twice for
    // one that never existed.
    expect(meter.recordBrowserbaseSeconds).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/browserbase/client");
    vi.resetModules();
  });
});

describe("establishScanSession (form): runs verifySession after a successful browser login", () => {
  it("returns status authenticated once the browser login and the network verify both succeed", async () => {
    vi.resetModules();
    vi.doMock("@/lib/browserbase/client", () => ({
      createBrowserSession: vi.fn(async () => ({
        id: "sess_3",
        status: "RUNNING",
        url: "",
        connectUrl: "wss://example/connect",
      })),
      endBrowserSession: vi.fn(async () => undefined),
      openCdpPageSession: vi.fn(async () =>
        makeFakeCdp({ rendered: { title: "Sign in", html: LOGIN_FORM_HTML } }),
      ),
    }));

    const fetchMock = vi.mocked(fetch);
    // 1. login POST
    fetchMock.mockResolvedValueOnce(
      htmlResponse(
        '<html><body>Welcome back! <a href="/logout">Sign out</a></body></html>',
        { headers: { "set-cookie": "sessionid=abc123; Path=/" } },
      ),
    );
    // 2. verifySession anonymous probe
    fetchMock.mockResolvedValueOnce(htmlResponse("<html>Please log in</html>"));
    // 3. verifySession authenticated probe
    fetchMock.mockResolvedValueOnce(
      htmlResponse('<html>Welcome back! <a href="/logout">Sign out</a></html>'),
    );

    const { establishScanSession } = await import("@/lib/scanner/auth/login");
    const result = await establishScanSession(
      AUTH,
      `${ORIGIN}/dashboard`,
      USER_ID,
    );
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.doUnmock("@/lib/browserbase/client");
    vi.resetModules();
  });
});
