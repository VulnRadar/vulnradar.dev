import { describe, it, expect } from "vitest";
import {
  burstLimitedResponse,
  concurrentScanLimitResponse,
  rateLimitedResponse,
} from "@/lib/api/rate-limit-response";

/**
 * The 429 contract shared by every per-key-quota refusal. Its whole point is
 * that a client can write ONE retry path, so the assertions here are about the
 * headers and body being present and consistent, not about the wording.
 * ref: AUDIT-015#api-02
 */
describe("rateLimitedResponse", () => {
  const state = {
    limit: 150,
    used: 150,
    remaining: 0,
    resetsAt: new Date(Date.now() + 3600_000).toISOString(),
  };

  it("sends the full rate-limit header set alongside Retry-After", async () => {
    const res = rateLimitedResponse(state);

    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("150");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Reset")).toBe(state.resetsAt);
    expect(Number(res.headers.get("Retry-After"))).toBeCloseTo(3600, -2);
  });

  it("repeats the quota numbers in the body so a cookie caller can read them too", async () => {
    const json = await rateLimitedResponse(state).json();

    expect(json).toMatchObject({
      limit: 150,
      used: 150,
      remaining: 0,
      resets_at: state.resetsAt,
    });
    expect(typeof json.error).toBe("string");
  });

  it("never tells a client to retry in zero or negative seconds", () => {
    // A reset timestamp that has already passed is normal: the window rolls
    // over between the limiter's read and the response being built.
    const res = rateLimitedResponse({
      ...state,
      resetsAt: new Date(Date.now() - 10_000).toISOString(),
    });

    expect(Number(res.headers.get("Retry-After"))).toBe(1);
  });

  it("does not crash on an unparseable resetsAt", () => {
    const res = rateLimitedResponse({ ...state, resetsAt: "not a date" });

    // NaN would serialise as "NaN" in the header, which no client can act on.
    // The floor turns it into a valid, if pessimistic, one second.
    expect(res.headers.get("Retry-After")).toBe("1");
  });
});

describe("rateLimitedResponse options", () => {
  const state = {
    limit: 25,
    used: 25,
    remaining: 0,
    resetsAt: new Date(Date.now() + 3600_000).toISOString(),
  };

  it("names the key budget by default", async () => {
    expect((await rateLimitedResponse(state).json()).code).toBe(
      "API_QUOTA_EXCEEDED",
    );
  });

  it("takes the DAILY_LIMIT code and keeps the v3 quota keys", async () => {
    const res = rateLimitedResponse(state, "Daily limit.", {
      code: "DAILY_LIMIT",
    });
    expect(await res.json()).toMatchObject({
      error: "Daily limit.",
      code: "DAILY_LIMIT",
      limit: 25,
      used: 25,
      remaining: 0,
      resets_at: state.resetsAt,
    });
    expect(res.headers.get("X-RateLimit-Policy")).toBe("daily");
  });

  it("lets the caller state the wait", () => {
    const res = rateLimitedResponse(state, "x", { retryAfter: 42 });
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it.each([NaN, 0, -5])("floors a stated wait of %s at 1", (retryAfter) => {
    const res = rateLimitedResponse(state, "x", { retryAfter });
    expect(res.headers.get("Retry-After")).toBe("1");
  });
});

describe("burstLimitedResponse", () => {
  it("sends the limiter's wait and the generic code", async () => {
    const res = burstLimitedResponse({ retryAfterSeconds: 37 }, "Slow down.");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("37");
    expect(await res.json()).toEqual({
      error: "Slow down.",
      code: "RATE_LIMITED",
    });
  });

  it.each([0, -1, NaN, Infinity])("never sends a wait of %s", (seconds) => {
    const res = burstLimitedResponse({ retryAfterSeconds: seconds }, "x");
    expect(res.headers.get("Retry-After")).toBe("1");
  });

  it("rounds a fraction up", () => {
    const res = burstLimitedResponse({ retryAfterSeconds: 1.2 }, "x");
    expect(res.headers.get("Retry-After")).toBe("2");
  });

  it("lets a limiter name its own code and keep legacy keys", async () => {
    const body = await burstLimitedResponse({ retryAfterSeconds: 1 }, "x", {
      code: "BULK_RATE_LIMIT",
      statusCode: "BULK_RATE_LIMIT",
    }).json();
    expect(body).toMatchObject({
      code: "BULK_RATE_LIMIT",
      statusCode: "BULK_RATE_LIMIT",
    });
  });
});

describe("concurrentScanLimitResponse", () => {
  it("is a fixed 10 second wait with both spellings of the code", async () => {
    const res = concurrentScanLimitResponse("You have 2 running.");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("10");
    expect(await res.json()).toEqual({
      error: "You have 2 running.",
      statusCode: "CONCURRENT_SCAN_LIMIT",
      code: "CONCURRENT_SCAN_LIMIT",
    });
  });

  it("has words even when the check carries no message", async () => {
    const body = await concurrentScanLimitResponse(undefined).json();
    expect(body.error).toEqual(expect.any(String));
    expect(body.error.length).toBeGreaterThan(0);
  });
});
