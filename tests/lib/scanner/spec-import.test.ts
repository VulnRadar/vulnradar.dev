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

    it("skips a templated server URL (server variables) and its joined paths", () => {
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
