import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  ERROR_CODE_NAMES,
  defaultCodeForStatus,
  isErrorCode,
  statusAllowsCode,
  type ErrorCode,
} from "@/lib/api/error-codes";

describe("ERROR_CODES", () => {
  it("is the closed registry of the design", () => {
    expect([...ERROR_CODE_NAMES].sort()).toEqual(
      [
        "API_QUOTA_EXCEEDED",
        "API_VERSION_SUNSET",
        "AUTH_FAILED",
        "BLOCKED",
        "BROWSER_QUOTA_EXHAUSTED",
        "BULK_RATE_LIMIT",
        "CONCURRENT_SCAN_LIMIT",
        "CONFLICT",
        "CRAWL_PAGE_LIMIT",
        "CSRF_REJECTED",
        "DAILY_LIMIT",
        "DOMAIN_NOT_VERIFIED",
        "FORBIDDEN",
        "INTERNAL_ERROR",
        "INVALID_API_KEY",
        "INVALID_ID",
        "INVALID_REQUEST",
        "METHOD_NOT_ALLOWED",
        "NOT_FOUND",
        "NOT_IN_V4",
        "PAYLOAD_TOO_LARGE",
        "RATE_LIMITED",
        "SCAN_NOT_CANCELLABLE",
        "SCAN_NOT_FOUND",
        "SCOPE_MISSING",
        "SERVICE_PAUSED",
        "SERVICE_UNAVAILABLE",
        "TARGET_RATE_LIMIT",
        "TERMS_ACCEPTANCE_REQUIRED",
        "UNAUTHENTICATED",
        "UNSUPPORTED_API_VERSION",
        "UPGRADE_REQUIRED",
      ].sort(),
    );
  });

  it("names every code in UPPER_SNAKE", () => {
    for (const name of ERROR_CODE_NAMES)
      expect(name).toMatch(/^[A-Z][A-Z0-9_]+$/);
  });

  it("gives every code at least one 4xx or 5xx status and a plain-language meaning", () => {
    for (const [name, spec] of Object.entries(ERROR_CODES)) {
      expect(spec.statuses.length, name).toBeGreaterThan(0);
      for (const status of spec.statuses) {
        expect(status, name).toBeGreaterThanOrEqual(400);
        expect(status, name).toBeLessThan(600);
      }
      expect(spec.meaning.length, name).toBeGreaterThan(10);
      expect(spec.meaning, name).not.toMatch(/[\u2013\u2014\u00b7]/);
    }
  });

  it("pins the status of the codes the design table fixes", () => {
    const expected: Record<string, number[]> = {
      INVALID_REQUEST: [400, 422],
      INVALID_ID: [400],
      UNAUTHENTICATED: [401],
      INVALID_API_KEY: [401],
      FORBIDDEN: [403],
      SCOPE_MISSING: [403],
      TERMS_ACCEPTANCE_REQUIRED: [403],
      CSRF_REJECTED: [403],
      BLOCKED: [403],
      DOMAIN_NOT_VERIFIED: [403],
      CRAWL_PAGE_LIMIT: [403],
      AUTH_FAILED: [422],
      UPGRADE_REQUIRED: [402],
      BROWSER_QUOTA_EXHAUSTED: [402],
      NOT_FOUND: [404],
      SCAN_NOT_FOUND: [404],
      NOT_IN_V4: [404],
      UNSUPPORTED_API_VERSION: [404],
      METHOD_NOT_ALLOWED: [405],
      CONFLICT: [409],
      SCAN_NOT_CANCELLABLE: [409],
      API_VERSION_SUNSET: [410],
      PAYLOAD_TOO_LARGE: [413],
      DAILY_LIMIT: [429],
      API_QUOTA_EXCEEDED: [429],
      CONCURRENT_SCAN_LIMIT: [429],
      TARGET_RATE_LIMIT: [429],
      BULK_RATE_LIMIT: [429],
      RATE_LIMITED: [429],
      INTERNAL_ERROR: [500],
      SERVICE_PAUSED: [503],
      SERVICE_UNAVAILABLE: [503],
    };
    for (const [name, statuses] of Object.entries(expected)) {
      expect([...ERROR_CODES[name as ErrorCode].statuses], name).toEqual(
        statuses,
      );
    }
  });

  it("fixes a wait only for the two codes whose wait does not depend on the caller", () => {
    const fixed = Object.entries(ERROR_CODES)
      .filter(([, spec]) => "retryAfter" in spec)
      .map(([name, spec]) => [
        name,
        (spec as { retryAfter: number }).retryAfter,
      ]);
    expect(fixed).toEqual([
      ["CONCURRENT_SCAN_LIMIT", 10],
      ["SERVICE_PAUSED", 300],
    ]);
  });

  it("imports nothing", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../../../lib/api/error-codes.ts", import.meta.url),
      ),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});

describe("isErrorCode", () => {
  it("accepts registered codes only", () => {
    expect(isErrorCode("DAILY_LIMIT")).toBe(true);
    expect(isErrorCode("daily_limit")).toBe(false);
    expect(isErrorCode("2fa_required")).toBe(false);
    expect(isErrorCode("toString")).toBe(false);
    expect(isErrorCode("__proto__")).toBe(false);
    expect(isErrorCode(429)).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
  });
});

describe("defaultCodeForStatus", () => {
  it.each([
    [400, "INVALID_REQUEST"],
    [401, "UNAUTHENTICATED"],
    [402, "UPGRADE_REQUIRED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [405, "METHOD_NOT_ALLOWED"],
    [409, "CONFLICT"],
    [410, "API_VERSION_SUNSET"],
    [413, "PAYLOAD_TOO_LARGE"],
    [422, "INVALID_REQUEST"],
    [429, "RATE_LIMITED"],
    [500, "INTERNAL_ERROR"],
    [503, "SERVICE_UNAVAILABLE"],
  ])("maps %i to %s", (status, code) => {
    expect(defaultCodeForStatus(status)).toBe(code);
    expect(statusAllowsCode(code as ErrorCode, status)).toBe(true);
  });

  it("falls back to the generic code of the class for a status outside the table", () => {
    expect(defaultCodeForStatus(408)).toBe("INVALID_REQUEST");
    expect(defaultCodeForStatus(415)).toBe("INVALID_REQUEST");
    expect(defaultCodeForStatus(502)).toBe("INTERNAL_ERROR");
    expect(defaultCodeForStatus(504)).toBe("INTERNAL_ERROR");
  });

  it("always returns a registered code", () => {
    for (let status = 400; status < 600; status++) {
      expect(isErrorCode(defaultCodeForStatus(status)), String(status)).toBe(
        true,
      );
    }
  });
});

describe("statusAllowsCode", () => {
  it("rejects a status the code does not travel with", () => {
    expect(statusAllowsCode("DAILY_LIMIT", 429)).toBe(true);
    expect(statusAllowsCode("DAILY_LIMIT", 403)).toBe(false);
    expect(statusAllowsCode("INVALID_REQUEST", 422)).toBe(true);
    expect(statusAllowsCode("INVALID_REQUEST", 401)).toBe(false);
  });
});
