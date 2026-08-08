import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * lib/features/beta.ts mixes an in-memory feature registry (no DB) with a
 * per-user `users.beta_access` lookup. Mocked at the pg pool boundary, same
 * pattern as tests/lib/notifications/user-notifications.test.ts.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const {
  getAllBetaFeatures,
  getBetaFeature,
  userHasBetaAccess,
  grantBetaAccess,
  revokeBetaAccess,
  isAppInBetaMode,
  getBetaBannerMessage,
} = await import("@/lib/features/beta");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getAllBetaFeatures", () => {
  it("returns the full in-memory registry", async () => {
    const features = await getAllBetaFeatures();
    expect(features.map((f) => f.name)).toEqual([
      "advanced_reporting",
      "api_webhooks",
      "team_collaboration",
      "scheduled_scans",
      "custom_compliance",
    ]);
    expect(features.find((f) => f.name === "custom_compliance")?.enabled).toBe(
      false,
    );
  });
});

describe("getBetaFeature", () => {
  it("returns a known feature by name", async () => {
    expect(await getBetaFeature("api_webhooks")).toEqual({
      name: "api_webhooks",
      description: "Webhook integrations for automated scanning",
      enabled: true,
    });
  });

  it("returns null for an unknown feature", async () => {
    expect(await getBetaFeature("does_not_exist")).toBeNull();
  });
});

describe("userHasBetaAccess", () => {
  it("returns false without touching the database for an unknown feature", async () => {
    const result = await userHasBetaAccess(1, "does_not_exist");
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns false without touching the database for a disabled feature", async () => {
    const result = await userHasBetaAccess(1, "custom_compliance");
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns true when the user's beta_access column is true", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ beta_access: true }] });
    expect(await userHasBetaAccess(1, "api_webhooks")).toBe(true);
  });

  it("returns false when the user's beta_access column is false", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ beta_access: false }] });
    expect(await userHasBetaAccess(1, "api_webhooks")).toBe(false);
  });

  it("returns false when the user does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await userHasBetaAccess(999, "api_webhooks")).toBe(false);
  });

  it("returns false and logs when the query throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    expect(await userHasBetaAccess(1, "api_webhooks")).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("grantBetaAccess", () => {
  it("sets beta_access to true for the given user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await grantBetaAccess(42);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("beta_access = true");
    expect(params).toEqual([42]);
  });

  it("logs and rethrows on failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    await expect(grantBetaAccess(42)).rejects.toThrow("db down");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("revokeBetaAccess", () => {
  it("sets beta_access to false for the given user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await revokeBetaAccess(42);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("beta_access = false");
    expect(params).toEqual([42]);
  });

  it("logs and rethrows on failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    await expect(revokeBetaAccess(42)).rejects.toThrow("db down");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("isAppInBetaMode / getBetaBannerMessage", () => {
  // CONFIG_BETA_ENABLED in lib/config/config-values.ts is a hardcoded
  // `false`, not env-driven, so the "beta mode on" branch cannot occur in
  // this build without mocking config-values itself to a value that isn't
  // real for this deployment. These tests cover the actual compiled
  // behavior rather than a hypothetical one.
  it("reflects the compiled BETA_MODE flag (currently disabled)", () => {
    expect(isAppInBetaMode()).toBe(false);
  });

  it("returns no banner message when beta mode is off", () => {
    expect(getBetaBannerMessage()).toBeNull();
  });
});
