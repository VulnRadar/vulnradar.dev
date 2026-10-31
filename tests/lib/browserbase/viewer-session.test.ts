import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  MAX_TIMER_MS,
  earliestDeadline,
  formatMmSs,
  onDeadline,
  parseExpiry,
  sameRequest,
  secondsRemaining,
} from "@/lib/browserbase/viewer-session";
import type { NetworkRequest } from "@/lib/browserbase/client";

const req = (overrides: Partial<NetworkRequest> = {}): NetworkRequest => ({
  requestId: "r1",
  url: "https://example.com/a",
  method: "GET",
  host: "example.com",
  path: "/a",
  status: 200,
  mimeType: "text/html",
  timestamp: 1,
  ...overrides,
});

describe("onDeadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once, when the deadline passes and not before", () => {
    const fire = vi.fn();
    onDeadline(Date.now() + 60_000, fire);
    vi.advanceTimersByTime(59_999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("uses one timer, not a once-a-second poll", () => {
    onDeadline(Date.now() + 300_000, () => {});
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(100_000);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("fires at once for a deadline already past", () => {
    const fire = vi.fn();
    onDeadline(Date.now() - 5_000, fire);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not fire after it is cancelled", () => {
    const fire = vi.fn();
    const cancel = onDeadline(Date.now() + 60_000, fire);
    cancel();
    vi.advanceTimersByTime(120_000);
    expect(fire).not.toHaveBeenCalled();
  });

  it("does not act early on a deadline too far for one timer", () => {
    // setTimeout fires immediately for a delay past 2^31 - 1 ms (about 24.8
    // days). A deadline that far out must wait, not end the session now.
    const fire = vi.fn();
    const farOff = Date.now() + MAX_TIMER_MS + 5_000;
    onDeadline(farOff, fire);
    vi.advanceTimersByTime(MAX_TIMER_MS);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4_999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });
});

describe("earliestDeadline", () => {
  it("takes the first deadline to pass", () => {
    expect(earliestDeadline([5_000, 3_000, 9_000])).toBe(3_000);
  });

  it("ignores deadlines that are not set", () => {
    expect(earliestDeadline([null, 4_000, undefined])).toBe(4_000);
    expect(earliestDeadline([null, undefined])).toBeNull();
    expect(earliestDeadline([])).toBeNull();
  });

  it("ignores a deadline that is not a number", () => {
    expect(earliestDeadline([Number.NaN, 7_000])).toBe(7_000);
    expect(earliestDeadline([Number.NaN])).toBeNull();
  });

  it("lets the provider's expiry cut a long user timer short", () => {
    const userTimer = 300_000;
    const providerExpiry = 120_000;
    expect(earliestDeadline([userTimer, providerExpiry])).toBe(providerExpiry);
  });
});

describe("parseExpiry", () => {
  it("reads an ISO timestamp as epoch milliseconds", () => {
    expect(parseExpiry("2026-01-01T00:00:00.000Z")).toBe(
      Date.parse("2026-01-01T00:00:00.000Z"),
    );
  });

  it("returns null for a missing or unparseable expiry", () => {
    expect(parseExpiry(undefined)).toBeNull();
    expect(parseExpiry(null)).toBeNull();
    expect(parseExpiry("")).toBeNull();
    expect(parseExpiry("not a date")).toBeNull();
  });
});

describe("secondsRemaining and formatMmSs", () => {
  it("counts whole seconds down and stops at zero", () => {
    expect(secondsRemaining(10_999, 0)).toBe(10);
    expect(secondsRemaining(1_000, 1_000)).toBe(0);
    expect(secondsRemaining(1_000, 9_000)).toBe(0);
  });

  it("formats minutes and zero-padded seconds", () => {
    expect(formatMmSs(0)).toBe("0:00");
    expect(formatMmSs(59)).toBe("0:59");
    expect(formatMmSs(60)).toBe("1:00");
    expect(formatMmSs(299.9)).toBe("4:59");
    expect(formatMmSs(-3)).toBe("0:00");
  });
});

describe("sameRequest", () => {
  it("treats a fresh copy of the same request as the same row", () => {
    // Every poll returns new objects; this is what lets a memoised row skip.
    expect(sameRequest(req(), req())).toBe(true);
  });

  it("ignores what the row does not draw", () => {
    expect(sameRequest(req({ timestamp: 1 }), req({ timestamp: 99 }))).toBe(
      true,
    );
  });

  it.each([
    ["status", { status: 404 }],
    ["failed", { failed: true }],
    ["method", { method: "POST" }],
    ["path", { path: "/b" }],
    ["host", { host: "cdn.example.com" }],
    ["mimeType", { mimeType: "application/json" }],
    ["url", { url: "https://example.com/other" }],
    ["requestId", { requestId: "r2" }],
  ] as const)("redraws when the %s changes", (_field, change) => {
    expect(sameRequest(req(), req(change))).toBe(false);
  });

  it("redraws a pending request once its status arrives", () => {
    // The case the dock exists for: "..." becomes 200 on a later poll.
    expect(sameRequest(req({ status: undefined }), req({ status: 200 }))).toBe(
      false,
    );
  });
});
