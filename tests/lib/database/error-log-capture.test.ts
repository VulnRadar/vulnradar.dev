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
