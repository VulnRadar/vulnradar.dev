/**
 * Tests for lib/domains/reverify-worker.ts: periodic re-verification of
 * already-verified domains, closing the gap where a domain that changes
 * hands keeps the original account's active-probes permission forever.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const mockCheckDnsVerification = vi.fn();
vi.mock("@/lib/domains/verification", () => ({
  checkDnsVerification: (...args: unknown[]) =>
    mockCheckDnsVerification(...args),
}));

const {
  runDomainReverifyPass,
  schedulePeriodicDomainReverify,
  stopPeriodicDomainReverify,
} = await import("@/lib/domains/reverify-worker");
const { CONFIG_DOMAIN_REVERIFY_TICK_INTERVAL_MS } =
  await import("@/lib/config/config-values");

function settings(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    FEATURE_DOMAIN_VERIFICATION: true,
    DOMAIN_REVERIFY_ENABLED: true,
    DOMAIN_REVERIFY_INTERVAL_DAYS: 30,
    DOMAIN_REVERIFY_BATCH_SIZE: 50,
    ...overrides,
  };
  mockGetSetting.mockImplementation(async (key: string) => defaults[key]);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSetting.mockReset();
  mockCheckDnsVerification.mockReset();
  settings();
});

describe("runDomainReverifyPass", () => {
  it("does nothing and queries nothing when FEATURE_DOMAIN_VERIFICATION is off", async () => {
    settings({ FEATURE_DOMAIN_VERIFICATION: false });
    const stats = await runDomainReverifyPass();
    expect(stats).toEqual({ checked: 0, stillVerified: 0, downgraded: 0 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does nothing and queries nothing when DOMAIN_REVERIFY_ENABLED is off", async () => {
    settings({ DOMAIN_REVERIFY_ENABLED: false });
    const stats = await runDomainReverifyPass();
    expect(stats).toEqual({ checked: 0, stillVerified: 0, downgraded: 0 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("selects only verified domains due for recheck, using the configured staleness window and batch size", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await runDomainReverifyPass();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'verified'");
    expect(sql).toContain("last_checked_at < NOW()");
    expect(params).toEqual([30, 50]);
  });

  it("updates last_checked_at and clears last_check_error for a domain that still verifies", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, domain: "example.com", verification_token: "tok-1" }],
    });
    mockCheckDnsVerification.mockResolvedValue({ verified: true });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const stats = await runDomainReverifyPass();
    expect(stats).toEqual({ checked: 1, stillVerified: 1, downgraded: 0 });
    expect(mockCheckDnsVerification).toHaveBeenCalledWith(
      "example.com",
      "tok-1",
    );
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toContain("SET last_checked_at = NOW()");
    expect(updateSql).toContain("last_check_error = NULL");
    expect(updateParams).toEqual([1]);
  });

  it("downgrades status to reverify_failed when the TXT record no longer verifies", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 2, domain: "gone.example.com", verification_token: "tok-2" },
      ],
    });
    mockCheckDnsVerification.mockResolvedValue({
      verified: false,
      error: "No matching TXT record found.",
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const stats = await runDomainReverifyPass();
    expect(stats).toEqual({ checked: 1, stillVerified: 0, downgraded: 1 });
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toContain("status = 'reverify_failed'");
    expect(updateParams).toEqual([2, "No matching TXT record found."]);
  });

  it("falls back to a generic message when the DNS check reports failure with no specific error", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 3, domain: "gone2.example.com", verification_token: "tok-3" },
      ],
    });
    mockCheckDnsVerification.mockResolvedValue({ verified: false });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runDomainReverifyPass();
    const [, updateParams] = mockQuery.mock.calls[1];
    expect(updateParams[1]).toMatch(/no longer verifies/i);
  });

  it("processes multiple due domains independently, some verified and some not", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, domain: "still-good.com", verification_token: "tok-1" },
        { id: 2, domain: "lost-it.com", verification_token: "tok-2" },
      ],
    });
    mockCheckDnsVerification
      .mockResolvedValueOnce({ verified: true })
      .mockResolvedValueOnce({ verified: false, error: "gone" });
    mockQuery.mockResolvedValue({ rows: [] }); // both UPDATEs

    const stats = await runDomainReverifyPass();
    expect(stats).toEqual({ checked: 2, stillVerified: 1, downgraded: 1 });
  });

  it("continues checking remaining domains when one DNS check throws", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, domain: "throws.com", verification_token: "tok-1" },
        { id: 2, domain: "fine.com", verification_token: "tok-2" },
      ],
    });
    mockCheckDnsVerification
      .mockRejectedValueOnce(new Error("DNS resolver timeout"))
      .mockResolvedValueOnce({ verified: true });
    mockQuery.mockResolvedValue({ rows: [] });

    const stats = await runDomainReverifyPass();
    // The thrown domain is counted as checked but neither still-verified
    // nor downgraded -- it's left untouched for the next tick to retry.
    expect(stats).toEqual({ checked: 2, stillVerified: 1, downgraded: 0 });
  });

  it("returns zero stats when no domains are due", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const stats = await runDomainReverifyPass();
    expect(stats).toEqual({ checked: 0, stillVerified: 0, downgraded: 0 });
    expect(mockCheckDnsVerification).not.toHaveBeenCalled();
  });
});

describe("schedulePeriodicDomainReverify / stopPeriodicDomainReverify", () => {
  // `expect(timer).toBeDefined()` was the whole assertion, and a
  // `setInterval(fn, 0)` satisfies it just as well as the right one. What
  // matters is the interval actually registered and that stop releases that
  // same handle rather than leaving a tick running past shutdown.
  it("registers the interval it was given and clears that exact handle on stop", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const timer = schedulePeriodicDomainReverify(60_000);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][1]).toBe(60_000);
      expect(setSpy.mock.results[0].value).toBe(timer);

      stopPeriodicDomainReverify();
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(clearSpy).toHaveBeenCalledWith(timer);

      // Idempotent, not merely non-throwing.
      stopPeriodicDomainReverify();
      expect(clearSpy).toHaveBeenCalledTimes(1);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("falls back to the shipped interval instead of registering a 0 ms timer", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setInterval");
    try {
      schedulePeriodicDomainReverify(0);
      expect(setSpy.mock.calls[0][1]).toBe(
        CONFIG_DOMAIN_REVERIFY_TICK_INTERVAL_MS,
      );

      setSpy.mockClear();
      schedulePeriodicDomainReverify(Number.NaN);
      expect(setSpy.mock.calls[0][1]).toBe(
        CONFIG_DOMAIN_REVERIFY_TICK_INTERVAL_MS,
      );
    } finally {
      stopPeriodicDomainReverify();
      setSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
