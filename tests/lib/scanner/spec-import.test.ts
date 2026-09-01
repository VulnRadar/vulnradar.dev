import { describe, it, expect } from "vitest";
import {
  extractTargetsFromSpec,
  MAX_SPEC_TARGETS,
} from "@/lib/scanner/spec-import";

describe("extractTargetsFromSpec", () => {
  it("returns unknown for non-objects and unrecognized shapes", () => {
    expect(extractTargetsFromSpec(null).format).toBe("unknown");
    expect(extractTargetsFromSpec("nope").format).toBe("unknown");
    expect(extractTargetsFromSpec({ hello: "world" }).format).toBe("unknown");
  });

  describe("OpenAPI 3", () => {
    it("extracts server bases plus concrete paths, skipping templated ones", () => {
      const spec = {
        openapi: "3.0.1",
        servers: [{ url: "https://api.example.com/v1" }],
        paths: {
          "/health": {},
          "/users": {},
          "/users/{id}": {}, // templated -> skipped
        },
      };
      const { format, targets } = extractTargetsFromSpec(spec);
      expect(format).toBe("openapi3");
      expect(targets).toEqual([
        "https://api.example.com/v1",
        "https://api.example.com/v1/health",
        "https://api.example.com/v1/users",
      ]);
    });

    it("ignores relative and non-http servers", () => {
      const spec = {
        openapi: "3.1.0",
        servers: [{ url: "/api/v3" }, { url: "ftp://x" }],
        paths: { "/a": {} },
      };
      expect(extractTargetsFromSpec(spec).targets).toEqual([]);
    });

    it("skips a templated server URL that declares no variables, and its joined paths", () => {
      const spec = {
        openapi: "3.0.0",
        servers: [
          { url: "https://{environment}.api.example.com/v1" },
          { url: "https://api.example.com/v1" },
        ],
        paths: { "/health": {} },
      };
      // Only the concrete server (and its concrete path) survive; nothing with
      // a literal {environment} reaches the scanner.
      expect(extractTargetsFromSpec(spec).targets).toEqual([
        "https://api.example.com/v1",
        "https://api.example.com/v1/health",
      ]);
    });

    // A realistic REST spec is mostly `/users/{id}`-shaped, so discarding
    // every templated path meant importing one covered almost none of the
    // surface. Placeholders now resolve from the spec's own declared values.
    // ref: AUDIT-014#comp-12
    it("fills a templated path from the parameter's declared example", () => {
      const spec = {
        openapi: "3.0.1",
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/users/{id}": {
            parameters: [
              { name: "id", in: "path", required: true, example: "42" },
            ],
          },
          "/orders/{orderId}/items/{sku}": {
            get: {
              parameters: [
                {
                  name: "orderId",
                  in: "path",
                  schema: { type: "integer", default: 1001 },
                },
                {
                  name: "sku",
                  in: "path",
                  schema: { type: "string", enum: ["abc-1", "abc-2"] },
                },
              ],
            },
          },
          // No declared value anywhere: still dropped, because inventing one
          // would be a guess at someone else's data.
          "/tenants/{tenantId}": {
            parameters: [{ name: "tenantId", in: "path" }],
          },
        },
      };
      expect(extractTargetsFromSpec(spec).targets).toEqual([
        "https://api.example.com",
        "https://api.example.com/users/42",
        "https://api.example.com/orders/1001/items/abc-1",
      ]);
    });

    it("follows a local $ref to a shared parameter definition", () => {
      const spec = {
        openapi: "3.0.1",
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/users/{id}": {
            parameters: [{ $ref: "#/components/parameters/UserId" }],
          },
        },
        components: {
          parameters: {
            UserId: {
              name: "id",
              in: "path",
              examples: { one: { value: "u_7" } },
            },
          },
        },
      };
      expect(extractTargetsFromSpec(spec).targets).toEqual([
        "https://api.example.com",
        "https://api.example.com/users/u_7",
      ]);
    });

    it("percent-encodes an example so it fills one path segment only", () => {
      const spec = {
        openapi: "3.0.1",
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/files/{path}": {
            parameters: [{ name: "path", in: "path", example: "a/b?x=1" }],
          },
        },
      };
      expect(extractTargetsFromSpec(spec).targets).toEqual([
        "https://api.example.com",
        "https://api.example.com/files/a%2Fb%3Fx%3D1",
      ]);
    });

    it("resolves a server variable from its required default", () => {
      const spec = {
        openapi: "3.0.0",
        servers: [
          {
            url: "https://{environment}.api.example.com/v1",
            variables: { environment: { default: "staging" } },
          },
        ],
        paths: { "/health": {} },
      };
      expect(extractTargetsFromSpec(spec).targets).toEqual([
        "https://staging.api.example.com/v1",
        "https://staging.api.example.com/v1/health",
      ]);
    });

    it("rejects a server variable default that could rewrite the host", () => {
      const spec = {
        openapi: "3.0.0",
        servers: [
          {
            url: "https://{host}/v1",
            variables: { host: { default: "evil.example.com@real.test" } },
          },
        ],
        paths: { "/health": {} },
      };
      expect(extractTargetsFromSpec(spec).targets).toEqual([]);
    });

    it("dedupes and caps at MAX_SPEC_TARGETS", () => {
      const paths: Record<string, unknown> = {};
      for (let i = 0; i < 200; i++) paths[`/p${i}`] = {};
      const spec = {
        openapi: "3.0.0",
        servers: [{ url: "https://api.example.com" }],
        paths,
      };
      const { targets } = extractTargetsFromSpec(spec);
      expect(targets.length).toBe(MAX_SPEC_TARGETS);
      expect(new Set(targets).size).toBe(targets.length); // no dupes
    });
  });

  describe("Swagger 2", () => {
    it("builds base from scheme/host/basePath and appends concrete paths", () => {
      const spec = {
        swagger: "2.0",
        host: "api.example.com",
        basePath: "/v2",
        schemes: ["http", "https"],
        paths: { "/ping": {}, "/orders/{id}": {} },
      };
      const { format, targets } = extractTargetsFromSpec(spec);
      expect(format).toBe("swagger2");
      // https preferred over http.
      expect(targets).toEqual([
        "https://api.example.com/v2",
        "https://api.example.com/v2/ping",
      ]);
    });

    // Swagger 2 hangs default/enum/x-example off the parameter itself rather
    // than off a schema. ref: AUDIT-014#comp-12
    it("fills a templated path from a Swagger 2 parameter default", () => {
      const spec = {
        swagger: "2.0",
        host: "api.example.com",
        schemes: ["https"],
        paths: {
          "/orders/{id}": {
            get: {
              parameters: [
                { name: "id", in: "path", type: "integer", default: 7 },
              ],
            },
          },
          "/carts/{id}": {
            get: {
              parameters: [
                { name: "id", in: "path", type: "string", "x-example": "c1" },
              ],
            },
          },
        },
      };
      expect(extractTargetsFromSpec(spec).targets).toEqual([
        "https://api.example.com",
        "https://api.example.com/orders/7",
        "https://api.example.com/carts/c1",
      ]);
    });

    it("returns nothing without a host", () => {
      expect(
        extractTargetsFromSpec({ swagger: "2.0", paths: { "/a": {} } }).targets,
      ).toEqual([]);
    });
  });

  describe("Postman", () => {
    it("walks nested folders and pulls concrete request URLs", () => {
      const spec = {
        info: { name: "My API", schema: "https://schema.getpostman.com/..." },
        item: [
          {
            name: "Ping",
            request: { url: { raw: "https://api.example.com/ping" } },
          },
          {
            name: "Folder",
            item: [
              {
                name: "Raw string url",
                request: { url: "https://api.example.com/list" },
              },
              {
                name: "Templated",
                request: { url: { raw: "https://api.example.com/u/{{id}}" } },
              },
            ],
          },
        ],
      };
      const { format, targets } = extractTargetsFromSpec(spec);
      expect(format).toBe("postman");
      expect(targets).toEqual([
        "https://api.example.com/ping",
        "https://api.example.com/list",
      ]);
    });
  });
});
