/**
 * Tests for middleware.ts: the security-header layer (CSP/COEP/etc, now
 * built per-request with a real nonce) and the CSRF/auth-redirect logic
 * that sits alongside it. Neither had any test coverage before this file.
 *
 * No network/DB boundary to mock here -- middleware() is pure given a
 * NextRequest and some env vars/cookies.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const { middleware } = await import("@/middleware");

function makeRequest(
  path: string,
  opts: {
    method?: string;
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return new NextRequest(`https://vulnradar.dev${path}`, {
    method: opts.method ?? "GET",
    headers: { ...opts.headers, ...(opts.cookie ? { cookie: opts.cookie } : {}) },
  });
}

beforeEach(() => {
  vi.stubEnv("DISABLE_CSP", "");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vulnradar.dev");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("middleware: security headers", () => {
  it("sets a Content-Security-Policy with a real nonce, strict-dynamic, and no unsafe-inline in script-src", () => {
    const res = middleware(makeRequest("/landing"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src "));

    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("omits unsafe-eval in production, where next build never calls eval()", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = middleware(makeRequest("/landing"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src "));

    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("allows unsafe-eval outside production, since next dev's fast-refresh module loader calls eval()", () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = middleware(makeRequest("/landing"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src "));

    expect(scriptSrc).toContain("'unsafe-eval'");
  });

  it("generates a different nonce on every request", () => {
    const nonceOf = (res: Response) => {
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      return csp.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
    };
    const a = nonceOf(middleware(makeRequest("/landing")));
    const b = nonceOf(middleware(makeRequest("/landing")));
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
  });

  it("still allowlists style-src 'unsafe-inline' for styled-jsx (out of scope for the nonce rewrite)", () => {
    const res = middleware(makeRequest("/landing"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const styleSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("style-src "));
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  it("ships Trusted Types as report-only, not enforcing", () => {
    const res = middleware(makeRequest("/landing"));
    expect(res.headers.get("Content-Security-Policy")).not.toContain(
      "require-trusted-types-for",
    );
    const reportOnly = res.headers.get("Content-Security-Policy-Report-Only");
    expect(reportOnly).toContain("require-trusted-types-for 'script'");
    expect(reportOnly).toContain("trusted-types default");
  });

  it("sets COEP to unsafe-none (credentialless broke the BrowserBase live-view iframe in real testing)", () => {
    const res = middleware(makeRequest("/landing"));
    expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe(
      "unsafe-none",
    );
  });

  it("does not set the deprecated X-XSS-Protection header", () => {
    const res = middleware(makeRequest("/landing"));
    expect(res.headers.get("X-XSS-Protection")).toBeNull();
  });

  it("strips server-disclosure headers, including X-Nextjs-Cache", () => {
    const res = middleware(makeRequest("/landing"));
    expect(res.headers.get("X-Powered-By")).toBeNull();
    expect(res.headers.get("X-Nextjs-Cache")).toBeNull();
  });

  it("DISABLE_CSP=1 (non-production) ships without CSP or the other security headers", () => {
    vi.stubEnv("DISABLE_CSP", "1");
    const res = middleware(makeRequest("/landing"));
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("throws if DISABLE_CSP=1 is set in production", () => {
    vi.stubEnv("DISABLE_CSP", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => middleware(makeRequest("/landing"))).toThrow(
      /not allowed in production/,
    );
  });
});

describe("middleware: public path / auth redirects", () => {
  it("does not redirect a logged-out visitor browsing a public page", () => {
    const res = middleware(makeRequest("/landing"));
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
  });

  it("redirects a logged-in user away from /login to the dashboard", () => {
    const res = middleware(
      makeRequest("/login", { cookie: "vulnradar_session=abc123" }),
    );
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("redirects a logged-out visitor on / to /landing", () => {
    const res = middleware(makeRequest("/"));
    expect(res.headers.get("location")).toContain("/landing");
  });

  it("redirects a protected route to /login when there is no session cookie", () => {
    const res = middleware(makeRequest("/history"));
    expect(res.headers.get("location")).toContain("/login");
    // The dashboard is the default post-login destination, so it's the one
    // intended path that does NOT need a redirect= param -- verified by a
    // different path here so this test can actually assert the param exists.
    expect(res.headers.get("location")).toContain("redirect=%2Fhistory");
  });

  it("omits the redirect= param when the protected route already is the dashboard (the default post-login destination)", () => {
    const res = middleware(makeRequest("/dashboard"));
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).not.toContain("redirect=");
  });

  it("allows a protected route through when a session cookie is present", () => {
    const res = middleware(
      makeRequest("/dashboard", { cookie: "vulnradar_session=abc123" }),
    );
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("middleware: CSRF enforcement on /api/v3/**", () => {
  it("blocks a mutating request with no Origin/Referer", () => {
    const res = middleware(
      makeRequest("/api/v3/history", {
        method: "POST",
        cookie: "vulnradar_session=abc123",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("allows a mutating request whose Origin matches the app", () => {
    const res = middleware(
      makeRequest("/api/v3/history", {
        method: "POST",
        cookie: "vulnradar_session=abc123",
        headers: { origin: "https://vulnradar.dev" },
      }),
    );
    expect(res.status).not.toBe(403);
  });

  it("blocks a mutating request whose Origin does not match the app", () => {
    const res = middleware(
      makeRequest("/api/v3/history", {
        method: "POST",
        cookie: "vulnradar_session=abc123",
        headers: { origin: "https://evil.example.com" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("exempts Stripe webhooks from the CSRF check", () => {
    const res = middleware(
      makeRequest("/api/v3/webhooks/stripe", { method: "POST" }),
    );
    expect(res.status).not.toBe(403);
  });

  it("does not enforce CSRF on a GET request", () => {
    const res = middleware(
      makeRequest("/api/v3/history", { cookie: "vulnradar_session=abc123" }),
    );
    expect(res.status).not.toBe(403);
  });

  it("exempts a true API client (Bearer token, no Origin) from CSRF", () => {
    const res = middleware(
      makeRequest("/api/v3/history", {
        method: "POST",
        headers: { authorization: "Bearer vr_some_key" },
      }),
    );
    expect(res.status).not.toBe(403);
  });
});
