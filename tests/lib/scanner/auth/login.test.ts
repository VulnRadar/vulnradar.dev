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
import { describe, it, expect, beforeEach, vi } from "vitest";

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

import { establishScanSession, verifySession } from "@/lib/scanner/auth/login";
import { ScanSession } from "@/lib/scanner/auth/scan-session";
import type { EphemeralAuthInput } from "@/lib/scanner/auth/types";

function htmlResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/html", ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("establishScanSession: invalid target", () => {
  it("fails cleanly when the target URL is not http(s)", async () => {
    const auth: EphemeralAuthInput = {
      method: "header",
      headerValue: "Bearer x",
    };
    const result = await establishScanSession(auth, "not-a-url");
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
