/**
 * A Browserbase that never answers the create call, end to end through
 * POST /api/v3/browser/sessions with the real client.
 *
 * The route reserves one of the account's global concurrency slots before it
 * asks Browserbase for a session, and gives it back when the create throws.
 * With no timeout on the create, a quiet Browserbase never threw: the request
 * hung, and the slot stayed reserved for as long as the socket lived, so a few
 * stalled calls shrank the live-browser capacity for every user. Only the
 * HTTP boundary, the database and the route's own collaborators are mocked;
 * lib/browserbase/client.ts is the real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));
vi.mock("@/lib/auth", () => ({
  getSession: async () => ({
    userId: 42,
    email: "u@example.com",
    name: null,
    role: "user",
  }),
}));
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: async () => "127.0.0.1",
}));
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: async () => ({
    allowed: true,
    remaining: 19,
    retryAfterSeconds: 0,
  }),
  RATE_LIMITS: { browserSession: { maxAttempts: 20, windowSeconds: 3600 } },
}));
vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: async () => ({ safe: true }),
}));
vi.mock("@/lib/billing/browserbase-usage", () => ({
  checkBrowserbaseQuota: async () => ({ allowed: true }),
  recordBrowserbaseSeconds: async () => undefined,
}));
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: async () => "free",
}));
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: async () => 300,
  getSettings: async () => ({
    BROWSERBASE_MAX_TTL_SECONDS: 360,
    BROWSERBASE_DEFAULT_TTL_SECONDS: 360,
  }),
}));

const mockAcquire = vi.fn();
const mockRelease = vi.fn();
vi.mock("@/lib/browserbase/concurrency-queue", () => ({
  acquireConcurrencySlot: (...args: unknown[]) => mockAcquire(...args),
  releaseConcurrencySlot: (...args: unknown[]) => mockRelease(...args),
}));

process.env.BROWSERBASE_API_KEY = "test-key";
process.env.BROWSERBASE_PROJECT_ID = "test-project";

const { POST } = await import("@/app/api/v3/browser/sessions/route");

const realFetch = globalThis.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  mockAcquire.mockReset();
  mockAcquire.mockResolvedValue({ acquired: true, queued: false });
  mockRelease.mockReset();
  mockRelease.mockResolvedValue(undefined);
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/v3/browser/sessions when Browserbase never answers", () => {
  it("gives up after the timeout and releases the concurrency slot it reserved", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // AbortSignal.timeout runs on Node's internal timers, which fake timers do
    // not reach: the same signal, built on the faked setTimeout.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      const controller = new AbortController();
      setTimeout(
        () =>
          controller.abort(
            new DOMException("The operation timed out.", "TimeoutError"),
          ),
        ms,
      );
      return controller.signal;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );

    let res: Response | undefined;
    void POST(
      new NextRequest("http://localhost/api/v3/browser/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    ).then((r) => {
      res = r;
    });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(res).toBeUndefined();
    expect(mockRelease).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(res).toBeDefined();
    expect(res?.ok).toBe(false);
    expect(mockAcquire).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
