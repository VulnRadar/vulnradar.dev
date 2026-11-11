/**
 * Every API prefix is protected before any route file exists under it
 * (spec 12.2, invariants S1 to S6, S9 to S11).
 *
 * Each space is probed with a path no route serves, so what is proven is the
 * middleware's own decision and not a handler's. /api/v4 is dark by default;
 * the rows that need it on push "v4" onto CONFIG_API_SUPPORTED_VERSIONS, and
 * the rows that need the finished Move empty LEGACY_V3_TAILS, both of which
 * the middleware reads on every request. Both are restored after each test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { LEGACY_V3_TAILS } from "@/lib/api/route-registry";
import { CONFIG_API_SUPPORTED_VERSIONS } from "@/lib/config/config-values";
import { readPre40Routes } from "../_helpers/api-routes";

const { middleware } = await import("@/middleware");

const APP = "https://vulnradar.dev";
const COOKIE = "vulnradar_session=abc123";
const BEARER = "Bearer vr_live_probe";

const legacyTails = LEGACY_V3_TAILS as string[];
const savedTails = [...legacyTails];
const versions = CONFIG_API_SUPPORTED_VERSIONS as string[];
const savedVersions = [...versions];

function enableV4() {
  if (!versions.includes("v4")) versions.push("v4");
}
function finishMove() {
  legacyTails.length = 0;
  enableV4();
}

beforeEach(() => {
  vi.stubEnv("DISABLE_CSP", "");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  vi.stubEnv("MAINTENANCE_MODE", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ maintenance: false })),
  );
});

afterEach(() => {
  legacyTails.splice(0, legacyTails.length, ...savedTails);
  versions.splice(0, versions.length, ...savedVersions);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

interface Opts {
  method?: string;
  cookie?: boolean;
  bearer?: string;
  origin?: string;
  headers?: Record<string, string>;
}

function call(path: string, opts: Opts = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.cookie) headers.cookie = COOKIE;
  if (opts.bearer) headers.authorization = opts.bearer;
  if (opts.origin) headers.origin = opts.origin;
  return middleware(
    new NextRequest(`${APP}${path}`, {
      method: opts.method ?? "GET",
      headers,
    }),
  );
}

/** Let through to a route: neither an error nor a redirect. */
function passed(res: Response): boolean {
  return res.status === 200 && res.headers.get("location") === null;
}

async function envelope(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

/** The whole body of a middleware-made error, as spec 7.2 fixes it. */
async function expectEnvelope(
  res: Response,
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
) {
  expect(res.status).toBe(status);
  const requestId = res.headers.get("x-request-id");
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(await envelope(res)).toEqual({
    error: expect.any(String),
    code,
    requestId,
    ...extra,
  });
  expect(res.headers.get("cache-control")).toBe("no-store");
}

function forwarded(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`);
}

function forwardsHeader(res: Response, name: string): boolean {
  const list = (res.headers.get("x-middleware-override-headers") ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase());
  return list.includes(name) || forwarded(res, name) !== null;
}

// One probe per space. Set up per row, because v4 and the Move are toggles.
const SPACES = {
  "v4 (live)": { path: "/api/v4/__probe", setup: enableV4 },
  internal: { path: "/api/internal/__probe", setup: () => {} },
  "v3 alias to internal": { path: "/api/v3/__probe", setup: () => {} },
  "v3 alias to v4": { path: "/api/v3/history", setup: finishMove },
  "v3 legacy": { path: "/api/v3/history", setup: () => {} },
  "v4 (dark)": { path: "/api/v4/__probe", setup: () => {} },
  "unsupported version": { path: "/api/v9/__probe", setup: () => {} },
  "other /api": { path: "/api/__probe", setup: () => {} },
} as const;
type Space = keyof typeof SPACES;
const ALL = Object.keys(SPACES) as Space[];
const BEARER_SPACES: Space[] = ["v4 (live)", "v3 alias to v4", "v3 legacy"];

function probe(space: Space): string {
  SPACES[space].setup();
  return SPACES[space].path;
}

describe("S1, S10: CSRF on every /api path", () => {
  it.each(ALL)(
    "%s: a POST with neither Origin nor Bearer is CSRF_REJECTED",
    async (space) => {
      const res = call(probe(space), { method: "POST", cookie: true });
      await expectEnvelope(res, 403, "CSRF_REJECTED");
    },
  );

  it.each(ALL)(
    "%s: a POST with a Bearer and a foreign Origin is CSRF_REJECTED",
    async (space) => {
      const res = call(probe(space), {
        method: "POST",
        bearer: BEARER,
        origin: "https://evil.example",
      });
      await expectEnvelope(res, 403, "CSRF_REJECTED");
    },
  );

  it.each(ALL)(
    "%s: a Bearer without an Origin waives CSRF only in v4, its aliases and legacy v3",
    (space) => {
      const res = call(probe(space), { method: "POST", bearer: BEARER });
      if (BEARER_SPACES.includes(space)) expect(passed(res)).toBe(true);
      else expect(res.status).toBe(403);
    },
  );

  it.each(ALL)(
    "%s: a Bearer from an extension origin is waived only in v4, its aliases and legacy v3",
    (space) => {
      for (const origin of ["chrome-extension://abc", "moz-extension://abc"]) {
        const res = call(probe(space), {
          method: "POST",
          bearer: BEARER,
          origin,
        });
        if (BEARER_SPACES.includes(space)) expect(passed(res)).toBe(true);
        else expect(res.status).toBe(403);
      }
    },
  );

  it("a fake Bearer changes nothing on an internal path", async () => {
    const res = call("/api/internal/__probe", {
      method: "POST",
      cookie: true,
      bearer: BEARER,
    });
    await expectEnvelope(res, 403, "CSRF_REJECTED");
  });

  it.each([
    "/api/v3/webhooks/stripe",
    "/api/v3/account/unsubscribe",
    "/api/v3/auth/discord/callback",
    "/api/version",
    "/api/security-txt",
    "/api/v4/demo-scan",
    "/api/v3/demo-scan",
  ])("exempts exactly %s", (path) => {
    enableV4();
    expect(passed(call(path, { method: "POST" }))).toBe(true);
  });

  it.each([
    "/api/v3/webhooks/stripe/x",
    "/api/v3/account/unsubscribe/x",
    "/api/v3/auth/discord/callback/x",
    "/api/v3/webhooks/123",
    "/api/version/x",
    "/api/security-txt/x",
    "/api/v4/demo-scan/x",
    "/api/internal/demo-scan",
  ])("does not exempt the adjacent path %s", async (path) => {
    enableV4();
    const res = call(path, { method: "POST", cookie: true });
    await expectEnvelope(res, 403, "CSRF_REJECTED");
  });

  it("still exempts the demo scan once its v3 URL is an alias", () => {
    finishMove();
    expect(passed(call("/api/v3/demo-scan", { method: "POST" }))).toBe(true);
  });
});

describe("S9: the credential-less API call is JSON 401, navigations keep the redirect", () => {
  it("v4: 401 UNAUTHENTICATED with a Bearer challenge", async () => {
    enableV4();
    const res = call("/api/v4/__probe");
    await expectEnvelope(res, 401, "UNAUTHENTICATED");
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer realm="VulnRadar"',
    );
  });

  it("an alias to v4: 401 with the same challenge", async () => {
    finishMove();
    const res = call("/api/v3/scan/status/abc");
    await expectEnvelope(res, 401, "UNAUTHENTICATED");
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer realm="VulnRadar"',
    );
  });

  it.each([
    "/api/internal/__probe",
    "/api/v3/__probe",
    "/api/__probe",
    "/api/v3/history",
    "/api/v3/admin",
  ])("%s: 401 UNAUTHENTICATED, never a 307", async (path) => {
    const res = call(path);
    await expectEnvelope(res, 401, "UNAUTHENTICATED");
    expect(res.headers.get("location")).toBeNull();
  });

  // The web app's authFetcher threw on the 307 to the login HTML a signed-out
  // tab used to get here, instead of reading "not signed in".
  it("answers the signed-out auth/me read with JSON 401", async () => {
    const res = call("/api/v3/auth/me");
    await expectEnvelope(res, 401, "UNAUTHENTICATED");
  });

  it("challenges a legacy v3 path that becomes a v4 operation", () => {
    const res = call("/api/v3/scan/status/abc");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer realm="VulnRadar"',
    );
    expect(call("/api/v3/admin").headers.get("www-authenticate")).toBeNull();
  });

  it.each([
    ["sec-fetch-mode", "navigate"],
    ["sec-fetch-dest", "document"],
  ])(
    "redirects a navigation (%s: %s) on internal, alias-to-internal and legacy paths",
    (name, value) => {
      for (const path of [
        "/api/internal/__probe",
        "/api/v3/__probe",
        "/api/v3/account/github/connect",
      ]) {
        const res = call(`${path}?next=1`, { headers: { [name]: value } });
        expect(res.status, path).toBe(307);
        const location = new URL(res.headers.get("location") ?? "");
        expect(location.pathname).toBe("/login");
        const decision =
          path === "/api/v3/__probe" ? "/api/internal/__probe" : path;
        expect(location.searchParams.get("redirect")).toBe(
          `${decision}?next=1`,
        );
      }
    },
  );

  it("never redirects a navigation in v4 or other /api", () => {
    enableV4();
    for (const path of ["/api/v4/__probe", "/api/__probe"]) {
      const res = call(path, { headers: { "sec-fetch-mode": "navigate" } });
      expect(res.status, path).toBe(401);
    }
  });

  it("refuses a Bearer-only call on internal and alias-to-internal paths", async () => {
    for (const path of ["/api/internal/__probe", "/api/v3/__probe"]) {
      const res = call(path, { bearer: BEARER });
      await expectEnvelope(res, 401, "UNAUTHENTICATED");
    }
  });

  it("refuses a cookie-only call to the Bearer-only auth/me", async () => {
    enableV4();
    const res = call("/api/v4/auth/me", { cookie: true });
    await expectEnvelope(res, 401, "UNAUTHENTICATED");
    expect(passed(call("/api/v4/auth/me", { bearer: BEARER }))).toBe(true);
    expect(passed(call("/api/v4/history", { cookie: true }))).toBe(true);
  });

  it.each(["bearer vr_k", "BEARER vr_k", "Bearer   vr_k"])(
    "reads %j as a Bearer in v4",
    (bearer) => {
      enableV4();
      expect(passed(call("/api/v4/__probe", { bearer }))).toBe(true);
    },
  );

  it("passes a cookie on internal, alias and other paths", () => {
    for (const path of [
      "/api/internal/__probe",
      "/api/v3/__probe",
      "/api/__probe",
    ]) {
      expect(passed(call(path, { cookie: true })), path).toBe(true);
    }
  });
});

describe("S3: the anonymous list is exact", () => {
  it.each([
    "/api/internal/auth/login",
    "/api/internal/host/example.com/trend",
    "/api/internal/shared/tok/screenshot",
    "/api/v3/auth/login",
  ])("lets %s through without a credential", (path) => {
    expect(passed(call(path))).toBe(true);
  });

  it.each([
    "/api/internal/auth/login/x",
    "/api/internal/auth/loginx",
    "/api/internal/host/a/b/c",
    "/api/internal/shared/tok/screenshot/x",
    "/api/internal/badge/scans",
    "/api/internal/stripe/setup-products",
  ])("does not treat %s as anonymous", async (path) => {
    await expectEnvelope(call(path), 401, "UNAUTHENTICATED");
  });

  it("judges an alias on its target, so a v3 path of an anonymous internal route is anonymous", () => {
    finishMove();
    expect(passed(call("/api/v3/auth/login"))).toBe(true);
    expect(passed(call("/api/v3/finding-types"))).toBe(true);
    expect(call("/api/v3/badge/scans").status).toBe(401);
  });
});

describe("S8: break-glass maintenance on the decision path", () => {
  beforeEach(() => {
    vi.stubEnv("MAINTENANCE_MODE", "true");
  });

  it.each([
    "/api/internal/auth/login",
    "/api/internal/admin",
    "/api/internal/admin/x",
    "/api/v3/auth/login",
    "/api/v3/admin",
    "/api/v3/health",
    "/api/v3/auth/discord/callback",
    "/api/v3/auth/oauth/google/callback",
    "/api/v3/auth/staff-oidc/callback",
    "/api/version",
    "/api/security-txt",
  ])("leaves %s reachable", (path) => {
    expect(call(path, { cookie: true }).status).not.toBe(503);
  });

  it("judges an alias as its target: /api/v3/auth/login is /api/internal/auth/login", () => {
    finishMove();
    expect(call("/api/v3/auth/login").status).not.toBe(503);
    expect(call("/api/v3/admin/x", { cookie: true }).status).not.toBe(503);
  });

  it.each([
    "/api/internal/authx",
    "/api/internal/scan",
    "/api/v3/__probe",
    "/api/v3/history",
    "/api/v3/whoami-ip",
    "/api/__probe",
    "/api/v9/__probe",
  ])("pauses %s with the envelope and paused: true", async (path) => {
    const res = call(path, { cookie: true });
    await expectEnvelope(res, 503, "SERVICE_PAUSED", { paused: true });
    expect(res.headers.get("retry-after")).toBe("300");
  });

  it.each(["/api/v3/webhooks/stripe", "/api/v3/account/unsubscribe"])(
    "answers %s with 503 and Retry-After, so the sender retries",
    async (path) => {
      const res = call(path, { method: "POST" });
      await expectEnvelope(res, 503, "SERVICE_PAUSED", { paused: true });
      expect(res.headers.get("retry-after")).toBe("300");
    },
  );

  it("pauses v4 without the legacy paused key", async () => {
    enableV4();
    const res = call("/api/v4/auth/me", { bearer: BEARER });
    await expectEnvelope(res, 503, "SERVICE_PAUSED");
  });
});

describe("S4: the version marker", () => {
  const MARKER = "x-vr-api-version";

  it("overwrites a client-sent marker on v4", () => {
    enableV4();
    const res = call("/api/v4/history", {
      cookie: true,
      headers: { [MARKER]: "v3" },
    });
    expect(forwarded(res, MARKER)).toBe("v4");
  });

  it("writes v3 for an alias to v4 and for a legacy path", () => {
    expect(
      forwarded(
        call("/api/v3/history", { cookie: true, headers: { [MARKER]: "v4" } }),
        MARKER,
      ),
    ).toBe("v3");
    finishMove();
    expect(
      forwarded(
        call("/api/v3/history", { cookie: true, headers: { [MARKER]: "v4" } }),
        MARKER,
      ),
    ).toBe("v3");
  });

  it("writes internal for internal paths and permalink for permalinks", () => {
    expect(
      forwarded(
        call("/api/internal/__probe", {
          cookie: true,
          headers: { [MARKER]: "v4" },
        }),
        MARKER,
      ),
    ).toBe("internal");
    for (const path of ["/api/v3/health", "/api/version"]) {
      const res = call(path, { headers: { [MARKER]: "v3" } });
      expect(forwarded(res, MARKER), path).toBe("permalink");
    }
  });

  it.each(["/dashboard", "/security.txt", "/.well-known/security.txt"])(
    "deletes a client-sent marker on the page path %s",
    (path) => {
      const res = call(path, { cookie: true, headers: { [MARKER]: "v4" } });
      expect(passed(res)).toBe(true);
      expect(forwardsHeader(res, MARKER)).toBe(false);
    },
  );
});

describe("S2: Authorization reaches only v4, its aliases and legacy v3", () => {
  const removed: Array<[string, string, () => void]> = [
    ["internal", "/api/internal/__probe", () => {}],
    ["alias to internal", "/api/v3/__probe", () => {}],
    ["alias to internal (Move done)", "/api/v3/admin", finishMove],
    ["permalink", "/api/v3/health", () => {}],
    ["permalink (unversioned)", "/api/version", () => {}],
    ["other /api", "/api/__probe", () => {}],
    ["page", "/dashboard", () => {}],
  ];

  it.each(removed)(
    "%s: the route sees no Authorization header",
    (_, path, setup) => {
      setup();
      const res = call(path, { cookie: true, bearer: BEARER });
      expect(passed(res), path).toBe(true);
      expect(forwardsHeader(res, "authorization")).toBe(false);
      expect(forwarded(res, "cookie")).toBe(COOKIE);
    },
  );

  const kept: Array<[string, string, () => void]> = [
    ["v4", "/api/v4/history", enableV4],
    ["alias to v4", "/api/v3/history", finishMove],
    ["legacy v3", "/api/v3/history", () => {}],
  ];

  it.each(kept)("%s: Authorization arrives intact", (_, path, setup) => {
    setup();
    const res = call(path, { bearer: BEARER });
    expect(passed(res), path).toBe(true);
    expect(forwarded(res, "authorization")).toBe(BEARER);
  });
});

describe("S5, S6, S11: aliases are same-origin rewrites decided on their target", () => {
  const sample = (template: string) =>
    template.replace(/:(\w+)/g, (_, name: string) => `${name}-1`);
  const v3Rows = readPre40Routes().filter(
    (row) =>
      row.template.startsWith("/api/v3/") &&
      savedTails.includes(row.template.slice("/api/v3".length)),
  );

  it("covers every route that becomes an alias", () => {
    expect(v3Rows).toHaveLength(158);
  });

  it.each([
    ["plain", {}],
    [
      "hostile Host and X-Forwarded-Host",
      { host: "evil.example", "x-forwarded-host": "evil.example" },
    ],
  ])(
    "rewrites every alias row and method on the request's own origin (%s)",
    (_, hostile: Record<string, string>) => {
      finishMove();
      for (const row of v3Rows) {
        for (const method of row.methods) {
          const path = `${sample(row.template)}?q=a%20b`;
          const request = new NextRequest(`${APP}${path}`, {
            method,
            headers: {
              ...hostile,
              cookie: COOKIE,
              authorization: BEARER,
              origin: APP,
            },
          });
          const res = middleware(request);
          const label = `${method} ${path}`;
          expect(res.status, label).toBe(200);
          expect(res.headers.get("location"), label).toBeNull();
          const rewrite = res.headers.get("x-middleware-rewrite");
          expect(rewrite, label).not.toBeNull();
          const target = new URL(rewrite ?? "");
          expect(target.origin, label).toBe(request.nextUrl.origin);
          expect(target.search, label).toBe("?q=a%20b");
          expect(target.pathname.startsWith("/api/v3/"), label).toBe(false);
        }
      }
    },
  );

  it("sends auth/me to v4 with a Bearer and to internal without one", () => {
    finishMove();
    const withKey = call("/api/v3/auth/me", { bearer: BEARER });
    expect(
      new URL(withKey.headers.get("x-middleware-rewrite") ?? "").pathname,
    ).toBe("/api/v4/auth/me");
    const withCookie = call("/api/v3/auth/me", { cookie: true });
    expect(
      new URL(withCookie.headers.get("x-middleware-rewrite") ?? "").pathname,
    ).toBe("/api/internal/auth/me");
  });

  it("forwards the canonical path as x-pathname", () => {
    finishMove();
    const res = call("/api/v3/history/abc", { cookie: true });
    expect(forwarded(res, "x-pathname")).toBe("/api/v4/history/abc");
  });

  it("never rewrites a permalink or a legacy path", () => {
    expect(
      call("/api/v3/history", { cookie: true }).headers.get(
        "x-middleware-rewrite",
      ),
    ).toBeNull();
    finishMove();
    for (const path of ["/api/v3/health", "/api/v3/webhooks/stripe"]) {
      expect(call(path).headers.get("x-middleware-rewrite"), path).toBeNull();
    }
  });
});

describe("S10: request id and body cap in every space", () => {
  const oversized = String(1024 * 1024 + 1);

  it.each(ALL)(
    "%s: an oversized body is 413 PAYLOAD_TOO_LARGE",
    async (space) => {
      const res = call(probe(space), {
        method: "POST",
        cookie: true,
        origin: APP,
        headers: { "content-length": oversized },
      });
      await expectEnvelope(res, 413, "PAYLOAD_TOO_LARGE");
    },
  );

  it.each(ALL)("%s: every answer carries x-request-id", (space) => {
    const path = probe(space);
    for (const res of [
      call(path),
      call(path, { cookie: true }),
      call(path, { method: "POST" }),
      call(path, { headers: { "sec-fetch-mode": "navigate" } }),
    ]) {
      expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("answers an unsupported version with 404 after CSRF", async () => {
    await expectEnvelope(
      call("/api/v9/__probe", { cookie: true }),
      404,
      "UNSUPPORTED_API_VERSION",
    );
    await expectEnvelope(
      call("/api/v4/__probe", { cookie: true }),
      404,
      "UNSUPPORTED_API_VERSION",
    );
    expect(call("/api/v4/__probe", { method: "POST" }).status).toBe(403);
  });
});

describe("plain HTTP", () => {
  const http = { "x-forwarded-proto": "http" };

  it("refuses a non-GET API call with JSON 403 instead of a redirect that drops the body", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = call("/api/v3/history", {
        method,
        cookie: true,
        origin: APP,
        headers: http,
      });
      await expectEnvelope(res, 403, "FORBIDDEN");
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("still redirects a GET, with a request id", () => {
    const res = call("/api/v3/history", { headers: http });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toMatch(/^https:\/\//);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("exempts the health probe for every method", () => {
    for (const method of ["GET", "POST"]) {
      const res = call("/api/v3/health", {
        method,
        origin: APP,
        headers: http,
      });
      expect(passed(res), method).toBe(true);
    }
  });
});

describe("percent-encoded unreserved characters", () => {
  it("decides an encoded spelling exactly like the plain one", async () => {
    // %61 is "a": the router may serve /api/v3/%61dmin as /api/v3/admin.
    await expectEnvelope(call("/api/v3/%61dmin"), 401, "UNAUTHENTICATED");
    vi.stubEnv("MAINTENANCE_MODE", "true");
    expect(call("/api/v3/%61dmin", { cookie: true }).status).not.toBe(503);
    expect(call("/api/v3/webhooks/%73tripe", { method: "POST" }).status).toBe(
      503,
    );
  });

  it("leaves reserved escapes encoded", () => {
    const res = call("/api/v3/host/a%2Fb", {});
    expect(passed(res)).toBe(true);
  });

  // A production router also looks a static route up by its decoded path, so
  // an escaped prefix reaches /api/v3/scan. It used to be judged as a page: a
  // cross-site write with a cookie and an oversized body went straight
  // through.
  it.each(["/%61pi/v3/scan", "/%61%70%69/v3/scan", "/ap%69/v3/scan"])(
    "judges %s as the API path it is served as",
    async (path) => {
      await expectEnvelope(
        call(path, {
          method: "POST",
          cookie: true,
          origin: "https://evil.example",
        }),
        403,
        "CSRF_REJECTED",
      );
      await expectEnvelope(
        call(path, {
          method: "POST",
          cookie: true,
          origin: APP,
          headers: { "content-length": String(10 * 1024 * 1024) },
        }),
        413,
        "PAYLOAD_TOO_LARGE",
      );
      await expectEnvelope(call(path), 401, "UNAUTHENTICATED", {});
      const res = call(path, { cookie: true });
      expect(forwarded(res, "x-vr-api-version")).toBe("v3");
      expect(forwarded(res, "x-pathname")).toBe("/api/v3/scan");
    },
  );

  it.each(["/api%2Fv3%2Fscan", "/api%2fv3/scan", "/%61pi%2Fv3%2Fscan"])(
    "refuses %s, whose prefix only an escaped separator hides",
    async (path) => {
      await expectEnvelope(
        call(path, {
          method: "POST",
          cookie: true,
          origin: "https://evil.example",
        }),
        404,
        "NOT_FOUND",
      );
      await expectEnvelope(call(path, { cookie: true }), 404, "NOT_FOUND");
    },
  );

  it("leaves a page with an escaped character a page", () => {
    const res = call("/%70ricing");
    expect(res.status).not.toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("json");
  });
});
