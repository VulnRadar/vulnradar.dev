import { describe, it, expect } from "vitest";
import {
  currentRequestId,
  currentScanId,
  runWithRequestId,
  runWithScanId,
} from "@/lib/database/request-context";

/**
 * The two ambient ids error rows are correlated by. The case that matters is
 * nesting: a scan is started from inside a request, and the scan context must
 * not erase the request id it was started under (nor the other way round),
 * or the rows one failing scan writes stop matching the request that a user
 * reports.
 */
describe("request context", () => {
  it("has neither id outside any context", () => {
    expect(currentRequestId()).toBeNull();
    expect(currentScanId()).toBeNull();
  });

  it("keeps the request id when a scan context opens inside it", async () => {
    await runWithRequestId("req-abcdef12", async () => {
      await runWithScanId(4812, async () => {
        await Promise.resolve();
        expect(currentRequestId()).toBe("req-abcdef12");
        expect(currentScanId()).toBe(4812);
      });
      // Leaving the scan context restores the outer one exactly.
      expect(currentScanId()).toBeNull();
      expect(currentRequestId()).toBe("req-abcdef12");
    });
  });

  it("keeps the scan id when a request context opens inside it", () => {
    runWithScanId(7, () => {
      runWithRequestId("req-12345678", () => {
        expect(currentScanId()).toBe(7);
        expect(currentRequestId()).toBe("req-12345678");
      });
    });
  });

  it("follows detached work started inside the context", async () => {
    // executeScan is dispatched with `void`, not awaited, by the route that
    // starts it. Async context follows the promise, which is what lets a
    // background scan's errors still carry both ids.
    let seen: [string | null, number | null] = [null, null];
    let detached: Promise<void> = Promise.resolve();
    runWithRequestId("req-detached", () => {
      runWithScanId(99, () => {
        detached = (async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          seen = [currentRequestId(), currentScanId()];
        })();
      });
    });
    await detached;
    expect(seen).toEqual(["req-detached", 99]);
  });

  it("ignores a scan id that is not a positive integer", () => {
    // The value lands in an INTEGER column; a bad one is dropped, not stored.
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const result = runWithScanId(bad, () => currentScanId());
      expect(result, String(bad)).toBeNull();
    }
  });

  it("returns what the wrapped function returns", () => {
    expect(runWithScanId(3, () => "done")).toBe("done");
    expect(runWithRequestId("req-12345678", () => 42)).toBe(42);
  });
});
