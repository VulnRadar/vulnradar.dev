/**
 * The riskiest translation in the 4.0.0 routing work (spec 12.1 item 4): the
 * 3.9.1 middleware decided who may call an API route without a credential,
 * which writes skip the Origin check and what stays up during maintenance
 * from three hand-kept prefix lists. The new middleware decides all three
 * from the route registry. This file carries a copy of those three lists and
 * their matching logic exactly as tag v3.9.1 shipped them, runs every route
 * of the pre-4.0 inventory through both, and fails on any difference that is
 * not listed below with its reason.
 *
 * It runs twice: on the tree as it is (every v3 tail still decided by the
 * legacy rules) and with the Move simulated (no legacy tails, v4 served), so
 * the alias rows are checked against 3.9.1 before a single file moves.
 *
 * The copies are frozen. Never edit them to make a difference go away: a new
 * difference is either a bug or a decision, and a decision is a new line in
 * the permitted lists with the reason next to it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { LEGACY_PUBLIC_API, LEGACY_V3_TAILS } from "@/lib/api/route-registry";
import { CONFIG_API_SUPPORTED_VERSIONS } from "@/lib/config/config-values";
import { PUBLIC_PATHS } from "@/lib/config/public-paths";
import { readPre40Routes } from "../_helpers/api-routes";

const { middleware } = await import("@/middleware");

// ---- v3.9.1, verbatim (lib/config/public-paths.ts with API_VERSION "v3") ----

const PUBLIC_PATHS_3_9_1 = [
  "/",
  "/landing",
  "/donate",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/api/v3/auth/login",
  "/api/v3/auth/signup",
  "/api/v3/auth/forgot-password",
  "/api/v3/auth/reset-password",
  "/api/v3/auth/accept-tos",
  "/api/v3/auth/2fa/verify",
  "/api/v3/auth/verify-email",
  "/api/v3/auth/resend-verification",
  "/api/v3/auth/discord",
  "/api/v3/auth/discord/callback",
  "/api/v3/auth/oauth",
  "/api/v3/auth/staff-oidc",
  "/api/v3/auth/2fa/email-send",
  "/legal",
  "/legal/terms",
  "/legal/privacy",
  "/legal/disclaimer",
  "/legal/acceptable-use",
  "/legal/dmca",
  "/legal/accessibility",
  "/pricing",
  "/docs",
  "/changelog",
  "/contact",
  "/security",
  "/checks",
  "/alternatives",
  "/tools",
  "/sitemap.xml",
  "/robots.txt",
  "/llms.txt",
  "/llms-full.txt",
  "/api/v3/health",
  "/api/version",
  "/api/security-txt",
  "/api/v3/whoami-ip",
  "/api/v3/openapi.json",
  "/api/v3/billing/plan-limits",
  "/api/v3/config/client",
  "/.well-known/security.txt",
  "/security.txt",
  "/manifest.webmanifest",
  "/.well-known/mta-sts.txt",
  "/gitlab",
  "/api/v3/webhooks/stripe",
  "/api/v3/stripe/setup-webhook",
  "/api/v3/stripe/setup-products",
  "/shared",
  "/api/v3/shared",
  "/public-scans",
  "/api/v3/public-scans",
  "/demo",
  "/api/v3/demo-scan",
  "/api/v3/landing-contact",
  "/api/v3/contact",
  "/api/v3/badge",
  "/api/v3/avatar",
  "/api/v3/finding-types",
  "/api/v3/ai/info",
  "/unsubscribe",
  "/api/v3/account/unsubscribe",
  "/checkout/success",
  "/teams/join",
  "/staff-invite",
  "/api/v3/auth/staff-invite",
  "/host",
  "/api/v3/host",
] as const;

function isPublic391(pathname: string): boolean {
  return PUBLIC_PATHS_3_9_1.some((p) =>
    p === "/" || p === "/landing" ? pathname === p : pathname.startsWith(p),
  );
}

function csrfChecked391(pathname: string): boolean {
  const exempt =
    pathname === "/api/v3/webhooks/stripe" ||
    pathname === "/api/v3/account/unsubscribe" ||
    pathname === "/api/v3/auth/discord/callback" ||
    pathname === "/api/v3/demo-scan" ||
    pathname === "/api/v3/version" ||
    pathname === "/api/security-txt" ||
    pathname === "/.well-known/security.txt" ||
    pathname === "/security.txt";
  return pathname.startsWith("/api/v3/") && !exempt;
}

const MAINTENANCE_ALWAYS_ALLOWED_3_9_1 = [
  "/api/v3/health",
  "/api/v3/version",
  "/api/security-txt",
  "/.well-known/security.txt",
  "/security.txt",
  "/api/v3/auth",
  "/api/v3/admin",
  "/login",
  "/admin",
  "/_next",
  "/manifest.webmanifest",
  "/robots.txt",
] as const;

function maintenanceAllowed391(pathname: string): boolean {
  return MAINTENANCE_ALWAYS_ALLOWED_3_9_1.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

// ---- the permitted differences ---------------------------------------------

/** Paths whose anonymous answer may differ from 3.9.1, and why. */
const ANONYMOUS_NOW: Record<string, string> = {
  "/api/v3/account/language":
    "made public after 3.9.1 so a signed-out visitor can change the site language",
};
const ANONYMOUS_AFTER_MOVE: Record<string, string> = {
  ...ANONYMOUS_NOW,
  "/api/v3/badge/scans":
    "session JSON that sat under the public /badge prefix; the handler refused it anyway",
  "/api/v3/badge/site":
    "session JSON that sat under the public /badge prefix; the handler refused it anyway",
  "/api/v3/stripe/setup-products":
    "an admin setup action that was public only by a wrong comment",
  "/api/v3/stripe/setup-webhook":
    "an admin setup action that was public only by a wrong comment",
};
/** None: every route is Origin-checked exactly as before. */
const CSRF: Record<string, string> = {};
const MAINTENANCE: Record<string, string> = {
  "/api/version":
    "3.9.1 listed the dead /api/v3/version instead, so the version endpoint was paused with everything else",
};

// ---- the harness ------------------------------------------------------------

const APP = "https://vulnradar.dev";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const sample = (template: string) =>
  template.replace(/:(\w+)/g, (_, name: string) => `${name}-1`);

const rows = readPre40Routes().map((row) => ({
  path: sample(row.template),
  methods: row.methods,
}));

const legacyTails = LEGACY_V3_TAILS as string[];
const savedTails = [...legacyTails];
const versions = CONFIG_API_SUPPORTED_VERSIONS as string[];
const savedVersions = [...versions];

function simulateMove() {
  legacyTails.length = 0;
  if (!versions.includes("v4")) versions.push("v4");
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

function call(path: string, method: string, headers: Record<string, string>) {
  return middleware(new NextRequest(`${APP}${path}`, { method, headers }));
}

/** Anonymous: no cookie, no key, a same-origin Origin so CSRF is not the answer. */
function anonymousNow(path: string, methods: readonly string[]): boolean {
  const res = call(path, methods[0], { origin: APP });
  return res.status !== 401 && res.headers.get("location") === null;
}

/** Origin-checked: a write with a cookie and no Origin is refused. */
function csrfCheckedNow(path: string, methods: readonly string[]): boolean {
  const method = methods.find((m) => MUTATING.has(m)) ?? "POST";
  return call(path, method, { cookie: "vulnradar_session=abc" }).status === 403;
}

function maintenanceAllowedNow(path: string): boolean {
  vi.stubEnv("MAINTENANCE_MODE", "true");
  try {
    return (
      call(path, "GET", { cookie: "vulnradar_session=abc" }).status !== 503
    );
  } finally {
    vi.stubEnv("MAINTENANCE_MODE", "");
  }
}

function differences(
  now: (path: string, methods: readonly string[]) => boolean,
  before: (path: string) => boolean,
): string[] {
  return rows
    .filter((row) => now(row.path, row.methods) !== before(row.path))
    .map((row) => row.path)
    .sort();
}

// Dynamic rows are sampled ("id-1"), so the permitted keys are matched on the
// same sampled form.
const sampled = (list: Record<string, string>) =>
  Object.keys(list).map(sample).sort();

describe("the frozen 3.9.1 copies", () => {
  it("cover the inventory", () => {
    expect(rows).toHaveLength(170);
  });

  it("are the lists the legacy rules still read, apart from two recorded changes", () => {
    const api391: string[] = PUBLIC_PATHS_3_9_1.filter((p) =>
      p.startsWith("/api/"),
    );
    // landing-contact: the route and its entry were deleted after 3.9.1.
    // account/language: added after 3.9.1 (ANONYMOUS_NOW says why).
    const expected = api391.filter((p) => p !== "/api/v3/landing-contact");
    expected.splice(
      expected.indexOf("/api/v3/whoami-ip") + 1,
      0,
      "/api/v3/account/language",
    );
    expect([...LEGACY_PUBLIC_API]).toEqual(expected);
  });

  it("keep their pages in PUBLIC_PATHS, which gained only the brand kit", () => {
    const pages391 = PUBLIC_PATHS_3_9_1.filter((p) => !p.startsWith("/api/"));
    expect([...PUBLIC_PATHS].filter((p) => p !== "/brand")).toEqual(pages391);
  });
});

describe.each([
  ["on the tree as it is", () => {}, ANONYMOUS_NOW],
  ["with the Move simulated", simulateMove, ANONYMOUS_AFTER_MOVE],
] as const)("against 3.9.1, %s", (_, setup, anonymousPermitted) => {
  it("lets the same routes through without a credential", () => {
    setup();
    const diff = differences(anonymousNow, isPublic391);
    expect(
      diff.filter((p) => !sampled(anonymousPermitted).includes(p)),
    ).toEqual([]);
  });

  it("Origin-checks the same writes", () => {
    setup();
    const diff = differences(csrfCheckedNow, csrfChecked391);
    expect(diff.filter((p) => !sampled(CSRF).includes(p))).toEqual([]);
  });

  it("keeps the same routes up during break-glass maintenance", () => {
    setup();
    const diff = differences(maintenanceAllowedNow, maintenanceAllowed391);
    expect(diff.filter((p) => !sampled(MAINTENANCE).includes(p))).toEqual([]);
  });
});

describe("with the Move simulated, the permitted differences are exactly the recorded ones", () => {
  it("for the anonymous surface", () => {
    simulateMove();
    expect(differences(anonymousNow, isPublic391)).toEqual(
      sampled(ANONYMOUS_AFTER_MOVE),
    );
  });

  it("for maintenance", () => {
    simulateMove();
    expect(differences(maintenanceAllowedNow, maintenanceAllowed391)).toEqual(
      sampled(MAINTENANCE),
    );
  });
});
