import { describe, it, expect } from "vitest";
import { extractTargetsFromSpec } from "@/lib/scanner/spec-import";

// The route hands extractTargetsFromSpec the output of JSON.parse, which gives
// a "__proto__" key its own property instead of setting the prototype. Build
// every spec here the same way, or the object literal would hide the case.
const parse = (json: string): unknown => JSON.parse(json);

const openapi = (paths: string, servers?: string): unknown =>
  parse(
    `{"openapi":"3.0.1","servers":${
      servers ?? `[{"url":"https://api.example.com"}]`
    },"paths":${paths}}`,
  );

const pathParam = (name: string, example: string): string =>
  `{"get":{"parameters":[{"in":"path","name":"${name}","example":"${example}"}]}}`;

describe("spec import: parameter and variable names that are Object members", () => {
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "does not fill an undeclared {%s} from Object.prototype",
    (name) => {
      const { targets } = extractTargetsFromSpec(
        openapi(`{"/health":{},"/users/{${name}}":{}}`),
      );
      expect(targets).toEqual([
        "https://api.example.com",
        "https://api.example.com/health",
      ]);
    },
  );

  it.each(["__proto__", "constructor", "toString", "prototype"])(
    "fills a declared path parameter named %s like any other name",
    (name) => {
      const { targets } = extractTargetsFromSpec(
        openapi(`{"/users/{${name}}":${pathParam(name, "42")}}`),
      );
      expect(targets).toContain("https://api.example.com/users/42");
    },
  );

  it("fills a Swagger 2 path parameter named constructor", () => {
    const { targets } = extractTargetsFromSpec(
      parse(
        `{"swagger":"2.0","host":"api.example.com","schemes":["https"],"paths":{"/users/{constructor}":${pathParam(
          "constructor",
          "7",
        )}}}`,
      ),
    );
    expect(targets).toContain("https://api.example.com/users/7");
  });

  it.each(["__proto__", "constructor", "valueOf"])(
    "drops a server URL whose undeclared {%s} would resolve to an inherited member",
    (name) => {
      const { targets } = extractTargetsFromSpec(
        openapi(`{"/health":{}}`, `[{"url":"https://{${name}}.example.com"}]`),
      );
      expect(targets).toEqual([]);
    },
  );

  it.each(["__proto__", "constructor", "prototype"])(
    "fills a declared server variable named %s from its default",
    (name) => {
      const { targets } = extractTargetsFromSpec(
        openapi(
          `{"/health":{}}`,
          `[{"url":"https://{${name}}.example.com","variables":{"${name}":{"default":"staging"}}}]`,
        ),
      );
      expect(targets).toEqual([
        "https://staging.example.com",
        "https://staging.example.com/health",
      ]);
    },
  );

  it("never touches Object.prototype while reading such a spec", () => {
    extractTargetsFromSpec(
      openapi(
        `{"/a/{__proto__}/{constructor}":{"parameters":[{"in":"path","name":"__proto__","example":"x"},{"in":"path","name":"constructor","example":"y"}]}}`,
        `[{"url":"https://{__proto__}.example.com","variables":{"__proto__":{"default":"polluted"}}}]`,
      ),
    );
    const probe: Record<string, unknown> = {};
    expect(probe.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(probe)).toBe(Object.prototype);
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});
