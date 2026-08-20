/**
 * Proves that buildBranches (via runAsyncChecksDetailed) runs ONLY the active
 * probes named in the `scanners` filter, not all nine, and that the legacy
 * bare "active-probes" selector still runs every one (back-compat).
 *
 * The five directory probes are mocked at the module boundary so we can assert
 * exactly which were invoked. dns/tls/http/runtime-config are mocked for the
 * same reason async-checks.test.ts mocks them: to keep the module import and
 * the branch machinery off the network and the database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("dns/promises", () => ({
  resolveTxt: vi.fn().mockRejectedValue(new Error("dns disabled")),
  resolveCaa: vi.fn().mockRejectedValue(new Error("dns disabled")),
  resolveMx: vi.fn().mockRejectedValue(new Error("dns disabled")),
  resolveSoa: vi.fn().mockRejectedValue(new Error("dns disabled")),
  resolveCname: vi.fn().mockRejectedValue(new Error("dns disabled")),
  resolve4: vi.fn().mockRejectedValue(new Error("dns disabled")),
  resolve6: vi.fn().mockRejectedValue(new Error("dns disabled")),
  resolveNs: vi.fn().mockRejectedValue(new Error("dns disabled")),
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

vi.mock("tls", () => ({
  default: { connect: vi.fn() },
  connect: vi.fn(),
}));

vi.mock("http", () => ({
  default: { request: vi.fn() },
  request: vi.fn(),
}));

vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return {
    getSetting: vi.fn(
      async (key: keyof typeof SETTINGS_REGISTRY) =>
        SETTINGS_REGISTRY[key].default,
    ),
  };
});

// The five form/URL-driven probes async-checks.ts imports from here. Mocked so
// this test observes exactly which the active-probes branch chose to invoke.
vi.mock("@/lib/scanner/active-probes", () => ({
  checkActiveProbes: vi.fn(async () => []),
  checkSqlInjectionProbe: vi.fn(async () => []),
  checkSstiProbe: vi.fn(async () => []),
  checkCommandInjectionProbe: vi.fn(async () => []),
  checkOpenRedirectProbe: vi.fn(async () => []),
}));

import { runAsyncChecksDetailed } from "@/lib/scanner/async-checks";
import {
  checkActiveProbes,
  checkSqlInjectionProbe,
  checkSstiProbe,
  checkCommandInjectionProbe,
  checkOpenRedirectProbe,
} from "@/lib/scanner/active-probes";

const directoryProbes = [
  checkActiveProbes,
  checkSqlInjectionProbe,
  checkSstiProbe,
  checkCommandInjectionProbe,
  checkOpenRedirectProbe,
] as unknown as ReturnType<typeof vi.fn>[];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "",
    })),
  );
  for (const probe of directoryProbes) probe.mockClear();
});

describe("active-probes branch runs only the selected probes", () => {
  it("selecting one probe runs that probe and none of the others", async () => {
    await runAsyncChecksDetailed("https://example.com", ["active-probes:xss"]);

    expect(checkActiveProbes).toHaveBeenCalledTimes(1);
    expect(checkSqlInjectionProbe).not.toHaveBeenCalled();
    expect(checkSstiProbe).not.toHaveBeenCalled();
    expect(checkCommandInjectionProbe).not.toHaveBeenCalled();
    expect(checkOpenRedirectProbe).not.toHaveBeenCalled();
  });

  it("selecting a different single probe runs only that one", async () => {
    await runAsyncChecksDetailed("https://example.com", ["active-probes:sqli"]);

    expect(checkSqlInjectionProbe).toHaveBeenCalledTimes(1);
    expect(checkActiveProbes).not.toHaveBeenCalled();
    expect(checkSstiProbe).not.toHaveBeenCalled();
  });

  it("runs no active probe at all when the filter names only ordinary categories", async () => {
    // "headers" builds no async branch and no active probe, so nothing here
    // touches the network. The run-everything (null filter) case is covered by
    // getPlannedAsyncBranches in async-checks.test.ts, which asserts the
    // active-probes branch is never planned without an explicit opt-in.
    await runAsyncChecksDetailed("https://example.com", ["headers"]);
    for (const probe of directoryProbes) expect(probe).not.toHaveBeenCalled();
  });

  it("legacy bare active-probes still runs all five directory probes (back-compat)", async () => {
    await runAsyncChecksDetailed("https://example.com", ["active-probes"]);
    for (const probe of directoryProbes) expect(probe).toHaveBeenCalledTimes(1);
  });
});
