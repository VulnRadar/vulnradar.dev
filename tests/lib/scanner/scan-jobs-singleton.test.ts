/**
 * The cancel flag and the cancel signal have to be visible to every copy of
 * lib/scanner/scan-jobs.ts in the process.
 *
 * Next bundles that module once per runtime layer. With the flag in a
 * module-level Set, the route that cancelled a scheduled scan wrote to one
 * copy and the job read another, so the scan kept requesting its target to
 * the end. vi.resetModules() between two imports gives two module instances
 * in one process, which is the same shape.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/database/db", () => ({
  default: {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: vi.fn(),
  },
}));
vi.mock("@/lib/config/runtime-config", () => ({
  getSettings: vi.fn(async () => ({})),
}));

async function freshCopy() {
  vi.resetModules();
  return import("@/lib/scanner/scan-jobs");
}

describe("scan-jobs cancellation across module copies", () => {
  it("a cancel requested through one copy is seen by another", async () => {
    const route = await freshCopy();
    const job = await freshCopy();
    expect(route.requestCancel).not.toBe(job.requestCancel);

    expect(job.isCancelled(9001)).toBe(false);
    route.requestCancel(9001);
    expect(job.isCancelled(9001)).toBe(true);

    job.clearCancel(9001);
    expect(route.isCancelled(9001)).toBe(false);
  });

  it("aborts the signal a job took from its own copy", async () => {
    const job = await freshCopy();
    const signal = job.getCancelSignal(9002);
    const route = await freshCopy();

    route.requestCancel(9002);
    expect(signal.aborted).toBe(true);
    // The same controller, not a second one the later copy created.
    expect(route.getCancelSignal(9002)).toBe(signal);

    route.clearCancel(9002);
  });

  it("stops the progress hook of a job running in another copy", async () => {
    const job = await freshCopy();
    const { onProgress } = job.createProgressTracker(9003);
    const route = await freshCopy();

    route.requestCancel(9003);
    expect(() => onProgress("headers", "start")).toThrow("Cancelled");

    route.clearCancel(9003);
  });
});
