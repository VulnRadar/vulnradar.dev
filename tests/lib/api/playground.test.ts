import { describe, it, expect } from "vitest";
import {
  substitutePathParams,
  buildRequestUrl,
  pathParamNames,
  resolveRef,
  buildExample,
} from "@/lib/api/playground";

describe("playground helpers", () => {
  it("substitutePathParams fills declared params and leaves unfilled ones", () => {
    expect(substitutePathParams("/scan/status/{id}", { id: "42" })).toBe(
      "/scan/status/42",
    );
    expect(substitutePathParams("/scan/status/{id}", {})).toBe(
      "/scan/status/{id}",
    );
    expect(substitutePathParams("/a/{x}", { x: "a b" })).toBe("/a/a%20b");
  });

  it("pathParamNames lists the templated segments", () => {
    expect(pathParamNames("/history/{id}/report")).toEqual(["id"]);
    expect(pathParamNames("/scan")).toEqual([]);
  });

  it("buildRequestUrl joins base, path, and non-empty query", () => {
    expect(
      buildRequestUrl(
        "https://x.com/api/v3/",
        "/history/{id}/report",
        { id: "7" },
        { format: "sarif", empty: "" },
      ),
    ).toBe("https://x.com/api/v3/history/7/report?format=sarif");
  });

  it("resolveRef follows a local ref, rejects a foreign one", () => {
    const spec = { components: { schemas: { Foo: { type: "string" } } } };
    expect(resolveRef(spec, "#/components/schemas/Foo")).toEqual({
      type: "string",
    });
    expect(resolveRef(spec, "https://other#/x")).toBeUndefined();
    expect(resolveRef(spec, "#/components/schemas/Missing")).toBeUndefined();
  });

  it("buildExample resolves a $ref and uses property examples", () => {
    const spec = {
      components: {
        schemas: {
          ScanRequest: {
            type: "object",
            properties: {
              url: { type: "string", example: "example.com" },
              crawl: { type: "boolean" },
            },
          },
        },
      },
    };
    const ex = buildExample(spec, {
      $ref: "#/components/schemas/ScanRequest",
    }) as Record<string, unknown>;
    expect(ex.url).toBe("example.com");
    expect(ex.crawl).toBe(false);
  });

  it("buildExample does not blow up on a self-referential schema", () => {
    const spec = {
      components: { schemas: { Node: { $ref: "#/components/schemas/Node" } } },
    };
    expect(() =>
      buildExample(spec, { $ref: "#/components/schemas/Node" }),
    ).not.toThrow();
  });
});

/**
 * Composition keywords.
 *
 * The spec gained an allOf (CrawlScanRequest extends ScanRequest) and a
 * discriminated oneOf (ScanAuth, shared by the authenticated and crawl scan
 * routes). buildExample handled neither, and a schema with no `type` and no
 * `properties` fell through to null - so the editor would have prefilled the
 * literal `null` as the whole request body for both of those endpoints.
 *
 * That is the failure the `scanners` example in openapi-spec.ts was written to
 * prevent: a prefilled body that looks like a valid request, is not, and costs
 * the developer a real scan to find out.
 */
describe("buildExample composition", () => {
  const spec = {
    components: {
      schemas: {
        Base: {
          type: "object",
          properties: { url: { type: "string", example: "example.com" } },
        },
      },
    },
  } as unknown as Parameters<typeof buildExample>[0];

  it("merges an allOf into one object", () => {
    const out = buildExample(spec, {
      allOf: [
        { $ref: "#/components/schemas/Base" },
        {
          type: "object",
          properties: { urls: { type: "array", items: { type: "string" } } },
        },
      ],
    } as never) as Record<string, unknown>;

    expect(out).not.toBeNull();
    expect(out.url).toBe("example.com");
    expect(out.urls).toEqual([""]);
  });

  it("takes the first variant of a oneOf", () => {
    const out = buildExample(spec, {
      oneOf: [
        {
          type: "object",
          properties: { method: { type: "string", example: "form" } },
        },
        {
          type: "object",
          properties: { method: { type: "string", example: "header" } },
        },
      ],
    } as never) as Record<string, unknown>;

    expect(out.method).toBe("form");
  });

  it("does not return null for a composed schema", () => {
    for (const schema of [
      { allOf: [{ type: "object", properties: {} }] },
      { oneOf: [{ type: "object", properties: {} }] },
      { anyOf: [{ type: "object", properties: {} }] },
    ]) {
      expect(buildExample(spec, schema as never)).not.toBeNull();
    }
  });
});
