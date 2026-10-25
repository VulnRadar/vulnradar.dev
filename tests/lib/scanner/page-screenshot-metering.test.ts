/**
 * The metering half of capturePageScreenshot.
 *
 * tests/lib/scanner/page-screenshot.test.ts proves the unconfigured contract
 * and deliberately touches nothing else. This file covers what happens once a
 * Browserbase session really exists: the seconds are billed back to the user,
 * and when that write fails the failure is logged with enough ids to find the
 * session, rather than disappearing into `.catch(() => {})`.
 *
 * Everything at the network and database boundary is mocked. The CDP
 * connection comes back null, which ends the capture early and exercises the
 * `finally` that does the metering without needing a fake browser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserSession: vi.fn(),
  endBrowserSession: vi.fn(),
  openCdpPageSession: vi.fn(),
  validateScanTarget: vi.fn(),
  checkBrowserbaseQuota: vi.fn(),
  recordBrowserbaseSeconds: vi.fn(),
  acquireConcurrencySlot: vi.fn(),
  releaseConcurrencySlot: vi.fn(),
  getUserPlan: vi.fn(),
}));

vi.mock("@/lib/browserbase/client", () => ({
  createBrowserSession: mocks.createBrowserSession,
  endBrowserSession: mocks.endBrowserSession,
  openCdpPageSession: mocks.openCdpPageSession,
  isBrowserBaseConfigured: () => true,
}));
vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: mocks.validateScanTarget,
  isPrivateHostname: () => false,
}));
vi.mock("@/lib/billing/browserbase-usage", () => ({
  checkBrowserbaseQuota: mocks.checkBrowserbaseQuota,
  recordBrowserbaseSeconds: mocks.recordBrowserbaseSeconds,
}));
vi.mock("@/lib/browserbase/concurrency-queue", () => ({
  acquireConcurrencySlot: mocks.acquireConcurrencySlot,
  releaseConcurrencySlot: mocks.releaseConcurrencySlot,
}));
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: mocks.getUserPlan,
}));
vi.mock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));

const { capturePageScreenshot } = await import("@/lib/scanner/page-screenshot");

const USER_ID = 7;

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.validateScanTarget.mockResolvedValue({ safe: true });
  mocks.checkBrowserbaseQuota.mockResolvedValue({ allowed: true });
  mocks.getUserPlan.mockResolvedValue("free");
  mocks.acquireConcurrencySlot.mockResolvedValue({
    acquired: true,
    queued: false,
  });
  mocks.releaseConcurrencySlot.mockResolvedValue(undefined);
  mocks.createBrowserSession.mockResolvedValue({
    id: "sess_shot",
    status: "RUNNING",
    url: "",
    connectUrl: "wss://example/connect",
  });
  mocks.openCdpPageSession.mockResolvedValue(null);
  mocks.endBrowserSession.mockResolvedValue(undefined);
  mocks.recordBrowserbaseSeconds.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capturePageScreenshot: usage metering", () => {
  it("bills the session's seconds to the user and frees the slot", async () => {
    await expect(
      capturePageScreenshot("https://example.com", { userId: USER_ID }),
    ).resolves.toBeNull();

    expect(mocks.endBrowserSession).toHaveBeenCalledWith("sess_shot");
    expect(mocks.recordBrowserbaseSeconds).toHaveBeenCalledTimes(1);
    expect(mocks.recordBrowserbaseSeconds.mock.calls[0][0]).toBe(USER_ID);
    expect(mocks.releaseConcurrencySlot).toHaveBeenCalledTimes(1);
  });

  it("logs a failed usage write with the user, session and seconds, and still returns", async () => {
    // Fire-and-forget by design, so a usage-write failure can never fail a
    // scan. That is also why it used to vanish: the seconds went unmetered
    // against the plan while the operator's Browserbase bill kept growing, and
    // the error log stayed empty.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("deadlock detected");
    mocks.recordBrowserbaseSeconds.mockRejectedValue(boom);

    await expect(
      capturePageScreenshot("https://example.com", { userId: USER_ID }),
    ).resolves.toBeNull();

    await vi.waitFor(() =>
      expect(errSpy.mock.calls.some((c) => c.includes(boom))).toBe(true),
    );
    const row = errSpy.mock.calls.find((c) => c.includes(boom));
    expect(row?.[0]).toBe("[browserbase] could not record screenshot usage");
    expect(row?.[1]).toEqual({
      userId: USER_ID,
      sessionId: "sess_shot",
      elapsedSeconds: expect.any(Number),
    });
    expect(mocks.releaseConcurrencySlot).toHaveBeenCalledTimes(1);
  });

  it("bills nothing, and so logs nothing, when no session ever came up", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createBrowserSession.mockRejectedValue(new Error("browserbase down"));

    await expect(
      capturePageScreenshot("https://example.com", { userId: USER_ID }),
    ).resolves.toBeNull();

    expect(mocks.recordBrowserbaseSeconds).not.toHaveBeenCalled();
    expect(
      errSpy.mock.calls.some((c) =>
        String(c[0]).includes("could not record screenshot usage"),
      ),
    ).toBe(false);
    expect(mocks.releaseConcurrencySlot).toHaveBeenCalledTimes(1);
  });
});
