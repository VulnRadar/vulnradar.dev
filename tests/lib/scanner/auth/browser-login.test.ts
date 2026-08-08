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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
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
    const result = await establish(AUTH, ORIGIN);
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
    const result = await establish(AUTH, ORIGIN);
    expect(result.ok).toBe(false);
    expect(endBrowserSession).toHaveBeenCalledWith("sess_2");
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
    const result = await establishScanSession(AUTH, `${ORIGIN}/dashboard`);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.doUnmock("@/lib/browserbase/client");
    vi.resetModules();
  });
});
