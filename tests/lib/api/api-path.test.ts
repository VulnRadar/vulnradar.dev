import { describe, expect, it } from "vitest";

import { apiPath, internalPath } from "@/lib/api/api-path";
import {
  CONFIG_API_INTERNAL_PREFIX,
  CONFIG_API_VERSION,
} from "@/lib/config/config-values";

describe("apiPath", () => {
  it("builds a path under the advertised version", () => {
    expect(apiPath("/scan")).toBe(`/api/${CONFIG_API_VERSION}/scan`);
    expect(apiPath("/history/abc/report")).toBe(
      `/api/${CONFIG_API_VERSION}/history/abc/report`,
    );
  });

  it("is /api/v3 until the advertised version flips", () => {
    expect(CONFIG_API_VERSION).toBe("v3");
    expect(apiPath("/scan")).toBe("/api/v3/scan");
  });

  it("adds a missing leading slash and leaves the base for an empty path", () => {
    expect(apiPath("scan")).toBe(apiPath("/scan"));
    expect(apiPath("")).toBe(`/api/${CONFIG_API_VERSION}`);
  });

  it("keeps a query string and an already encoded segment as given", () => {
    expect(apiPath("/history/ex%20ample?format=sarif")).toBe(
      `/api/${CONFIG_API_VERSION}/history/ex%20ample?format=sarif`,
    );
  });
});

describe("internalPath", () => {
  it("builds a path under the internal prefix", () => {
    expect(internalPath("/auth/login")).toBe("/api/internal/auth/login");
    expect(internalPath("/auth/login")).toBe(
      `${CONFIG_API_INTERNAL_PREFIX}/auth/login`,
    );
  });

  it("adds a missing leading slash and leaves the base for an empty path", () => {
    expect(internalPath("admin")).toBe("/api/internal/admin");
    expect(internalPath("")).toBe("/api/internal");
  });

  it("does not follow the advertised version", () => {
    expect(internalPath("/x")).not.toContain(CONFIG_API_VERSION);
  });
});
