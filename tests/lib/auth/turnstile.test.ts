/**
 * verifyTurnstile (lib/auth/turnstile.ts): the one siteverify call that the
 * contact form, support tickets and signup share.
 *
 * The three copies it replaced had no timeout and an unguarded `.json()`, so a
 * Cloudflare that was slow held every one of those requests open for as long
 * as the socket lived, and a Cloudflare that answered with an HTML error page
 * threw out of the route as a 500. Only the HTTP boundary is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLogError = vi.fn();
vi.mock("@/lib/logging/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const {
  verifyTurnstile,
  TURNSTILE_TIMEOUT_MS,
  TURNSTILE_VERIFY_URL,
  TURNSTILE_UNAVAILABLE_MESSAGE,
} = await import("@/lib/auth/turnstile");

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;
const originalSecret = process.env.TURNSTILE_SECRET_KEY;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A fetch that never answers on its own and rejects only when its signal
 * aborts, which is what the real one does against a host that accepted the
 * connection and then went quiet.
 */
function hangUntilAborted(_url: unknown, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(init.signal?.reason ?? new Error("aborted")),
    );
  });
}

/**
 * AbortSignal.timeout runs on Node's internal timers, which fake timers do not
 * reach, so the test swaps in the same signal built on the faked setTimeout.
 * It also records the delay asked for.
 */
function fakeTimeoutSignals() {
  return vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
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
}

beforeEach(() => {
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  fetchMock.mockReset();
  mockLogError.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = originalSecret;
});

describe("verifyTurnstile", () => {
  it("asks for a token before calling Cloudflare at all", async () => {
    for (const token of [null, undefined, "", "   "]) {
      expect(await verifyTurnstile(token, "203.0.113.7")).toEqual({
        ok: false,
        status: 400,
        error: "Captcha verification required.",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the secret, the token and the caller's ip to siteverify", async () => {
    fetchMock.mockResolvedValue(json({ success: true }));

    expect(await verifyTurnstile("good-token", "203.0.113.7")).toEqual({
      ok: true,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      secret: "test-secret",
      response: "good-token",
      remoteip: "203.0.113.7",
    });
  });

  it("leaves remoteip out when the caller's address is unknown", async () => {
    fetchMock.mockResolvedValue(json({ success: true }));
    await verifyTurnstile("good-token", null);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).not.toHaveProperty("remoteip");
  });

  it("bounds the call with a ten second timeout signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(json({ success: true }));

    await verifyTurnstile("good-token", "203.0.113.7");

    expect(TURNSTILE_TIMEOUT_MS).toBe(10_000);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(
      AbortSignal,
    );
  });

  it("refuses a token Cloudflare says is invalid with a 400", async () => {
    fetchMock.mockResolvedValue(
      json({ success: false, "error-codes": ["invalid-input-response"] }),
    );
    expect(await verifyTurnstile("bad-token", "203.0.113.7")).toEqual({
      ok: false,
      status: 400,
      error: "Captcha verification failed. Please try again.",
    });
  });

  it("answers a siteverify that never responds with a 503 once ten seconds pass", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fakeTimeoutSignals();
    fetchMock.mockImplementation(hangUntilAborted);

    let result: Awaited<ReturnType<typeof verifyTurnstile>> | undefined;
    void verifyTurnstile("good-token", "203.0.113.7").then((r) => {
      result = r;
    });

    await vi.advanceTimersByTimeAsync(TURNSTILE_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: TURNSTILE_UNAVAILABLE_MESSAGE,
    });
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it("answers a non-JSON reply with a 503 instead of throwing", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    expect(await verifyTurnstile("good-token", "203.0.113.7")).toEqual({
      ok: false,
      status: 503,
      error: TURNSTILE_UNAVAILABLE_MESSAGE,
    });
  });

  it("answers a Cloudflare error status with a 503, not as a bad token", async () => {
    fetchMock.mockResolvedValue(json({ success: false }, 500));
    expect(await verifyTurnstile("good-token", "203.0.113.7")).toMatchObject({
      ok: false,
      status: 503,
    });
  });

  it("answers a network failure with a 503", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await verifyTurnstile("good-token", "203.0.113.7")).toMatchObject({
      ok: false,
      status: 503,
    });
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it("does not take a truthy non-boolean success as a pass", async () => {
    fetchMock.mockResolvedValue(json({ success: "true" }));
    expect(await verifyTurnstile("good-token", "203.0.113.7")).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("says something different for an unreachable check than for a failed one", () => {
    expect(TURNSTILE_UNAVAILABLE_MESSAGE).not.toMatch(/failed/i);
    expect(TURNSTILE_UNAVAILABLE_MESSAGE).toMatch(/try again/i);
    expect(TURNSTILE_UNAVAILABLE_MESSAGE).not.toMatch(/[–—·]/);
  });
});
