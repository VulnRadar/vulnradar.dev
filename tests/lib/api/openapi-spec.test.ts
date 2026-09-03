import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApiSpec } from "@/lib/api/openapi-spec";

/* eslint-disable @typescript-eslint/no-explicit-any -- spec is an untyped
   OpenAPI document; the test walks it structurally. */

describe("buildOpenApiSpec", () => {
  const spec = buildOpenApiSpec("https://example.com") as any;

  it("is a valid-shaped OpenAPI 3.1 document with our own server", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info?.title).toBeTruthy();
    expect(spec.info?.version).toBeTruthy();
  });

  // servers[0] must stay relative so a self-hosted deployment, whose compiled
  // APP_URL is the public SaaS host, still points the playground and generated
  // clients at itself. ref: AUDIT-014#apidoc-03
  it("advertises a relative server first and the compiled origin second", () => {
    expect(spec.servers?.[0]?.url).toBe("/api/v3");
    expect(spec.servers?.[1]?.url).toBe("https://example.com/api/v3");
  });

  it("documents the core scan + history + report paths", () => {
    expect(spec.paths["/scan"]?.post).toBeTruthy();
    expect(spec.paths["/scan/status/{id}"]?.get).toBeTruthy();
    expect(spec.paths["/scan/status/{id}"]?.delete).toBeTruthy();
    expect(spec.paths["/history/{id}/report"]?.get).toBeTruthy();

    const fmt = spec.paths["/history/{id}/report"].parameters.find(
      (p: any) => p.name === "format",
    );
    expect(fmt.schema.enum).toContain("sarif");
    expect(fmt.schema.enum).toContain("compliance");
    // The route defaults format to json and accepts `markdown` as an alias for
    // `md`, so the spec must not mark it required or omit the alias.
    // ref: AUDIT-014#apidoc-30
    expect(fmt.required).toBeFalsy();
    expect(fmt.schema.default).toBe("json");
    expect(fmt.schema.enum).toContain("markdown");
  });

  // Every path the spec lists must document all of that route's exported
  // methods; a write-only resource in the spec means a generated SDK and the
  // docs playground silently lose the update and delete operations.
  // ref: AUDIT-014#apidoc-15
  it("documents the mutating methods on the paths it already lists", () => {
    expect(spec.paths["/history"]?.delete).toBeTruthy();
    expect(spec.paths["/history/{id}"]?.patch).toBeTruthy();
    expect(spec.paths["/history/{id}"]?.delete).toBeTruthy();
    expect(spec.paths["/scan/remediation"]?.get).toBeTruthy();
    expect(spec.paths["/scan/remediation"]?.delete).toBeTruthy();
    expect(spec.paths["/schedules"]?.patch).toBeTruthy();
    expect(spec.paths["/schedules"]?.delete).toBeTruthy();
    expect(spec.paths["/teams"]?.patch).toBeTruthy();
    expect(spec.paths["/teams"]?.delete).toBeTruthy();
  });

  // The hand-written list above only catches the ten operations the audit
  // already found. This one is mechanical: it reads every route file the spec
  // names and compares its exported HTTP methods against the operations
  // documented for that path, in BOTH directions. Adding a DELETE to a route
  // the spec already lists, or documenting a method the route dropped, now
  // fails here rather than shipping a spec that lies about the API.
  // ref: AUDIT-014#apidoc-15
  it("documents exactly the methods each listed route actually exports", () => {
    const METHODS = ["get", "post", "put", "patch", "delete"] as const;
    const root = process.cwd();
    const mismatches: string[] = [];

    for (const [specPath, item] of Object.entries(
      spec.paths as Record<string, any>,
    )) {
      // OpenAPI templating ({id}) maps onto Next's dynamic segments ([id]).
      const routeFile = join(
        root,
        "app/api/v3",
        specPath.replace(/\{(\w+)\}/g, "[$1]"),
        "route.ts",
      );
      if (!existsSync(routeFile)) {
        mismatches.push(`${specPath}: no route file at ${routeFile}`);
        continue;
      }
      const source = readFileSync(routeFile, "utf8");
      // Both export styles are in use here: `export async function GET` and
      // `export const GET = withErrorHandling(...)`.
      const exported = METHODS.filter((m) =>
        new RegExp(
          `export\\s+(?:async\\s+)?(?:function|const)\\s+${m.toUpperCase()}\\b`,
        ).test(source),
      );
      const documented = METHODS.filter((m) => Boolean(item[m]));

      const missing = exported.filter((m) => !documented.includes(m));
      const extra = documented.filter((m) => !exported.includes(m));
      if (missing.length || extra.length) {
        mismatches.push(
          `${specPath}: undocumented [${missing.join(", ")}], documented but not exported [${extra.join(", ")}]`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  // The check above compares the spec against the ROUTES it already names, so
  // it is silent about a route the spec omits entirely. That is how the two
  // hand-maintained descriptions of this API drifted: /docs/api gained cards
  // for scan/authenticated, verify-batch, history/{id}/summary, crawl/discover,
  // discover/progress, reputation and browser/sessions while the spec never
  // did, and the docs playground reads the SPEC, so those endpoints were
  // documented in prose and unreachable from the tool built to call them.
  // ref: AUDIT-015#api-03
  const DOCS_PAGE = join(process.cwd(), "app/docs/api/page.tsx");

  /** Every { method, path } pair in the docs page's `endpoints` array. */
  function docsEndpoints(): { method: string; path: string }[] {
    const source = readFileSync(DOCS_PAGE, "utf8");
    const out: { method: string; path: string }[] = [];
    const re =
      /method:\s*"(GET|POST|PUT|PATCH|DELETE)",\s*\n\s*path:\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      out.push({ method: m[1].toLowerCase(), path: m[2] });
    }
    return out;
  }

  it("finds the endpoint cards on the docs page (guards the parser below)", () => {
    expect(docsEndpoints().length).toBeGreaterThan(30);
  });

  it("documents in the spec every v3 endpoint the docs page has a card for", () => {
    // /api/version is deliberately outside the /api/v3 base URL (it has to be
    // version-independent), so it cannot be a path in a spec whose server is
    // /api/v3. It is the only legitimate exemption.
    const EXEMPT = new Set(["/api/version (not under /api/v3)"]);
    const missing: string[] = [];

    for (const { method, path } of docsEndpoints()) {
      if (EXEMPT.has(path)) continue;
      // Cards write query strings into the path for readability
      // ("/domains?id={id}"); the spec models those as parameters.
      const specPath = path.split("?")[0];
      const item = (spec.paths as Record<string, any>)[specPath];
      if (!item?.[method]) {
        missing.push(`${method.toUpperCase()} ${specPath}`);
      }
    }

    expect(missing).toEqual([]);
  });

  // The other direction, for the endpoints that matter most: anything an API
  // KEY can reach is by definition part of the integrator surface, so it has to
  // be in the machine-readable description. A route that authenticates a Bearer
  // key and is absent from the spec is an endpoint no generated client knows
  // exists. ref: AUDIT-015#api-03
  it("documents every non-admin route an API key can authenticate against", () => {
    const root = join(process.cwd(), "app/api/v3");
    // GET /auth/me accepts a key so the browser extension can identify the
    // account behind one, but it is an identity read rather than part of the
    // scan surface and the spec is deliberately a subset.
    const EXEMPT = new Set(["/auth/me"]);

    const routeFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "admin") continue;
          walk(full);
        } else if (entry.name === "route.ts") {
          routeFiles.push(full);
        }
      }
    };
    walk(root);

    const missing: string[] = [];
    let keyRoutes = 0;
    for (const file of routeFiles) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("validateApiKey")) continue;
      keyRoutes++;
      const specPath = file
        .slice(root.length)
        .replace(/\\/g, "/")
        .replace(/\/route\.ts$/, "")
        .replace(/\[(\w+)\]/g, "{$1}");
      if (EXEMPT.has(specPath)) continue;
      if (!(spec.paths as Record<string, any>)[specPath]) {
        missing.push(specPath);
      }
    }

    // Guards the walk itself: a broken traversal would find no key routes and
    // pass with an empty `missing`, which is the failure mode a coverage test
    // most needs to be immune to.
    expect(keyRoutes).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });

  it("declares the bearer API-key security scheme", () => {
    expect(spec.components.securitySchemes.apiKey.scheme).toBe("bearer");
    expect(spec.security).toEqual([{ apiKey: [] }]);
  });

  it("has no broken $refs: every $ref resolves within the document", () => {
    const refs: string[] = [];
    const walk = (v: any) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          if (k === "$ref" && typeof val === "string") refs.push(val);
          else walk(val);
        }
      }
    };
    walk(spec);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const path = ref.replace(/^#\//, "").split("/");
      let node: any = spec;
      for (const seg of path) node = node?.[seg];
      expect(node, `broken $ref: ${ref}`).toBeTruthy();
    }
  });
});
