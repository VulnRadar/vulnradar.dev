import { describe, it, expect, vi } from "vitest";
import {
  isStaleChunkError,
  reloadOnceForStaleChunk,
} from "@/lib/ui/stale-chunk";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("isStaleChunkError", () => {
  it("recognises the errors a missing chunk raises", () => {
    const named = Object.assign(new Error("x"), { name: "ChunkLoadError" });
    expect(isStaleChunkError(named)).toBe(true);
    expect(
      isStaleChunkError(
        new Error(
          "Loading chunk 8123 failed. (error: /_next/static/chunks/8123.js)",
        ),
      ),
    ).toBe(true);
    expect(
      isStaleChunkError(new Error("Loading CSS chunk app-layout failed")),
    ).toBe(true);
    expect(
      isStaleChunkError(
        new TypeError("Failed to fetch dynamically imported module: /x.js"),
      ),
    ).toBe(true);
  });

  it("leaves every other error alone", () => {
    expect(
      isStaleChunkError(new Error("Cannot read properties of undefined")),
    ).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError("Loading chunk 1 failed")).toBe(false);
  });
});

describe("reloadOnceForStaleChunk", () => {
  const stale = Object.assign(new Error("x"), { name: "ChunkLoadError" });

  it("reloads once, then not again within the guard window", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(
      reloadOnceForStaleChunk(stale, { storage, reload, now: 1_000_000 }),
    ).toBe(true);
    expect(
      reloadOnceForStaleChunk(stale, { storage, reload, now: 1_010_000 }),
    ).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // A later deploy gets its own reload.
    expect(
      reloadOnceForStaleChunk(stale, { storage, reload, now: 1_100_000 }),
    ).toBe(true);
  });

  it("does nothing for an ordinary error or without storage to guard a loop", () => {
    const reload = vi.fn();
    expect(
      reloadOnceForStaleChunk(new Error("boom"), {
        storage: memoryStorage(),
        reload,
        now: 1,
      }),
    ).toBe(false);
    expect(
      reloadOnceForStaleChunk(stale, { storage: null, reload, now: 1 }),
    ).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing on the server", () => {
    expect(reloadOnceForStaleChunk(stale)).toBe(false);
  });
});
