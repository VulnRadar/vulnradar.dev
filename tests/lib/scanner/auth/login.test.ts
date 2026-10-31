/**
 * Login + verification tests for the header and cookie ephemeral auth
 * methods, and the shared `verifySession` heuristic.
 *
 * The form method is browser-driven (see lib/scanner/auth/browser-login.ts)
 * and has its own suite: tests/lib/scanner/auth/browser-login.test.ts.
 *
 * `dns/promises` is mocked so every hostname resolves to a public IP (the
 * DNS boundary), and `fetch` is mocked per-call in the exact order
 * `safeFetch` invokes it (the network boundary). Everything above that,
 * including the real `safeFetch` redirect/session logic, runs for real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

// lib/scanner/auth/login.ts pulls in the form method (./browser-login),
// which imports lib/browserbase/client.ts. That module now resolves
// BROWSERBASE_MAX_TTL_SECONDS through the DB-backed settings resolver,
// whose module import loads the real DB pool at load time and throws
// without a DATABASE_URL. This suite never exercises the browser-driven
// form method, so stub the resolver out at the module boundary.
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn(async () => 360),
  getSettings: vi.fn(async () => ({})),
}));

// Same reason, one module further along: ./browser-login now also imports the
// live-browser meter and the concurrency queue, because a form login opens a
// real (billable, capped) BrowserBase session. Both reach the pg pool at
// import time. Stubbed at the database boundary rather than mocking the
// billing modules themselves -- this suite never runs the form method, so no
// assertion here depends on either of them.
vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

import { getSettings } from "@/lib/config/runtime-config";
import {
  establishScanSession,
  readCappedBody,
  verifySession,
} from "@/lib/scanner/auth/login";
import { ScanSession } from "@/lib/scanner/auth/scan-session";
import type { EphemeralAuthInput } from "@/lib/scanner/auth/types";

function htmlResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/html", ...init.headers },
  });
}

/** The account a scan belongs to. Only the "form" branch of
 *  establishScanSession uses it (to meter the BrowserBase session that
 *  branch opens); header and cookie auth never touch it. */
const USER_ID = 42;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("establishScanSession: invalid target", () => {
  it("fails cleanly when the target URL is not http(s)", async () => {
    const auth: EphemeralAuthInput = {
      method: "header",
      headerValue: "Bearer x",
    };
    const result = await establishScanSession(auth, "not-a-url", USER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/valid http/i);
  });
});

describe("header credential: verified via the generic heuristic", () => {
  it("succeeds when the authenticated page differs enough from the anonymous one", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      htmlResponse("<html><body>Please log in</body></html>"),
    ); // anonymous
    fetchMock.mockResolvedValueOnce(
      htmlResponse(
        '<html><body>Welcome back! <a href="/logout">Sign out</a></body></html>',
      ),
    ); // authenticated

    const auth: EphemeralAuthInput = {
      method: "header",
      headerValue: "Bearer secret-api-token",
    };
    const result = await establishScanSession(
      auth,
      "https://app.example.com/api/status",
      USER_ID,
    );
    expect(result.ok).toBe(true);

    // The Authorization header actually reached the "authenticated" fetch.
    const authenticatedCall = fetchMock.mock.calls[1];
    const init = authenticatedCall[1] as RequestInit;
    const headers = init.headers as Record<string, string> | Headers;
    const authValue =
      headers instanceof Headers
        ? headers.get("Authorization")
        : (headers as Record<string, string>).Authorization;
    expect(authValue).toBe("Bearer secret-api-token");
  });

  it("respects a custom header name", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(htmlResponse("<html>anon</html>"));
    fetchMock.mockResolvedValueOnce(
      htmlResponse(
        '<html>Welcome, sign out here <a href="/logout">Sign out</a></html>',
      ),
    );

    const auth: EphemeralAuthInput = {
      method: "header",
      headerName: "X-Api-Key",
      headerValue: "my-token",
    };
    const result = await establishScanSession(
      auth,
      "https://app.example.com/api/status",
      USER_ID,
    );
    expect(result.ok).toBe(true);

    const init = fetchMock.mock.calls[1][1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("X-Api-Key")).toBe("my-token");
  });

  it("fails when the page looks the same signed in as signed out", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(htmlResponse("<html>No token</html>"));
    fetchMock.mockResolvedValueOnce(
      htmlResponse("<html>Still no token</html>"),
    );

    const auth: EphemeralAuthInput = {
      method: "header",
      headerValue: "Bearer bad-token",
    };
    const result = await establishScanSession(
      auth,
      "https://app.example.com/api/status",
      USER_ID,
    );
    expect(result.ok).toBe(false);
  });

  it("never leaks the header value into a failure reason", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(htmlResponse("<html>same</html>"));
    fetchMock.mockResolvedValueOnce(htmlResponse("<html>same</html>"));

    const auth: EphemeralAuthInput = {
      method: "header",
      headerValue: "Bearer super-secret-value",
    };
    const result = await establishScanSession(
      auth,
      "https://app.example.com/api/status",
      USER_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain("super-secret-value");
    }
  });
});

describe("cookie credential", () => {
  it("seeds the jar and sends the cookie on the verification fetch", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(htmlResponse("<html>Please log in</html>"));
    fetchMock.mockResolvedValueOnce(
      htmlResponse('<html>Welcome back <a href="/logout">Sign out</a></html>'),
    );

    const auth: EphemeralAuthInput = {
      method: "cookie",
      cookies: [{ name: "sessionid", value: "abc123" }],
    };
    const result = await establishScanSession(
      auth,
      "https://app.example.com/dashboard",
      USER_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.jar.has("sessionid")).toBe(true);
    }

    const init = fetchMock.mock.calls[1][1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("Cookie")).toBe("sessionid=abc123");
  });

  it("never leaks a cookie value into a failure reason", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(htmlResponse("<html>same</html>"));
    fetchMock.mockResolvedValueOnce(htmlResponse("<html>same</html>"));

    const auth: EphemeralAuthInput = {
      method: "cookie",
      cookies: [{ name: "sessionid", value: "super-secret-cookie-value" }],
    };
    const result = await establishScanSession(
      auth,
      "https://app.example.com/dashboard",
      USER_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain("super-secret-cookie-value");
    }
  });
});

describe("verifySession reports mid-scan session loss", () => {
  it("fails verification when the target answers 401 to the authenticated probe", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(htmlResponse("<html>anon</html>")); // anonymous probe
    fetchMock.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    ); // authenticated probe rejected

    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "header",
      staticHeaders: { Authorization: "Bearer expired" },
    });

    const result = await verifySession(
      session,
      "https://app.example.com/dashboard",
    );

    expect(result.ok).toBe(false);
    expect(session.lost).toBe(true);
  });

  it("fails when the authenticated fetch cannot be completed at all", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED")); // anonymous probe
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED")); // authenticated probe

    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "cookie",
    });

    const result = await verifySession(
      session,
      "https://app.example.com/dashboard",
    );
    expect(result.ok).toBe(false);
  });
});

// readCappedBody is a thin wrapper over the shared bounded reader
// (lib/scanner/read-bounded-body.ts). It used to carry a copy of that loop with
// a size cap and no read timeout, so a target that sent headers and then
// trickled the login or verification body held the scan slot open.
describe("readCappedBody", () => {
  const encoder = new TextEncoder();

  /** A response whose body emits `chunks` and then stalls without closing. */
  function stallingResponse(...chunks: string[]): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      },
    });
    return new Response(stream);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a body that fits under the cap", async () => {
    expect(
      await readCappedBody(htmlResponse("<html>signed in</html>"), 1000),
    ).toBe("<html>signed in</html>");
  });

  it("stops at maxBytes, partway through a chunk", async () => {
    expect(await readCappedBody(htmlResponse("0123456789"), 4)).toBe("0123");
  });

  it("reads a response that has no body stream through text()", async () => {
    const bodiless = {
      body: null,
      text: async () => "from text()",
    } as unknown as Response;
    expect(await readCappedBody(bodiless, 4)).toBe("from");
  });

  it("returns an empty string rather than throwing when text() fails", async () => {
    const broken = {
      body: null,
      text: async () => {
        throw new Error("body already consumed");
      },
    } as unknown as Response;
    expect(await readCappedBody(broken, 100)).toBe("");
  });

  it("gives up on a stalled body after the timeout it is given and keeps what arrived", async () => {
    const started = Date.now();
    const body = await readCappedBody(stallingResponse("first part"), 1000, 30);
    expect(body).toBe("first part");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("applies the shared reader's 10 second timeout when none is given", async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = readCappedBody(stallingResponse("partial"), 1000);
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toBe("partial");
  });
});

describe("verifySession bounds the body it reads", () => {
  it("gives up on a trickling probe body at the verify timeout instead of holding the scan", async () => {
    // The target answers the anonymous probe, then answers the authenticated
    // one with headers and a body that never finishes. The authenticated page
    // is judged on what arrived, which here is enough to confirm the login.
    // The verify timeout is set to 50ms: were it not forwarded to the reader,
    // the reader's own 10 second default would outlast the test.
    vi.mocked(getSettings).mockResolvedValueOnce({
      SCAN_AUTH_VERIFY_TIMEOUT_MS: 50,
    } as never);
    const encoder = new TextEncoder();
    const trickling = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("<html>Welcome <a>Sign out</a>"));
        },
      }),
      { headers: { "content-type": "text/html" } },
    );
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(htmlResponse("<html>Please log in</html>"));
    fetchMock.mockResolvedValueOnce(trickling);

    const session = new ScanSession({
      origin: "https://app.example.com",
      authType: "header",
      staticHeaders: { Authorization: "Bearer ok" },
    });

    const result = await verifySession(
      session,
      "https://app.example.com/dashboard",
    );

    expect(result.ok).toBe(true);
  });
});
