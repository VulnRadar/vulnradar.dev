import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  BACKGROUND_WORKERS,
  hostRunsWorkers,
} from "@/lib/admin/worker-registry";

/**
 * The Overview reports on the workers in this registry. A worker that records
 * ticks (createFailureEscalator) but is missing from it is invisible there:
 * it can fail every pass for a week and the panel stays green, which is the
 * gap the registry exists to close. So the registry is checked against the
 * code, not against anyone's memory.
 */
const ROOT = path.resolve(__dirname, "..", "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function escalatorEvents(): string[] {
  const events: string[] = [];
  for (const file of sourceFiles(path.join(ROOT, "lib"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/createFailureEscalator\(\s*"([^"]+)"/g)) {
      events.push(m[1]);
    }
  }
  return events;
}

describe("BACKGROUND_WORKERS", () => {
  it("lists every worker that records its ticks, and nothing else", () => {
    expect([...escalatorEvents()].sort()).toEqual(
      BACKGROUND_WORKERS.map((w) => w.event).sort(),
    );
  });

  it("names each worker once", () => {
    const events = BACKGROUND_WORKERS.map((w) => w.event);
    expect(new Set(events).size).toBe(events.length);
    const labels = BACKGROUND_WORKERS.map((w) => w.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("gives each worker a real cadence, since staleness is judged against it", () => {
    for (const w of BACKGROUND_WORKERS) {
      expect(Number.isFinite(w.intervalMs)).toBe(true);
      expect(w.intervalMs).toBeGreaterThan(0);
    }
  });

  it("uses the cadence the worker arms with", () => {
    const byEvent = Object.fromEntries(
      BACKGROUND_WORKERS.map((w) => [w.event, w.intervalMs]),
    );
    // The boot passes a literal five minutes to the cleanup timer; this is
    // the number the Overview judges it by.
    expect(byEvent.cleanup_worker_failing).toBe(5 * 60 * 1000);
    expect(byEvent.scheduled_scans_worker_failing).toBe(2 * 60 * 1000);
    expect(byEvent.scheduled_backup_worker_failing).toBe(24 * 60 * 60 * 1000);
  });
});

describe("hostRunsWorkers", () => {
  it("is true on an ordinary long-running host", () => {
    expect(hostRunsWorkers({})).toBe(true);
  });

  it.each(["VERCEL", "AWS_LAMBDA_FUNCTION_NAME", "NETLIFY"])(
    "is false where %s is set, because no timer lives long enough to tick",
    (name) => {
      expect(hostRunsWorkers({ [name]: "1" })).toBe(false);
    },
  );
});
