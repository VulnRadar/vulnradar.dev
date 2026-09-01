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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { middleware } = await import("@/middleware");

// app/layout.tsx read as text, not imported: it pulls in the whole provider
// tree and through it @/lib/database/db, which throws "DATABASE_URL
// environment variable is not set" at import time in this node environment.
// The one value asserted from it is a string literal, so reading it is
// enough and it still fails if someone edits the canonical back.
const rootLayoutSource = readFileSync(
  fileURLToPath(new URL("../app/layout.tsx", import.meta.url)),
  "utf8",
);
const fallbackCanonical = rootLayoutSource.match(
  /alternates:\s*\{\s*canonical:\s*"([^"]+)"/,
)?.[1];

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
    headers: {
      ...opts.headers,
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
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
    expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe("unsafe-none");
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

  // NextResponse.redirect defaults to 307, which tells a crawler the
  // arrangement is temporary and to keep evaluating "/" as its own URL. The
  // signed-out root has always resolved to /landing, so it is a 308 and the
  // link equity consolidates. Nothing asserted the code, so the default
  // could have come back on any edit to this branch.
  it("makes the anonymous / redirect permanent (308), not the NextResponse default 307", () => {
    const res = middleware(makeRequest("/"));
    expect(res.status).toBe(308);
  });

  // The other half of the same decision. app/layout.tsx's site-wide fallback
  // canonical used to be "/", the one path this middleware ALWAYS redirects,
  // so any page added without its own pageMetadata() call inherited a
  // canonical naming a URL that never returns 200. It is "/landing" now, and
  // the invariant worth guarding is not the literal string but that the
  // fallback names a path the middleware serves directly.
  it("serves the root layout's fallback canonical without a redirect, so it names a URL that can return 200", () => {
    expect(fallbackCanonical).toBe("/landing");
    const res = middleware(makeRequest(fallbackCanonical!));
    expect(res.headers.get("location")).toBeNull();
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

  it("does not redirect an unauthenticated request for /sitemap.xml — Googlebot carries no session cookie, and a redirect to /login makes Search Console report the sitemap as HTML", () => {
    const res = middleware(makeRequest("/sitemap.xml"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect an unauthenticated request for /robots.txt", () => {
    const res = middleware(makeRequest("/robots.txt"));
    expect(res.headers.get("location")).toBeNull();
  });

  // Regression: these five were missing from PUBLIC_PATHS entirely (only
  // their sub-pages or API routes were listed, not the page itself), so a
  // logged-out visitor got 307'd to /login before ever reaching a page
  // whose whole point is to be public -- caught by scanning VulnRadar's
  // own site with its own scanner and finding the real login form's
  // password field showing up on pages that should never redirect there.
  it("does not redirect an unauthenticated request for /legal (the bare index, not just its sub-pages)", () => {
    const res = middleware(makeRequest("/legal"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect an unauthenticated request for /badge", () => {
    const res = middleware(makeRequest("/badge"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect an unauthenticated request for /checkout/success", () => {
    const res = middleware(makeRequest("/checkout/success"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect an unauthenticated request for /teams/join -- invite links must work for people without an account yet", () => {
    const res = middleware(makeRequest("/teams/join"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect an unauthenticated request for /host/[hostname]", () => {
    const res = middleware(makeRequest("/host/example.com"));
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

  it("does NOT exempt the user's own webhook list/create endpoint -- only the exact Stripe path, not the whole /api/v3/webhooks/ prefix (AUDIT-010#security-03)", () => {
    const res = middleware(
      makeRequest("/api/v3/webhooks", {
        method: "POST",
        cookie: "vulnradar_session=abc123",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("does NOT exempt the user's own webhook edit endpoint from the CSRF check (AUDIT-010#security-03)", () => {
    const res = middleware(
      makeRequest("/api/v3/webhooks/42", {
        method: "PATCH",
        cookie: "vulnradar_session=abc123",
      }),
    );
    expect(res.status).toBe(403);
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

  // The published ghcr.io/vulnradar/vulnradar image is built by
  // .github/workflows/docker-publish.yml with no
  // `--build-arg NEXT_PUBLIC_APP_URL`, so NEXT_PUBLIC_APP_URL -- a
  // NEXT_PUBLIC_ var Next.js inlines at `next build` time -- is "" in
  // every copy of that image, regardless of what a self-hoster sets via
  // docker-compose.yml's `environment:` at container runtime. Before the
  // Host-header fallback, this made `appOrigin` "" for every such
  // self-hoster, so `!appOrigin` was always true and every mutating
  // request to a non-public /api/v3/** route (account settings, logout,
  // 2FA management, session revocation, etc. -- everything reachable once
  // logged in) was rejected no matter the real Origin. (/api/v3/auth/login
  // itself is in PUBLIC_PATHS and so was never subject to this check, but
  // this is why so much else broke right alongside it on a self-hosted
  // deploy of the published image.)
  it("falls back to the request's own Host header when NEXT_PUBLIC_APP_URL was baked in empty (the published Docker image's default)", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const res = middleware(
      makeRequest("/api/v3/history", {
        method: "POST",
        cookie: "vulnradar_session=abc123",
        headers: {
          origin: "https://sandbox.vulnradar.dev",
          host: "sandbox.vulnradar.dev",
        },
      }),
    );
    expect(res.status).not.toBe(403);
  });

  it("still blocks a genuinely cross-origin request even when NEXT_PUBLIC_APP_URL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const res = middleware(
      makeRequest("/api/v3/history", {
        method: "POST",
        cookie: "vulnradar_session=abc123",
        headers: {
          origin: "https://evil.example.com",
          host: "sandbox.vulnradar.dev",
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("prefers X-Forwarded-Host over Host when a proxy rewrites Host to an internal upstream name", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const res = middleware(
      makeRequest("/api/v3/history", {
        method: "POST",
        cookie: "vulnradar_session=abc123",
        headers: {
          origin: "https://sandbox.vulnradar.dev",
          host: "internal-upstream:3000",
          "x-forwarded-host": "sandbox.vulnradar.dev",
          "x-forwarded-proto": "https",
        },
      }),
    );
    expect(res.status).not.toBe(403);
  });
});

/**
 * AUDIT-013#dup-04: the documented 1 MiB body cap lived only inside
 * parseBody, which 54 of the 73 body-reading routes never call, so for those
 * routes there was no cap at all and no backstop under them (the App Router
 * has no default body limit). Enforcing it here makes it a property of the
 * API rather than of one helper.
 */
describe("middleware: request body size cap", () => {
  const overLimit = String(1 * 1024 * 1024 + 1);

  it("rejects an oversized POST body with 413 before the CSRF check runs", () => {
    // No Origin header, so this request would otherwise be a 403: proving it
    // is a 413 proves the cap runs first and applies to every API route
    // regardless of how it authenticates.
    const res = middleware(
      makeRequest("/api/v3/scan", {
        method: "POST",
        cookie: "vulnradar_session=abc123",
        headers: { "content-length": overLimit },
      }),
    );
    expect(res.status).toBe(413);
  });

  it("rejects an oversized body on a route that never calls parseBody", () => {
    const res = middleware(
      makeRequest("/api/v3/account/unsubscribe", {
        method: "POST",
        headers: {
          "content-length": overLimit,
          origin: "https://vulnradar.dev",
        },
      }),
    );
    expect(res.status).toBe(413);
  });

  it("applies to PUT, PATCH and DELETE as well as POST", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = middleware(
        makeRequest("/api/v3/history", {
          method,
          cookie: "vulnradar_session=abc123",
          headers: {
            "content-length": overLimit,
            origin: "https://vulnradar.dev",
          },
        }),
      );
      expect(res.status).toBe(413);
    }
  });

  it("still carries the security headers on the 413", () => {
    const res = middleware(
      makeRequest("/api/v3/scan", {
        method: "POST",
        headers: { "content-length": overLimit },
      }),
    );
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("lets a body at exactly the limit through", () => {
    const res = middleware(
      makeRequest("/api/v3/history", {
        method: "POST",
        cookie: "vulnradar_session=abc123",
        headers: {
          "content-length": String(1 * 1024 * 1024),
          origin: "https://vulnradar.dev",
        },
      }),
    );
    expect(res.status).not.toBe(413);
  });

  it("does not apply to GET, which carries no body", () => {
    const res = middleware(
      makeRequest("/api/v3/history", {
        method: "GET",
        cookie: "vulnradar_session=abc123",
        headers: { "content-length": overLimit },
      }),
    );
    expect(res.status).not.toBe(413);
  });

  it("does not apply outside /api/", () => {
    const res = middleware(
      makeRequest("/dashboard", {
        method: "POST",
        cookie: "vulnradar_session=abc123",
        headers: { "content-length": overLimit },
      }),
    );
    expect(res.status).not.toBe(413);
  });
});

/**
 * AUDIT-012#obs-07: the per-request correlation id. Middleware is the only
 * place that sees every request, so it is where the id is minted; it then
 * has to cross into the Node runtime as a request header, because a
 * middleware AsyncLocalStorage is invisible to a route handler (different
 * runtime, different module instance). See lib/database/request-context.ts.
 */
describe("middleware: request correlation id", () => {
  /**
   * NextResponse.next({ request: { headers } }) does not mutate the incoming
   * Request. Next encodes the overridden request headers onto the response
   * as `x-middleware-request-<name>`, which the server then replays for the
   * route handler, so that is what proves the id was actually forwarded
   * rather than only echoed.
   */
  const forwarded = (res: Response) =>
    res.headers.get("x-middleware-request-x-request-id");

  it("echoes an x-request-id on the response", () => {
    const res = middleware(makeRequest("/landing"));
    expect(res.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("forwards the same id to the route handler as a request header", () => {
    // A path that falls through to NextResponse.next rather than a redirect,
    // since only that carries forwarded request headers at all.
    const res = middleware(makeRequest("/landing"));
    expect(forwarded(res)).toBe(res.headers.get("x-request-id"));
  });

  it("generates a different id on every request", () => {
    const a = middleware(makeRequest("/landing")).headers.get("x-request-id");
    const b = middleware(makeRequest("/landing")).headers.get("x-request-id");
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("overwrites a client-supplied x-request-id instead of trusting it", () => {
    // The value is written verbatim into system_error_logs, an admin-facing
    // table. A caller that could choose it could plant arbitrary text there
    // or deliberately collide its request with somebody else's.
    const res = middleware(
      makeRequest("/landing", {
        headers: { "x-request-id": "attacker-chosen-value" },
      }),
    );
    expect(res.headers.get("x-request-id")).not.toBe("attacker-chosen-value");
    // The forwarded copy is the one a route handler reads, so it is the one
    // that has to be overwritten, not just the echoed response header.
    expect(forwarded(res)).toBe(res.headers.get("x-request-id"));
    expect(forwarded(res)).not.toBe("attacker-chosen-value");
  });

  it("carries the id on a redirect, which never reaches a route handler", () => {
    const res = middleware(makeRequest("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("carries the id on the 413 an oversized body is rejected with", () => {
    const res = middleware(
      makeRequest("/api/v3/scan", {
        method: "POST",
        headers: { "content-length": String(64 * 1024 * 1024) },
      }),
    );
    expect(res.status).toBe(413);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("carries the id on a CSRF rejection", () => {
    const res = middleware(
      makeRequest("/api/v3/history", {
        method: "POST",
        cookie: "vulnradar_session=abc123",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("still carries the id when DISABLE_CSP strips the security headers", () => {
    // A correlation id is not a security header. Turning CSP off to debug a
    // third-party embed must not also take away the thing that makes the
    // resulting errors findable.
    vi.stubEnv("DISABLE_CSP", "1");
    const res = middleware(makeRequest("/landing"));
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});
