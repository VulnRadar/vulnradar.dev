import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  DOCUMENTED_SESSION_ONLY,
  INTERNAL_ANONYMOUS,
  INTERNAL_MAINTENANCE,
  LEGACY_PUBLIC_API,
  LEGACY_V3_TAILS,
  PERMALINKS,
  PREFIX,
  V4_ROUTES,
  isLegacyPublicApi,
  matchTemplate,
  matchV4,
  resolveApiPath,
  type V4Route,
} from "@/lib/api/route-registry";
import { PUBLIC_PATHS } from "@/lib/config/public-paths";

const ALL_SUPPORTED = ["v3", "v4"] as const;

/** The migration ratchet is a mutable array at runtime; tests that need the finished state empty it. */
const legacyTails = LEGACY_V3_TAILS as string[];
const savedTails = [...legacyTails];
afterEach(() => {
  legacyTails.splice(0, legacyTails.length, ...savedTails);
});
function finishMigration() {
  legacyTails.length = 0;
}

const sample = (template: string) =>
  template.replace(/:(\w+)/g, (_, name: string) => `${name}-1`);

describe("registry data", () => {
  it("has the counts the design fixes", () => {
    expect(V4_ROUTES).toHaveLength(19);
    expect(PERMALINKS).toHaveLength(12);
    expect(INTERNAL_ANONYMOUS).toHaveLength(25);
    expect(DOCUMENTED_SESSION_ONLY).toHaveLength(18);
    expect(LEGACY_V3_TAILS).toHaveLength(158);
  });

  it("carries no duplicate entries", () => {
    const lists: Record<string, readonly string[]> = {
      v4: V4_ROUTES.map((route) => route.template),
      permalinks: PERMALINKS.map((link) => link.template),
      anonymous: INTERNAL_ANONYMOUS.map((entry) => entry.template),
      documented: DOCUMENTED_SESSION_ONLY,
      legacy: LEGACY_V3_TAILS,
      legacyPublic: LEGACY_PUBLIC_API,
    };
    for (const [name, list] of Object.entries(lists)) {
      expect(new Set(list).size, name).toBe(list.length);
    }
  });

  it("writes tail templates relative to their prefix and permalinks in full", () => {
    for (const route of V4_ROUTES) expect(route.template).toMatch(/^\/[^/]/);
    for (const tail of LEGACY_V3_TAILS) expect(tail).toMatch(/^\/[^/]/);
    for (const entry of INTERNAL_ANONYMOUS) {
      expect(entry.template).toMatch(/^\/[^/]/);
      expect(entry.why.length).toBeGreaterThan(10);
      expect(entry.why).not.toMatch(/[\u2013\u2014\u00b7]/);
    }
    for (const link of PERMALINKS) expect(link.template).toMatch(/^\/api\//);
  });

  it("marks only auth/me as Bearer-required, and only the three anonymous operations as none", () => {
    expect(
      V4_ROUTES.filter((r) => r.bearer === "required").map((r) => r.template),
    ).toEqual(["/auth/me"]);
    expect(
      V4_ROUTES.filter((r) => r.bearer === "none")
        .map((r) => r.template)
        .sort(),
    ).toEqual(["/demo-scan", "/finding-types", "/openapi.json"]);
  });

  it("gives demo-scan the CSRF exemption and finding-types the sunset exemption, and nobody else", () => {
    expect(
      V4_ROUTES.filter((r) => r.csrfExempt).map((r) => r.template),
    ).toEqual(["/demo-scan"]);
    expect(
      V4_ROUTES.filter((r) => r.sunsetExempt).map((r) => r.template),
    ).toEqual(["/finding-types"]);
  });

  it("flags the permalinks the way the design table does", () => {
    const flagged = (
      flag:
        "csrfExempt" | "maintenance" | "plainHttpExempt" | "corpCrossOrigin",
    ) => PERMALINKS.filter((link) => link[flag]).map((link) => link.template);

    expect(flagged("csrfExempt")).toEqual([
      "/api/v3/webhooks/stripe",
      "/api/v3/account/unsubscribe",
      "/api/v3/auth/discord/callback",
      "/api/version",
      "/api/security-txt",
    ]);
    expect(flagged("maintenance")).toEqual([
      "/api/v3/health",
      "/api/v3/auth/discord/callback",
      "/api/v3/auth/oauth/:provider/callback",
      "/api/v3/auth/staff-oidc/callback",
      "/api/version",
      "/api/security-txt",
    ]);
    expect(flagged("plainHttpExempt")).toEqual(["/api/v3/health"]);
    expect(flagged("corpCrossOrigin")).toEqual(["/api/v3/badge/:token"]);
  });

  it("keeps the Stripe webhook and unsubscribe out of maintenance mode", () => {
    for (const template of [
      "/api/v3/webhooks/stripe",
      "/api/v3/account/unsubscribe",
    ]) {
      expect(PERMALINKS.find((l) => l.template === template)?.maintenance).toBe(
        undefined,
      );
    }
  });

  it("lets the badge token exclude its two session siblings", () => {
    expect(
      PERMALINKS.find((l) => l.template === "/api/v3/badge/:token")?.except,
    ).toEqual(["scans", "site"]);
  });

  it("holds the staff way back in as the only maintenance prefixes under internal", () => {
    expect(INTERNAL_MAINTENANCE).toEqual(["/auth", "/admin"]);
  });

  it("names exactly 23 operations across the v4 routes", () => {
    const ids = V4_ROUTES.flatMap((route) => Object.values(route.operations));
    expect(ids).toHaveLength(23);
    expect(new Set(ids).size).toBe(23);
  });

  it("imports nothing, so the edge bundle stays a leaf", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../../../lib/api/route-registry.ts", import.meta.url),
      ),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});

describe("matchTemplate", () => {
  it("matches a parameter against exactly one non-empty segment", () => {
    expect(matchTemplate("/history/:id", "/history/abc")).toBe(true);
    expect(matchTemplate("/history/:id", "/history")).toBe(false);
    expect(matchTemplate("/history/:id", "/history/")).toBe(false);
    expect(matchTemplate("/history/:id", "/history//")).toBe(false);
    expect(matchTemplate("/history/:id", "/history/a/b")).toBe(false);
  });

  it("never matches by prefix", () => {
    expect(matchTemplate("/scan", "/scan/crawl")).toBe(false);
    expect(matchTemplate("/scan/crawl", "/scan")).toBe(false);
    expect(matchTemplate("/history/:id", "/history/abc/delete")).toBe(false);
  });

  it("compares static segments exactly, including case", () => {
    expect(matchTemplate("/scan", "/Scan")).toBe(false);
    expect(matchTemplate("/scan", "/scan")).toBe(true);
  });
});

describe("static beats dynamic", () => {
  it("prefers the static template whichever order the rows are listed in", () => {
    const dynamic: V4Route = {
      template: "/history/:id",
      bearer: "optional",
      operations: { GET: "t.dynamic" },
    };
    const fixed: V4Route = {
      template: "/history/resolve",
      bearer: "optional",
      operations: { GET: "t.static" },
    };
    const rows = V4_ROUTES as V4Route[];
    const original = [...rows];
    try {
      for (const order of [
        [dynamic, fixed],
        [fixed, dynamic],
      ]) {
        rows.splice(0, rows.length, ...order);
        expect(matchV4("/history/resolve")?.operations.GET).toBe("t.static");
        expect(matchV4("/history/abc")?.operations.GET).toBe("t.dynamic");
      }
    } finally {
      rows.splice(0, rows.length, ...original);
    }
  });
});

describe("resolveApiPath: page and other-api", () => {
  it("treats anything outside /api as a page", () => {
    for (const path of ["/", "/dashboard", "/api-docs", "/apix", "/docs/api"]) {
      expect(resolveApiPath(path, false)).toEqual({ kind: "page" });
    }
  });

  it("treats the bare /api and unknown names under it as other-api", () => {
    expect(resolveApiPath("/api", false)).toEqual({
      kind: "other-api",
      path: "/api",
    });
    expect(resolveApiPath("/api/", false)).toEqual({
      kind: "other-api",
      path: "/api",
    });
    expect(resolveApiPath("/api/nothing/here", false)).toEqual({
      kind: "other-api",
      path: "/api/nothing/here",
    });
    expect(resolveApiPath("/api//x", false).kind).toBe("other-api");
    expect(resolveApiPath("/api/V3/scan", false).kind).toBe("other-api");
    expect(resolveApiPath("/api/v3x/scan", false).kind).toBe("other-api");
  });

  it("reports any other numbered version as unsupported", () => {
    expect(resolveApiPath("/api/v9/scan", false, ALL_SUPPORTED)).toEqual({
      kind: "unsupported-version",
      version: "v9",
    });
    expect(resolveApiPath("/api/v2/scan", true)).toEqual({
      kind: "unsupported-version",
      version: "v2",
    });
    expect(resolveApiPath("/api/v10", false).kind).toBe("unsupported-version");
  });

  it("ignores one trailing slash, as the middleware normalisation does", () => {
    expect(resolveApiPath("/api/v3/health/", false).kind).toBe("permalink");
    expect(resolveApiPath("/api/version/", false).kind).toBe("permalink");
  });
});

describe("resolveApiPath: permalinks come first", () => {
  it.each(PERMALINKS.map((link) => [link.template, link] as const))(
    "resolves %s to itself",
    (template, link) => {
      const path = sample(template);
      expect(resolveApiPath(path, false, ALL_SUPPORTED)).toEqual({
        kind: "permalink",
        path,
        link,
      });
    },
  );

  it("is decided before the alias rules, in every migration state", () => {
    for (const migrated of [false, true]) {
      if (migrated) finishMigration();
      expect(resolveApiPath("/api/v3/webhooks/stripe", false).kind).toBe(
        "permalink",
      );
      expect(resolveApiPath("/api/v3/health", false).kind).toBe("permalink");
      expect(resolveApiPath("/api/v3/openapi.json", true).kind).toBe(
        "permalink",
      );
    }
  });

  it("is a permalink regardless of a Bearer header", () => {
    expect(resolveApiPath("/api/v3/avatar/12", true).kind).toBe("permalink");
  });

  it("does not extend a permalink to a longer path", () => {
    for (const path of [
      "/api/v3/health/x",
      "/api/v3/webhooks/stripe/x",
      "/api/v3/account/unsubscribe/x",
      "/api/v3/whoami-ip/x",
      "/api/version/x",
      "/api/security-txt/x",
      "/api/v3/avatar",
      "/api/v3/auth/oauth/google/callback/x",
    ]) {
      expect(resolveApiPath(path, false).kind, path).not.toBe("permalink");
    }
  });

  it("does not match a permalink on a percent-encoded spelling of it", () => {
    expect(resolveApiPath("/api/v3/hea%6Cth", false).kind).not.toBe(
      "permalink",
    );
    expect(resolveApiPath("/api/v3/webhooks/str%69pe", false).kind).not.toBe(
      "permalink",
    );
  });

  it("keeps the badge token a permalink for any token, even a malformed one", () => {
    const hex = "ab".repeat(32);
    expect(resolveApiPath(`/api/v3/badge/${hex}`, false).kind).toBe(
      "permalink",
    );
    expect(resolveApiPath("/api/v3/badge/abc", false).kind).toBe("permalink");
  });

  it("never lets the badge token swallow its two session siblings", () => {
    for (const migrated of [false, true]) {
      if (migrated) finishMigration();
      for (const sibling of ["scans", "site"]) {
        const resolved = resolveApiPath(`/api/v3/badge/${sibling}`, false);
        expect(resolved.kind, sibling).not.toBe("permalink");
      }
    }
    finishMigration();
    expect(resolveApiPath("/api/v3/badge/scans", false)).toMatchObject({
      kind: "alias",
      target: "internal",
      to: "/api/internal/badge/scans",
    });
    expect(resolveApiPath("/api/v3/badge/site", false)).toMatchObject({
      kind: "alias",
      target: "internal",
      to: "/api/internal/badge/site",
    });
  });
});

describe("resolveApiPath: /api/v4", () => {
  it("stays dark unless v4 is in the supported list", () => {
    const dark = { kind: "unsupported-version", version: "v4" };
    expect(resolveApiPath("/api/v4/scan", true)).toEqual(dark);
    expect(resolveApiPath("/api/v4/scan", true, [])).toEqual(dark);
    expect(resolveApiPath("/api/v4/scan", true, ["v3"])).toEqual(dark);
    expect(resolveApiPath("/api/v4", true, ["v3"])).toEqual(dark);
  });

  it("matches a registered route once v4 is supported", () => {
    const resolved = resolveApiPath("/api/v4/history/abc/report", false, [
      "v3",
      "v4",
    ]);
    expect(resolved).toMatchObject({
      kind: "v4",
      path: "/api/v4/history/abc/report",
    });
    expect(resolved.kind === "v4" && resolved.route?.template).toBe(
      "/history/:id/report",
    );
  });

  it("reports an unknown v4 path with no route, for the catch-all to answer", () => {
    expect(resolveApiPath("/api/v4/keys", true, ALL_SUPPORTED)).toEqual({
      kind: "v4",
      path: "/api/v4/keys",
      route: null,
    });
    expect(resolveApiPath("/api/v4", true, ALL_SUPPORTED)).toEqual({
      kind: "v4",
      path: "/api/v4",
      route: null,
    });
  });

  it("does not let a shorter route swallow a longer path", () => {
    const resolved = resolveApiPath(
      "/api/v4/scan/crawl/discover",
      true,
      ALL_SUPPORTED,
    );
    expect(resolved.kind === "v4" && resolved.route?.template).toBe(
      "/scan/crawl/discover",
    );
    expect(
      resolveApiPath("/api/v4/history/abc/delete", true, ALL_SUPPORTED),
    ).toMatchObject({ kind: "v4", route: null });
  });

  it("carries the v4 row for a Bearer-required route", () => {
    const resolved = resolveApiPath("/api/v4/auth/me", true, ALL_SUPPORTED);
    expect(resolved.kind === "v4" && resolved.route?.bearer).toBe("required");
  });
});

describe("resolveApiPath: /api/internal", () => {
  it.each(INTERNAL_ANONYMOUS.map((entry) => [entry.template] as const))(
    "marks %s anonymous",
    (template) => {
      const path = `${PREFIX.INTERNAL}${sample(template)}`;
      expect(resolveApiPath(path, false)).toEqual({
        kind: "internal",
        path,
        anonymous: true,
      });
    },
  );

  it("does not mark a path anonymous because it shares a prefix with an entry", () => {
    for (const tail of [
      "/auth/login/x",
      "/auth/oauth",
      "/auth/oauth/google/callback",
      "/auth/staff-invite",
      "/auth/staff-oidc/callback",
      "/billing",
      "/billing/plan-limits/x",
      "/contact/x",
      "/host",
      "/host/example.com/x/y",
      "/shared",
      "/shares",
      "/badge/scans",
      "/badge/site",
      "/stripe/setup-webhook",
      "/stripe/setup-products",
      "/notifications/active",
      "/ai/conversations",
      "/ai/chat",
      "/public-scans/x",
      "/admin",
      "/history/abc",
    ]) {
      expect(resolveApiPath(`/api/internal${tail}`, false), tail).toMatchObject(
        {
          kind: "internal",
          anonymous: false,
        },
      );
    }
  });

  it("never treats a Bearer header as anything on an internal path", () => {
    expect(resolveApiPath("/api/internal/history/abc", true)).toEqual(
      resolveApiPath("/api/internal/history/abc", false),
    );
  });

  it("resolves the bare prefix as an internal path with no route", () => {
    expect(resolveApiPath("/api/internal", false)).toEqual({
      kind: "internal",
      path: "/api/internal",
      anonymous: false,
    });
  });
});

describe("resolveApiPath: /api/v3 while files have not moved", () => {
  it("decides every real tail by the old rules", () => {
    for (const tail of LEGACY_V3_TAILS) {
      const path = `${PREFIX.V3}${sample(tail)}`;
      expect(resolveApiPath(path, false), path).toEqual({
        kind: "legacy-v3",
        path,
      });
    }
  });

  it("aliases a tail that is not a real route to internal, where the catch-all answers", () => {
    expect(resolveApiPath("/api/v3/nothing", false)).toMatchObject({
      kind: "alias",
      target: "internal",
      to: "/api/internal/nothing",
      documentedSessionOnly: false,
    });
  });

  it("does not treat a longer path under a legacy tail as that tail", () => {
    expect(resolveApiPath("/api/v3/scan/crawl/discover/x", false).kind).toBe(
      "alias",
    );
    expect(resolveApiPath("/api/v3/history/abc/delete/x", false).kind).toBe(
      "alias",
    );
  });
});

describe("resolveApiPath: /api/v3 aliases once the files have moved", () => {
  it("sends a public tail to its v4 path, keeping path parameters", () => {
    finishMigration();
    expect(
      resolveApiPath("/api/v3/history/abc123/report", false),
    ).toMatchObject({
      kind: "alias",
      from: "/api/v3/history/abc123/report",
      to: "/api/v4/history/abc123/report",
      target: "v4",
      documentedSessionOnly: false,
    });
    expect(resolveApiPath("/api/v3/scan/status/42", true)).toMatchObject({
      to: "/api/v4/scan/status/42",
      target: "v4",
    });
    expect(
      resolveApiPath("/api/v3/scan/discover/progress/tok-1", false),
    ).toMatchObject({ to: "/api/v4/scan/discover/progress/tok-1" });
  });

  it("answers every v4 template through its alias", () => {
    finishMigration();
    for (const route of V4_ROUTES) {
      if (route.template === "/openapi.json") continue;
      const resolved = resolveApiPath(
        `${PREFIX.V3}${sample(route.template)}`,
        true,
      );
      expect(resolved, route.template).toMatchObject({
        kind: "alias",
        target: "v4",
        to: `${PREFIX.V4}${sample(route.template)}`,
      });
      expect(resolved.kind === "alias" && resolved.route).toBe(route);
    }
  });

  it("splits auth/me on the Bearer header", () => {
    finishMigration();
    expect(resolveApiPath("/api/v3/auth/me", true)).toMatchObject({
      target: "v4",
      to: "/api/v4/auth/me",
    });
    expect(resolveApiPath("/api/v3/auth/me", false)).toMatchObject({
      target: "internal",
      to: "/api/internal/auth/me",
      documentedSessionOnly: false,
    });
  });

  it("keeps finding-types on the alias with its sunset exemption", () => {
    finishMigration();
    const resolved = resolveApiPath("/api/v3/finding-types", false);
    expect(resolved.kind === "alias" && resolved.route?.sunsetExempt).toBe(
      true,
    );
  });

  it("does not let history/:id swallow the internal history routes", () => {
    finishMigration();
    for (const tail of [
      "/history/abc/delete",
      "/history/abc/dns",
      "/history/abc/ports",
      "/history/abc/screenshot",
      "/history/abc/share",
      "/history/abc/share/publicly-listed",
    ]) {
      expect(resolveApiPath(`/api/v3${tail}`, true), tail).toMatchObject({
        kind: "alias",
        target: "internal",
        to: `/api/internal${tail}`,
      });
    }
  });

  it("sends everything else to internal, and flags the documented session-only ones", () => {
    finishMigration();
    expect(resolveApiPath("/api/v3/admin/backup", true)).toMatchObject({
      target: "internal",
      to: "/api/internal/admin/backup",
      documentedSessionOnly: false,
    });
    for (const template of DOCUMENTED_SESSION_ONLY) {
      expect(
        resolveApiPath(`/api/v3${sample(template)}`, false),
        template,
      ).toMatchObject({ target: "internal", documentedSessionOnly: true });
    }
  });

  it("never turns the Stripe webhook into the webhooks/:id alias", () => {
    finishMigration();
    expect(resolveApiPath("/api/v3/webhooks/stripe", false).kind).toBe(
      "permalink",
    );
    expect(resolveApiPath("/api/v3/webhooks/123", false)).toMatchObject({
      kind: "alias",
      to: "/api/internal/webhooks/123",
      documentedSessionOnly: true,
    });
  });

  it("preserves a percent-encoded segment untouched", () => {
    finishMigration();
    expect(resolveApiPath("/api/v3/host/ex%20ample.com", false)).toMatchObject({
      to: "/api/internal/host/ex%20ample.com",
    });
  });
});

describe("the legacy public list", () => {
  it("is the prefix test the 3.9.1 middleware applied", () => {
    expect(isLegacyPublicApi("/api/v3/auth/login")).toBe(true);
    expect(isLegacyPublicApi("/api/v3/host/example.com/trend")).toBe(true);
    // The prefix is over-broad on purpose; the exact internal list is not.
    expect(isLegacyPublicApi("/api/v3/badge/scans")).toBe(true);
    expect(isLegacyPublicApi("/api/v3/scan")).toBe(false);
    expect(isLegacyPublicApi("/api/v3/history")).toBe(false);
    expect(isLegacyPublicApi("/api/v3/auth/me")).toBe(false);
  });

  // Once the middleware work moves these entries out of PUBLIC_PATHS this has
  // nothing left to compare against, and the registry is the only copy.
  const current = PUBLIC_PATHS.filter((entry) => entry.startsWith("/api/"));
  it.skipIf(current.length === 0)(
    "is a verbatim copy of the API entries of PUBLIC_PATHS",
    () => {
      expect([...LEGACY_PUBLIC_API]).toEqual(current);
    },
  );
});
