import { describe, it, expect } from "vitest";
import { buildOpenApiSpec } from "@/lib/api/openapi-spec";

/* eslint-disable @typescript-eslint/no-explicit-any -- spec is an untyped
   OpenAPI document; the test walks it structurally. */

describe("buildOpenApiSpec", () => {
  const spec = buildOpenApiSpec("https://example.com") as any;

  it("is a valid-shaped OpenAPI 3.1 document with our own server", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info?.title).toBeTruthy();
    expect(spec.info?.version).toBeTruthy();
    expect(spec.servers?.[0]?.url).toBe("https://example.com/api/v3");
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
