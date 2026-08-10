import { describe, it, expect } from "vitest";
import {
  API_KEY_SCOPES,
  ALL_API_KEY_SCOPES,
  resolveApiKeyScopes,
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
} from "@/lib/api/api-key-scopes";

describe("resolveApiKeyScopes", () => {
  it("resolves a NULL/undefined value (a pre-scoping key's column) to every scope", () => {
    expect(resolveApiKeyScopes(null)).toEqual(ALL_API_KEY_SCOPES);
    expect(resolveApiKeyScopes(undefined)).toEqual(ALL_API_KEY_SCOPES);
  });

  it("resolves a malformed non-array value the same way, failing open to no more than it already had", () => {
    expect(resolveApiKeyScopes("scan:write")).toEqual(ALL_API_KEY_SCOPES);
    expect(resolveApiKeyScopes(42)).toEqual(ALL_API_KEY_SCOPES);
    expect(resolveApiKeyScopes({})).toEqual(ALL_API_KEY_SCOPES);
  });

  it("passes a real array through unchanged, including an empty one", () => {
    expect(resolveApiKeyScopes(["scan:read"])).toEqual(["scan:read"]);
    expect(resolveApiKeyScopes([])).toEqual([]);
  });
});

describe("hasApiKeyScope", () => {
  it("grants every scope for a NULL/undefined scopes value (grandfathered legacy key)", () => {
    expect(hasApiKeyScope(null, API_KEY_SCOPES.SCAN_WRITE)).toBe(true);
    expect(hasApiKeyScope(undefined, API_KEY_SCOPES.SCAN_READ)).toBe(true);
    expect(hasApiKeyScope(undefined, API_KEY_SCOPES.SCAN_DELETE)).toBe(true);
  });

  it("grants only the scopes explicitly present in a real array", () => {
    const scopes = [API_KEY_SCOPES.SCAN_WRITE, API_KEY_SCOPES.SCAN_READ];
    expect(hasApiKeyScope(scopes, API_KEY_SCOPES.SCAN_WRITE)).toBe(true);
    expect(hasApiKeyScope(scopes, API_KEY_SCOPES.SCAN_READ)).toBe(true);
    expect(hasApiKeyScope(scopes, API_KEY_SCOPES.SCAN_DELETE)).toBe(false);
  });

  it("denies everything for an explicitly empty scopes array", () => {
    expect(hasApiKeyScope([], API_KEY_SCOPES.SCAN_WRITE)).toBe(false);
    expect(hasApiKeyScope([], API_KEY_SCOPES.SCAN_READ)).toBe(false);
    expect(hasApiKeyScope([], API_KEY_SCOPES.SCAN_DELETE)).toBe(false);
  });
});

describe("apiKeyScopeErrorMessage", () => {
  it("names the specific missing scope rather than a generic message", () => {
    const message = apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_DELETE);
    expect(message).toContain("scan:delete");
    expect(message.toLowerCase()).not.toBe("unauthorized");
  });
});
