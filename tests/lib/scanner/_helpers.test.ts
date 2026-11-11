/**
 * Tests for the primitives in lib/scanner/_helpers.ts that more than one
 * scanner module depends on: the finding-id hash and the deadline race.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  canonicalScanUrl,
  generateId,
  getSetCookies,
  legacyFindingId,
  withDeadline,
} from "@/lib/scanner/_helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("legacyFindingId", () => {
  // The ids feedback and remediation rows were stored under, which the remap
  // recognises. These literals are FNV-1a 32 in base 36 of the exact input,
  // computed once and pinned.
  it("is <checkId>--<FNV-1a 32 of the url as given, base 36>", () => {
    expect(legacyFindingId("csp-missing", "https://example.com")).toBe(
      "csp-missing--v03177",
    );
    expect(legacyFindingId("csp-missing", "https://example.com/")).toBe(
      "csp-missing--1qfat2s",
    );
  });

  it("hashes an empty url to a stable value rather than failing", () => {
    expect(legacyFindingId("x", "")).toBe("x--ztntfp");
  });

  it("folds a distinguisher into the hash, separated by one space", () => {
    expect(legacyFindingId("x", "https://example.com", "x")).toBe("x--1v91943");
    expect(legacyFindingId("x", "https://example.com", "a")).toBe("x--1sr4tvc");
    expect(legacyFindingId("x", "https://example.com", "b")).toBe("x--1tl3my9");
  });

  it("treats an empty distinguisher as none", () => {
    expect(legacyFindingId("x", "https://example.com", "")).toBe(
      legacyFindingId("x", "https://example.com"),
    );
  });
});

describe("generateId", () => {
  // Ids key scan_finding_feedback rows and regression-alert baselines. The
  // canonical spelling of a URL keeps the id it always had, so the common
  // stored form (an address with its root slash) did not move.
  it("is the legacy id of the canonical url", () => {
    expect(generateId("csp-missing", "https://example.com/")).toBe(
      "csp-missing--1qfat2s",
    );
    expect(generateId("x", "https://example.com/", "a")).toBe(
      legacyFindingId("x", "https://example.com/", "a"),
    );
  });

  it.each([
    "https://example.com",
    "https://EXAMPLE.com/",
    "https://example.com/#pricing",
    "https://Example.COM",
  ])("gives %s the id of https://example.com/", (spelling) => {
    expect(generateId("csp-missing", spelling)).toBe("csp-missing--1qfat2s");
  });

  // The path is what gets fetched, and "/blog/" and "/blog" can answer
  // differently, so they are two pages with two sets of ids; the stored id of
  // either is the one it always had.
  it("keeps a page's path as given and its query apart", () => {
    expect(generateId("x", "https://example.com/blog/")).toBe(
      legacyFindingId("x", "https://example.com/blog/"),
    );
    expect(generateId("x", "https://example.com/blog/")).not.toBe(
      generateId("x", "https://example.com/blog"),
    );
    expect(generateId("x", "https://example.com/blog?page=2")).not.toBe(
      generateId("x", "https://example.com/blog"),
    );
  });

  it("hashes what is not a URL exactly as given", () => {
    expect(generateId("host-listed-threat-intel", "Example.com")).toBe(
      legacyFindingId("host-listed-threat-intel", "Example.com"),
    );
    expect(generateId("x", "")).toBe("x--ztntfp");
  });
});

describe("canonicalScanUrl", () => {
  it.each([
    ["https://Example.com", "https://example.com/"],
    ["https://example.com/a/", "https://example.com/a/"],
    ["https://example.com/a", "https://example.com/a"],
    ["https://example.com/a/?q=1#frag", "https://example.com/a/?q=1"],
    ["http://example.com:80/", "http://example.com/"],
    ["ssh://Host.example:22", "ssh://host.example:22/"],
    ["mongodb://db.example:27017/", "mongodb://db.example:27017/"],
  ])("canonicalises %s to %s", (input, output) => {
    expect(canonicalScanUrl(input)).toBe(output);
  });

  it("returns a string the parser refuses, or one with no host, unchanged", () => {
    expect(canonicalScanUrl("not a url")).toBe("not a url");
    expect(canonicalScanUrl("mailto:a@example.com")).toBe(
      "mailto:a@example.com",
    );
  });
});

describe("getSetCookies", () => {
  it("returns every Set-Cookie header separately", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Secure");
    expect(getSetCookies(headers)).toEqual(["a=1; Path=/", "b=2; Secure"]);
  });

  it("falls back to iterating when the runtime has no getSetCookie", () => {
    const headers = new Headers({ "set-cookie": "a=1" });
    Object.defineProperty(headers, "getSetCookie", { value: undefined });
    expect(getSetCookies(headers)).toEqual(["a=1"]);
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
