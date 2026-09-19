/**
 * The running scan a dashboard tab remembers so a reload can pick it back up
 * (app/dashboard/running-scan.ts). The scan is a server-side job that never
 * needed the page open; what a reload lost was anything on screen following
 * it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  readRememberedScan,
  rememberRunningScan,
} from "@/app/dashboard/running-scan";

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remembering the running scan", () => {
  it("reads back the scan it was given, and forgets it on request", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());

    rememberRunningScan({
      scanId: 42,
      url: "https://example.com",
      mode: "deep",
      isCrawl: true,
    });
    expect(readRememberedScan()).toEqual({
      scanId: 42,
      url: "https://example.com",
      mode: "deep",
      isCrawl: true,
    });

    rememberRunningScan(null);
    expect(readRememberedScan()).toBeNull();
  });

  it("ignores a stored value that is not a scan", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);

    storage.setItem("vulnradar:running-scan", "not json");
    expect(readRememberedScan()).toBeNull();

    storage.setItem("vulnradar:running-scan", JSON.stringify({ url: "x" }));
    expect(readRememberedScan()).toBeNull();
  });

  it("does not throw where storage is unavailable", () => {
    // A private window or blocked site data: the scan still runs, the tab
    // just cannot pick it back up after a reload.
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });

    expect(() =>
      rememberRunningScan({
        scanId: 1,
        url: "https://example.com",
        mode: "quick",
        isCrawl: false,
      }),
    ).not.toThrow();
    expect(readRememberedScan()).toBeNull();
  });
});
