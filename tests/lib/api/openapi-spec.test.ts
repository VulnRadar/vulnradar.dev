import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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
