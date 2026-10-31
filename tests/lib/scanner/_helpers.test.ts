/**
 * Tests for the primitives in lib/scanner/_helpers.ts that more than one
 * scanner module depends on: the finding-id hash and the deadline race.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { generateId, withDeadline } from "@/lib/scanner/_helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("generateId", () => {
  // Ids key scan_finding_feedback rows and regression-alert baselines, so the
  // output may never change. These literals are FNV-1a 32 in base 36 of the
  // exact input, computed once and pinned.
  it("is <checkId>--<FNV-1a 32 of the url, base 36>", () => {
    expect(generateId("csp-missing", "https://example.com")).toBe(
      "csp-missing--v03177",
    );
    expect(generateId("csp-missing", "https://example.com/")).toBe(
      "csp-missing--1qfat2s",
    );
  });

  it("hashes an empty url to a stable value rather than failing", () => {
    expect(generateId("x", "")).toBe("x--ztntfp");
  });

  it("folds a distinguisher into the hash, separated by one space", () => {
    expect(generateId("x", "https://example.com", "x")).toBe("x--1v91943");
    expect(generateId("x", "https://example.com", "a")).toBe("x--1sr4tvc");
    expect(generateId("x", "https://example.com", "b")).toBe("x--1tl3my9");
  });

  it("treats an empty distinguisher as none", () => {
    expect(generateId("x", "https://example.com", "")).toBe(
      generateId("x", "https://example.com"),
    );
  });
});

describe("withDeadline", () => {
  it("resolves with the value and leaves no timer pending", async () => {
    vi.useFakeTimers();
    await expect(withDeadline(Promise.resolve("answer"), 4000)).resolves.toBe(
      "answer",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the original error and leaves no timer pending", async () => {
    vi.useFakeTimers();
    const failure = Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    await expect(withDeadline(Promise.reject(failure), 4000)).rejects.toBe(
      failure,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the bare message 'timeout' once the deadline passes", async () => {
    vi.useFakeTimers();
    let settled = false;
    const raced = withDeadline(new Promise<string>(() => {}), 4000);
    const outcome = raced.then(
      () => {
        settled = true;
        return "resolved";
      },
      (err: Error) => {
        settled = true;
        return err;
      },
    );

    await vi.advanceTimersByTimeAsync(3999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const err = (await outcome) as Error;
    expect(err).toBeInstanceOf(Error);
    // reputation-lookup compares this exactly and async-checks matches it
    // with /timeout/i, so it must stay the plain word.
    expect(err.message).toBe("timeout");
    expect((err as { code?: string }).code).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("absorbs a rejection that arrives after the deadline fired", async () => {
    vi.useFakeTimers();
    let rejectLate!: (reason: Error) => void;
    const late = new Promise<string>((_, reject) => {
      rejectLate = reject;
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const raced = withDeadline(late, 10);
      const outcome = raced.catch((err: Error) => err.message);
      await vi.advanceTimersByTimeAsync(10);
      await expect(outcome).resolves.toBe("timeout");

      rejectLate(new Error("resolver finally gave up"));
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("ignores a value that arrives after the deadline fired", async () => {
    vi.useFakeTimers();
    let resolveLate!: (value: string) => void;
    const late = new Promise<string>((resolve) => {
      resolveLate = resolve;
    });
    const outcome = withDeadline(late, 10).then(
      (value) => value,
      (err: Error) => err.message,
    );
    await vi.advanceTimersByTimeAsync(10);
    resolveLate("too late");
    await expect(outcome).resolves.toBe("timeout");
  });

  it("unrefs its timer, so a pending deadline never holds a worker open", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const raced = withDeadline(new Promise<string>(() => {}), 4000);
    void raced.catch(() => {});

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 4000);
    // The handle is the fake clock's own, which tracks ref and unref like
    // Node's does.
    const handle = setTimeoutSpy.mock.results[0].value as {
      hasRef(): boolean;
    };
    expect(handle.hasRef()).toBe(false);
  });

  it("still works where a timer handle has no unref", async () => {
    vi.stubGlobal(
      "setTimeout",
      vi.fn(() => 7),
    );
    vi.stubGlobal("clearTimeout", vi.fn());
    await expect(withDeadline(Promise.resolve("fine"), 50)).resolves.toBe(
      "fine",
    );
  });

  it("passes a non-promise straight through, as Promise.race did", async () => {
    vi.useFakeTimers();
    const notAPromise = ["93.184.216.34"] as unknown as Promise<string[]>;
    await expect(withDeadline(notAPromise, 4000)).resolves.toEqual([
      "93.184.216.34",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
