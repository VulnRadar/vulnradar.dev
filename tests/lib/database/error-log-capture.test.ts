import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for lib/database/error-log-capture.ts: the console.error ->
 * system_error_logs interception behind Admin > System > Error Logs.
 *
 * Mocks at the database boundary (@/lib/database/db's `query`), the same
 * pattern tests/app/api/v3/admin/cleanup/route.test.ts and
 * tests/lib/database/cleanup.test.ts use. console.error itself is
 * captured/restored around every test so this suite never leaks a
 * wrapped console.error into other test files or the real terminal.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const {
  installErrorLogCapture,
  _shouldCapture,
  _resetErrorLogCaptureStateForTests,
} = await import("@/lib/database/error-log-capture");
const { runWithRequestId, runWithScanId } =
  await import("@/lib/database/request-context");

const originalConsoleError = console.error;

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  _resetErrorLogCaptureStateForTests();
});

afterEach(() => {
  console.error = originalConsoleError;
});

describe("installErrorLogCapture", () => {
  it("still prints to the real console exactly as before", () => {
    const spy = vi.fn();
    console.error = spy;
    installErrorLogCapture();

    console.error("boom", { code: 500 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("boom", { code: 500 });
  });

  it("fires a best-effort INSERT into system_error_logs", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("database connection failed");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO system_error_logs");
    expect(params[0]).toBe("database connection failed");
  });

  it("captures an Error argument's stack as detail", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    const err = new Error("kaboom");
    console.error("Something failed:", err);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toContain("Something failed");
    expect(params[1]).toContain("kaboom");
  });

  it("only installs once -- a second call does not double-wrap console.error", () => {
    const spy = vi.fn();
    console.error = spy;
    installErrorLogCapture();
    const wrapped = console.error;
    installErrorLogCapture();

    expect(console.error).toBe(wrapped);

    console.error("once");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("never throws back to the caller when the DB insert rejects", async () => {
    console.error = vi.fn();
    mockQuery.mockRejectedValue(new Error("pool is draining"));
    installErrorLogCapture();

    expect(() => console.error("still logs fine")).not.toThrow();
    // Let the fire-and-forget promise settle so its rejection is observed
    // by the .catch() inside the module, not left as an unhandled rejection.
    await Promise.resolve();
    await Promise.resolve();
  });

  it("does not blow up on a non-Error, non-string argument", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    expect(() => console.error({ weird: true }, 42, null)).not.toThrow();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("skips the insert entirely for an empty/whitespace-only message", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("   ");

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("coalesces identical consecutive messages within the flood window", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("retrying connection");
    console.error("retrying connection");
    console.error("retrying connection");

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("does not coalesce two different messages", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("error A");
    console.error("error B");

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe("_shouldCapture (flood-guard logic)", () => {
  it("allows the first occurrence of a message", () => {
    expect(_shouldCapture("hello", 1_000)).toBe(true);
  });

  it("suppresses an identical message that arrives inside the coalesce window", () => {
    expect(_shouldCapture("hello", 1_000)).toBe(true);
    expect(_shouldCapture("hello", 1_500)).toBe(false);
  });

  it("allows an identical message once the coalesce window has passed", () => {
    expect(_shouldCapture("hello", 1_000)).toBe(true);
    expect(_shouldCapture("hello", 10_000)).toBe(true);
  });

  it("caps inserts at the per-window rate limit even for distinct messages", () => {
    let allowed = 0;
    for (let i = 0; i < 150; i++) {
      // Each message is unique and spaced 100ms apart, well inside the
      // same 60s rate-limit window but never hitting the coalesce guard.
      if (_shouldCapture(`error #${i}`, i * 100)) allowed++;
    }
    expect(allowed).toBe(100);
  });

  it("resets the rate-limit window after it elapses", () => {
    for (let i = 0; i < 100; i++) {
      _shouldCapture(`first-window #${i}`, i);
    }
    expect(_shouldCapture("first-window #100", 100)).toBe(false);
    // Past the 60s window: the counter resets and this is allowed again.
    expect(_shouldCapture("second-window #0", 61_000)).toBe(true);
  });
});

describe("installErrorLogCapture — secret redaction", () => {
  it("redacts a Bearer token before it reaches the DB", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("Request failed: Authorization: Bearer abcdef1234567890xyz");

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).not.toContain("abcdef1234567890xyz");
    expect(params[0]).toContain("[redacted]");
  });

  it("redacts this app's own vr_live_ API keys", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("Invalid key: vr_live_abcdefghijklmnop123456");

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).not.toContain("vr_live_abcdefghijklmnop123456");
  });

  it("redacts a Stripe secret key", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("Stripe error using sk_live_51H8xyzABCDEFghijklmnop");

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).not.toContain("sk_live_51H8xyzABCDEFghijklmnop");
  });

  it("redacts a connection string's password but keeps the rest for debugging", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error(
      "connect failed: postgres://dbuser:hunter2secret@db.internal:5432/vulnradar",
    );

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).not.toContain("hunter2secret");
    expect(params[0]).toContain(
      "postgres://dbuser:[redacted]@db.internal:5432/vulnradar",
    );
  });

  it("redacts an email address", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("Failed to notify user@example.com");

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).not.toContain("user@example.com");
  });

  it("does not coalesce two errors that share the same first MAX_MESSAGE_LENGTH characters but differ after it", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    const prefix = "x".repeat(2000);
    console.error(prefix + "AAAA");
    console.error(prefix + "BBBB");

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

/**
 * AUDIT-012#obs-07. The whole point of the request id is that the several
 * rows one failing request writes (route -> executeScan -> a check ->
 * safeFetch, each its own console.error) can be pulled back together. That
 * only works if the wrapper reads the ambient context at the moment it is
 * called, which is what these assert.
 */
describe("installErrorLogCapture: request correlation id", () => {
  it("stamps the ambient request id onto the row", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    runWithRequestId("44444444-4444-4444-8444-444444444444", () => {
      console.error("scan failed");
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("request_id");
    expect(params[2]).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("gives every console.error inside one request the same id", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    runWithRequestId("55555555-5555-4555-8555-555555555555", () => {
      console.error("[API Error] upstream refused");
      console.error("[safeFetch] connect ECONNREFUSED");
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][1][2]).toBe(
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mockQuery.mock.calls[1][1][2]).toBe(
      "55555555-5555-4555-8555-555555555555",
    );
  });

  it("keeps the id across an await, not just the synchronous call", async () => {
    console.error = vi.fn();
    installErrorLogCapture();

    await runWithRequestId("66666666-6666-4666-8666-666666666666", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      console.error("late failure");
    });

    expect(mockQuery.mock.calls[0][1][2]).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
  });

  it("writes null outside a request, rather than leaking the previous one", () => {
    // Boot, a cron tick and the background scan worker all log here with no
    // request in scope. Reusing a stale id would be worse than none: it
    // would tie an unrelated failure to somebody's request.
    console.error = vi.fn();
    installErrorLogCapture();

    runWithRequestId("77777777-7777-4777-8777-777777777777", () => {
      console.error("during a request");
    });
    console.error("outside any request");

    expect(mockQuery.mock.calls[1][1][2]).toBeNull();
  });
});

/**
 * A background scan outlives the request that started it and a scheduled one
 * never had one, so request_id alone cannot answer "what went wrong with scan
 * 4812". The wrapper stamps the ambient scan id the same way it stamps the
 * request id.
 */
describe("installErrorLogCapture: scan correlation id", () => {
  it("stamps the ambient scan id onto the row", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    runWithScanId(4812, () => {
      console.error("check threw");
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("scan_id");
    expect(params[3]).toBe(4812);
  });

  it("carries both ids when a scan runs inside a request", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    runWithRequestId("88888888-8888-4888-8888-888888888888", () => {
      runWithScanId(7, () => {
        console.error("inside both");
      });
    });

    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe("88888888-8888-4888-8888-888888888888");
    expect(params[3]).toBe(7);
  });

  it("writes null outside any scan", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("not part of a scan");

    expect(mockQuery.mock.calls[0][1][3]).toBeNull();
  });
});

/**
 * The flood guards used to drop rows without a word, so during an incident
 * the panel showed about a hundred rows and looked complete. Now each window
 * that dropped anything gets one `[error-capture]` row saying how many and
 * what, and a drop is never silent.
 */
describe("installErrorLogCapture: suppression summary", () => {
  const START = new Date("2026-10-25T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const summaryCalls = () =>
    mockQuery.mock.calls.filter(([, params]) =>
      String(params[0]).startsWith("[error-capture]"),
    );

  it("writes nothing extra when nothing was dropped", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("one");
    console.error("two");
    vi.advanceTimersByTime(120_000);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(summaryCalls()).toHaveLength(0);
  });

  it("reports the rows the per-minute cap swallowed once the window ends", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    for (let i = 0; i < 130; i++) console.error(`failure number ${i}`);
    // 100 stored, nothing said yet: the window is still open.
    expect(mockQuery).toHaveBeenCalledTimes(100);

    vi.advanceTimersByTime(60_000);

    expect(mockQuery).toHaveBeenCalledTimes(101);
    const [sql, params] = mockQuery.mock.calls[100];
    expect(sql).toContain("INSERT INTO system_error_logs");
    expect(params[0]).toMatch(/^\[error-capture\] suppressed 30 errors/);
    expect(params[0]).toContain("30 over the 100 per minute cap");
    expect(params[0]).toContain(START.toISOString());
    // The detail names what was lost, so the panel is useful without a shell.
    expect(params[1]).toContain("failure number 100");
    expect(params[1]).toContain("still printed to the server console");
  });

  it("counts coalesced repeats and names the message", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    for (let i = 0; i < 5; i++) console.error("retrying connection");
    expect(mockQuery).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const params = mockQuery.mock.calls[1][1];
    expect(params[0]).toContain("suppressed 4 errors");
    expect(params[0]).toContain('4 repeats of "retrying connection"');
    expect(params[1]).toContain("4x  retrying connection");
  });

  it("writes ONE summary per window however many drops it holds", () => {
    // A, A, B, B, A, A flips the message three times. A row per flip would be
    // the flood the guard exists to stop.
    console.error = vi.fn();
    installErrorLogCapture();

    for (const m of ["A", "A", "B", "B", "A", "A"]) console.error(m);
    vi.advanceTimersByTime(60_000);

    expect(summaryCalls()).toHaveLength(1);
    expect(summaryCalls()[0][1][0]).toContain("suppressed 3 errors");
  });

  it("reports on the next error when no timer got to it, before storing it", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("burst");
    console.error("burst");
    // Move the clock without running timers, as a stalled event loop would.
    vi.setSystemTime(new Date(START.getTime() + 61_000));
    console.error("next window");

    const messages = mockQuery.mock.calls.map(([, p]) => String(p[0]));
    expect(messages[0]).toBe("burst");
    expect(messages[1]).toMatch(/^\[error-capture\] suppressed 1 error /);
    expect(messages[2]).toBe("next window");
  });

  it("never stamps the summary with the request or scan that happened to trigger it", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("burst");
    console.error("burst");
    vi.setSystemTime(new Date(START.getTime() + 61_000));
    runWithRequestId("99999999-9999-4999-8999-999999999999", () => {
      runWithScanId(55, () => {
        console.error("unrelated work");
      });
    });

    const summary = summaryCalls()[0][1];
    expect(summary[2]).toBeNull();
    expect(summary[3]).toBeNull();
    // ...while the row for the call itself keeps its ids.
    const own = mockQuery.mock.calls.find(
      ([, p]) => p[0] === "unrelated work",
    )![1];
    expect(own[2]).toBe("99999999-9999-4999-8999-999999999999");
    expect(own[3]).toBe(55);
  });

  it("is not itself held back by the cap it is reporting", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    for (let i = 0; i < 200; i++) console.error(`distinct ${i}`);
    vi.advanceTimersByTime(60_000);

    expect(summaryCalls()).toHaveLength(1);
  });

  it("starts a fresh count for the next window", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("x");
    console.error("x");
    vi.advanceTimersByTime(60_000);
    console.error("y");
    console.error("y");
    console.error("y");
    vi.advanceTimersByTime(60_000);

    const counts = summaryCalls().map(
      ([, p]) => String(p[0]).match(/suppressed (\d+)/)?.[1],
    );
    expect(counts).toEqual(["1", "2"]);
  });

  it("files a repeat that lands just past a boundary under the window it arrived in", () => {
    // The stored copy is at +59s and the repeat at +61s: inside the coalesce
    // window, but past the end of the first rate window. The drop belongs to
    // the second window, so the summary is due a full window after +61s, not
    // immediately because the first window had already ended.
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("warmup");
    vi.setSystemTime(new Date(START.getTime() + 59_000));
    console.error("same");
    vi.setSystemTime(new Date(START.getTime() + 61_000));
    console.error("same");

    vi.advanceTimersByTime(59_999);
    expect(summaryCalls()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(summaryCalls()).toHaveLength(1);
  });

  it("bounds what a summary quotes of a very long message", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    const long = "z".repeat(1500);
    console.error(long);
    console.error(long);
    vi.advanceTimersByTime(60_000);

    expect(String(summaryCalls()[0][1][0]).length).toBeLessThan(400);
  });

  it("leaves no timer behind once the state is reset", () => {
    console.error = vi.fn();
    installErrorLogCapture();

    console.error("x");
    console.error("x");
    expect(vi.getTimerCount()).toBe(1);

    _resetErrorLogCaptureStateForTests();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not turn a failed summary insert into an error for the caller", async () => {
    console.error = vi.fn();
    installErrorLogCapture();
    console.error("x");
    console.error("x");
    mockQuery.mockRejectedValue(new Error("pool is draining"));

    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    await Promise.resolve();
  });
});
