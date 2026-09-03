import { describe, it, expect } from "vitest";
import { rateLimitedResponse } from "@/lib/api/rate-limit-response";

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
