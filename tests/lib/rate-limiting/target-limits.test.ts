/**
 * Tests for the per-TARGET scan volume limit.
 *
 * The property that matters is the key: every other limiter in this codebase
 * is keyed on the caller, so nothing bounded how much traffic a set of free
 * accounts could aim at one third-party site. ref: AUDIT-012#abuse-05
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { checkTargetScanLimit, targetScanLimitMessage } =
  await import("@/lib/rate-limiting/target-limits");

beforeEach(() => {
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 10,
    retryAfterSeconds: 0,
  });
});

describe("checkTargetScanLimit", () => {
  it("keys the bucket on the registrable domain, not the caller and not the hostname", async () => {
    // Per-hostname keying would be defeated by pointing at subdomains, and the
    // victim is the domain, not the label in front of it.
    const result = await checkTargetScanLimit("https://a.b.example.com/deep");

    expect(result.rootDomain).toBe("example.com");
    const [config] = mockCheckRateLimit.mock.calls[0];
    expect(config.key).toBe("scantarget:example.com");
    expect(config.key).not.toMatch(/\d+$/); // no user id anywhere in it
  });

  it("gives two different subdomains of one site the same bucket", async () => {
    await checkTargetScanLimit("https://www.example.com/");
    await checkTargetScanLimit("https://staging.example.com/login");

    const keys = mockCheckRateLimit.mock.calls.map(([c]) => c.key);
    expect(keys[0]).toBe(keys[1]);
  });

  it("uses an hourly window sized above the largest legitimate bulk batch", async () => {
    // The Elite tier sells a 100-URL batch and those URLs are commonly 100
    // paths on one domain, so a cap at or under 100 would reject a paid
    // feature.
    await checkTargetScanLimit("https://example.com/");

    const [config] = mockCheckRateLimit.mock.calls[0];
    expect(config.windowSeconds).toBe(3600);
    expect(config.maxAttempts).toBeGreaterThan(100);
  });

  it("reports the refusal and its retry-after when the bucket is spent", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1234,
    });

    const result = await checkTargetScanLimit("https://example.com/");

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(1234);
  });

  it("fails open on an unparseable URL, leaving that refusal to the SSRF guard", async () => {
    const result = await checkTargetScanLimit("not a url");

    expect(result.allowed).toBe(true);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });
});

describe("targetScanLimitMessage", () => {
  it("names the domain and points at domain verification as the way out", () => {
    const message = targetScanLimitMessage("example.com");
    expect(message).toContain("example.com");
    expect(message).toMatch(/verify ownership/i);
  });
});
