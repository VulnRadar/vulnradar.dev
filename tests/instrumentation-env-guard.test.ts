import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * validateEnv is register()'s first step and carries the production guard
 * against DISABLE_CSP=1. The rest of the boot is what the guard protects, so
 * this pins that it runs first, with the real env module.
 */

const dbLoaded = vi.fn();
vi.mock("@/lib/database/db", () => {
  dbLoaded();
  return { default: {} };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("register() on an unsafe production environment", () => {
  it("refuses to boot before it touches the database", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DISABLE_CSP", "1");

    const { register } = await import("@/instrumentation");

    await expect(register()).rejects.toThrow(/DISABLE_CSP=1 is not allowed/);
    expect(dbLoaded).not.toHaveBeenCalled();
  });
});
