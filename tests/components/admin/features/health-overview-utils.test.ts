/**
 * Unit tests for the pure verdict logic behind Admin > Overview
 * (AUDIT-014 qols-02). GET /api/v3/admin/health returns raw numbers only;
 * everything that decides whether a row is green, amber or red lives in
 * components/admin/features/health-overview-utils.ts, which is a plain .ts
 * file for exactly this reason (see queue-status-utils.test.ts's header for
 * why a .tsx cannot be imported from a test in this repo).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildHealthRows,
  workerVerdict,
  worstHealthState,
  worseState,
  type HealthMetrics,
  type WorkerHealth,
} from "@/components/admin/features/health-overview-utils";
import { STALE_RUNNING_MS } from "@/components/admin/features/queue-status-utils";

const NOW = new Date("2026-08-31T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function metrics(overrides: Partial<HealthMetrics> = {}): HealthMetrics {
  return {
    generatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function rowFor(m: HealthMetrics, key: string) {
  return buildHealthRows(m).find((r) => r.key === key);
}

describe("permission gating", () => {
  it("renders no row for a metric the caller may not read", () => {
    // Absent key (not permitted) is not the same as null (query failed).
    expect(buildHealthRows(metrics())).toEqual([]);
  });

  it("renders an unknown row for a metric whose query failed", () => {
    const rows = buildHealthRows(metrics({ errorLogs: null }));
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("unknown");
    expect(rows[0].tab).toBe("error-logs");
  });

  it("expands a failed scan-queue read into both of its rows", () => {
    const rows = buildHealthRows(metrics({ scanQueue: null }));
    expect(rows.map((r) => r.key)).toEqual(["scan-queue", "failed-scans"]);
    expect(rows.every((r) => r.state === "unknown")).toBe(true);
  });
});

describe("scanner queue", () => {
  const base = {
    pending: 0,
    running: 0,
    oldestPendingAgeMs: null,
    oldestRunningAgeMs: null,
    completedLast24h: 40,
    failedLast24h: 0,
    cancelledLast24h: 0,
    refusedLast24h: 0,
    targetFailedLast24h: 0,
  };

  it("is green when nothing is waiting longer than it should", () => {
    expect(rowFor(metrics({ scanQueue: base }), "scan-queue")?.state).toBe(
      "ok",
    );
  });

  it("is amber when the oldest pending scan is past the stale threshold", () => {
    const row = rowFor(
      metrics({
        scanQueue: { ...base, pending: 3, oldestPendingAgeMs: 5 * 60_000 },
      }),
      "scan-queue",
    );
    expect(row?.state).toBe("warn");
  });

  it("is red when a running scan is past every configured scan timeout", () => {
    const row = rowFor(
      metrics({
        scanQueue: {
          ...base,
          running: 1,
          oldestRunningAgeMs: STALE_RUNNING_MS + 1,
        },
      }),
      "scan-queue",
    );
    expect(row?.state).toBe("crit");
  });

  it("ignores an age field when its status has no rows", () => {
    // The age only means something when there is a row it came from.
    const row = rowFor(
      metrics({
        scanQueue: { ...base, pending: 0, oldestPendingAgeMs: 10 * 60_000 },
      }),
      "scan-queue",
    );
    expect(row?.state).toBe("ok");
  });
});

describe("failed scans", () => {
  const base = {
    pending: 0,
    running: 0,
    oldestPendingAgeMs: null,
    oldestRunningAgeMs: null,
    cancelledLast24h: 0,
    refusedLast24h: 0,
    targetFailedLast24h: 0,
  };

  it("is green with no failures", () => {
    const row = rowFor(
      metrics({
        scanQueue: { ...base, completedLast24h: 30, failedLast24h: 0 },
      }),
      "failed-scans",
    );
    expect(row?.state).toBe("ok");
  });

  it("is amber for any failure below the rate threshold", () => {
    const row = rowFor(
      metrics({
        scanQueue: { ...base, completedLast24h: 100, failedLast24h: 2 },
      }),
      "failed-scans",
    );
    expect(row?.state).toBe("warn");
  });

  it("is red once a quarter of a meaningful volume failed", () => {
    const row = rowFor(
      metrics({
        scanQueue: { ...base, completedLast24h: 30, failedLast24h: 15 },
      }),
      "failed-scans",
    );
    expect(row?.state).toBe("crit");
  });

  it("stays amber at a high rate on a volume too small to mean anything", () => {
    const row = rowFor(
      metrics({
        scanQueue: { ...base, completedLast24h: 1, failedLast24h: 1 },
      }),
      "failed-scans",
    );
    expect(row?.state).toBe("warn");
  });

  // The defect: a user pressing Cancel, a quota refusing a bulk batch and a
  // down target all end `failed`, and the row counted every one of them. A
  // busy day of cancels read as an outage. failedLast24h is now engine
  // failures only; the rest arrive in their own fields and are never part of
  // the rate.
  it("does not let cancels, refusals and down targets turn the row red", () => {
    const row = rowFor(
      metrics({
        scanQueue: {
          ...base,
          completedLast24h: 30,
          failedLast24h: 0,
          cancelledLast24h: 40,
          refusedLast24h: 25,
          targetFailedLast24h: 60,
        },
      }),
      "failed-scans",
    );
    expect(row?.state).toBe("ok");
    expect(row?.value).toBe("0");
  });

  it("computes the rate from engine failures alone", () => {
    // 3 engine failures of 50 = 6%: amber. If the 100 other failed rows
    // counted, it would be 103 of 150 and red.
    const row = rowFor(
      metrics({
        scanQueue: {
          ...base,
          completedLast24h: 47,
          failedLast24h: 3,
          cancelledLast24h: 60,
          targetFailedLast24h: 40,
        },
      }),
      "failed-scans",
    );
    expect(row?.state).toBe("warn");
    expect(row?.detail).toContain("3 of 50 scans");
    expect(row?.detail).toContain("(6%)");
  });

  it("says where the other failures went instead of dropping them", () => {
    const row = rowFor(
      metrics({
        scanQueue: {
          ...base,
          completedLast24h: 10,
          failedLast24h: 0,
          cancelledLast24h: 12,
          refusedLast24h: 3,
          targetFailedLast24h: 6,
        },
      }),
      "failed-scans",
    );
    expect(row?.detail).toContain(
      "Not counted: 12 cancelled, 3 refused by a limit or never run, 6 stopped at the target.",
    );
  });

  it("stays quiet about uncounted failures when there are none", () => {
    const row = rowFor(
      metrics({
        scanQueue: { ...base, completedLast24h: 10, failedLast24h: 0 },
      }),
      "failed-scans",
    );
    expect(row?.detail).not.toContain("Not counted");
  });

  it("does not claim every scan finished when none ran", () => {
    const row = rowFor(
      metrics({
        scanQueue: { ...base, completedLast24h: 0, failedLast24h: 0 },
      }),
      "failed-scans",
    );
    expect(row?.state).toBe("ok");
    expect(row?.detail).toContain("No scan finished or broke");
  });
});

describe("background workers", () => {
  const HOUR = 60 * 60_000;
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  const worker = (over: Partial<WorkerHealth> = {}): WorkerHealth => ({
    event: "scheduled_scans_worker_failing",
    label: "Scheduled scans",
    intervalMs: 2 * 60_000,
    consecutiveFailures: 0,
    lastSuccessAt: ago(60_000),
    lastFailureAt: null,
    lastError: null,
    updatedAt: ago(60_000),
    ...over,
  });

  const row = (rows: WorkerHealth[], workersRun = true) =>
    rowFor(metrics({ workers: { workersRun, rows } }), "workers");

  it("is green when every worker has ticked inside its interval", () => {
    const r = row([worker(), worker({ label: "Cleanup", event: "c" })]);
    expect(r?.state).toBe("ok");
    expect(r?.value).toBe("2 of 2 reporting");
  });

  it("goes red at three failures in a row and names the worker and the reason", () => {
    const r = row([
      worker({
        consecutiveFailures: 3,
        lastError: "Every due scheduled scan is failing",
      }),
    ]);
    expect(r?.state).toBe("crit");
    expect(r?.detail).toContain("Scheduled scans has failed 3 times in a row");
    expect(r?.detail).toContain("Every due scheduled scan is failing.");
  });

  it("does not go red for a streak the escalator itself treats as a blip", () => {
    expect(row([worker({ consecutiveFailures: 2 })])?.state).toBe("ok");
  });

  it("warns once a worker has been silent for three of its own intervals", () => {
    // Two minutes between ticks, so more than six minutes of silence.
    const stale = row([worker({ updatedAt: ago(7 * 60_000) })]);
    expect(stale?.state).toBe("warn");
    expect(stale?.detail).toContain("Scheduled scans last reported");
    expect(stale?.detail).toContain("should tick about every");

    const slow = row([worker({ updatedAt: ago(5 * 60_000) })]);
    expect(slow?.state).toBe("ok");
  });

  it("judges a slow worker by its own interval, not a shared one", () => {
    const digest = worker({
      label: "Posture digests",
      intervalMs: 6 * HOUR,
      updatedAt: ago(10 * HOUR),
    });
    expect(row([digest])?.state).toBe("ok");
    expect(row([{ ...digest, updatedAt: ago(19 * HOUR) }])?.state).toBe("warn");
  });

  it("puts a failing worker ahead of a stale one in the sentence", () => {
    const r = row([
      worker({ label: "Stale one", updatedAt: ago(HOUR) }),
      worker({
        label: "Failing one",
        consecutiveFailures: 4,
        lastError: "boom",
      }),
    ]);
    expect(r?.state).toBe("crit");
    expect(r?.value).toBe("2 of 2 need attention");
    expect(r?.detail.indexOf("Failing one")).toBeLessThan(
      r?.detail.indexOf("Stale one") ?? -1,
    );
  });

  it("does not judge a worker that has never ticked", () => {
    // A fresh install, or a worker that has not reached its first tick. A
    // timer that died later is a worker that DID tick.
    const r = row([
      worker(),
      worker({
        label: "Backups",
        event: "b",
        intervalMs: 24 * HOUR,
        updatedAt: null,
        lastSuccessAt: null,
      }),
    ]);
    expect(r?.state).toBe("ok");
    expect(r?.value).toBe("1 of 2 reporting");
    expect(r?.detail).toContain("Backups has not recorded a tick yet");
  });

  it("suppresses the stale warning where workers never arm", () => {
    // A serverless host: nothing ticks, so a stale or missing row is the
    // normal state and must not sit amber forever.
    const r = row(
      [worker({ updatedAt: ago(100 * HOUR), consecutiveFailures: 0 })],
      false,
    );
    expect(r?.state).toBe("ok");
    expect(r?.value).toBe("not applicable");
    expect(r?.detail).toContain("serverless");
  });

  it("renders an unknown row when the workers read failed", () => {
    const r = rowFor(metrics({ workers: null }), "workers");
    expect(r?.state).toBe("unknown");
    expect(r?.tab).toBe("error-logs");
  });

  it("exposes the per-worker verdict for a caller that wants one", () => {
    expect(workerVerdict(worker()).state).toBe("ok");
    expect(workerVerdict(worker({ consecutiveFailures: 3 })).state).toBe(
      "crit",
    );
    expect(
      workerVerdict(worker({ intervalMs: 0, updatedAt: ago(HOUR) })).state,
    ).toBe("ok");
  });
});

describe("overdue schedules", () => {
  const MIN = 60_000;
  const row = (over: {
    count: number;
    oldestOverdueMs: number | null;
    workersRun?: boolean;
    scheduledScansEnabled?: boolean;
  }) =>
    rowFor(
      metrics({ overdueSchedules: { workersRun: true, ...over } }),
      "overdue-schedules",
    );

  it("is green when nothing is overdue", () => {
    expect(row({ count: 0, oldestOverdueMs: null })?.state).toBe("ok");
  });

  it("warns for schedules that are late and names how late", () => {
    const r = row({ count: 2, oldestOverdueMs: 45 * MIN });
    expect(r?.state).toBe("warn");
    expect(r?.value).toBe("2");
    expect(r?.detail).toContain("2 active schedules were due more than 30");
    expect(r?.detail).toContain("the oldest is");
  });

  it("goes red when the oldest is hours late", () => {
    expect(row({ count: 1, oldestOverdueMs: 7 * 60 * MIN })?.state).toBe(
      "crit",
    );
  });

  it("is not a fault where the scheduled-scans worker cannot run", () => {
    const r = row({
      count: 5,
      oldestOverdueMs: 99 * 60 * MIN,
      workersRun: false,
    });
    expect(r?.state).toBe("ok");
    expect(r?.value).toBe("not applicable");
  });

  it("is not a fault while an operator has the feature switched off", () => {
    // The worker claims nothing in that state, on purpose, so the schedules
    // pile up unrun; holding the row red for it would be the panel crying wolf.
    const r = row({
      count: 5,
      oldestOverdueMs: 99 * 60 * MIN,
      scheduledScansEnabled: false,
    });
    expect(r?.state).toBe("ok");
    expect(r?.value).toBe("switched off");
  });

  it("renders an unknown row when the read failed", () => {
    expect(
      rowFor(metrics({ overdueSchedules: null }), "overdue-schedules")?.state,
    ).toBe("unknown");
  });
});

describe("backup age", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("goes red when the newest backup is older than two scheduled intervals", () => {
    // This is the row that would have surfaced AUDIT-012#obs-02: a scheduled
    // backup that fails on every run while still reporting success.
    const row = rowFor(
      metrics({
        backup: {
          lastBackupAt: new Date(NOW.getTime() - 3 * DAY).toISOString(),
          scheduledEnabled: true,
          intervalMs: DAY,
        },
      }),
      "backup",
    );
    expect(row?.state).toBe("crit");
  });

  it("goes amber after one missed interval", () => {
    const row = rowFor(
      metrics({
        backup: {
          lastBackupAt: new Date(NOW.getTime() - 1.5 * DAY).toISOString(),
          scheduledEnabled: true,
          intervalMs: DAY,
        },
      }),
      "backup",
    );
    expect(row?.state).toBe("warn");
  });

  it("is green inside the configured interval", () => {
    const row = rowFor(
      metrics({
        backup: {
          lastBackupAt: new Date(
            NOW.getTime() - 2 * 60 * 60 * 1000,
          ).toISOString(),
          scheduledEnabled: true,
          intervalMs: DAY,
        },
      }),
      "backup",
    );
    expect(row?.state).toBe("ok");
  });

  it("does not fault an old backup when no schedule promises a cadence", () => {
    const row = rowFor(
      metrics({
        backup: {
          lastBackupAt: new Date(NOW.getTime() - 40 * DAY).toISOString(),
          scheduledEnabled: false,
          intervalMs: DAY,
        },
      }),
      "backup",
    );
    expect(row?.state).toBe("ok");
  });

  it("is red when scheduled backups are on and nothing has ever been written", () => {
    const row = rowFor(
      metrics({
        backup: { lastBackupAt: null, scheduledEnabled: true, intervalMs: DAY },
      }),
      "backup",
    );
    expect(row?.state).toBe("crit");
    expect(row?.value).toBe("never");
  });
});

describe("other checks", () => {
  it("escalates unresolved alerts to red only when one is high or critical", () => {
    expect(
      rowFor(
        metrics({ securityAlerts: { unresolved: 4, unresolvedSevere: 0 } }),
        "security-alerts",
      )?.state,
    ).toBe("warn");
    expect(
      rowFor(
        metrics({ securityAlerts: { unresolved: 4, unresolvedSevere: 1 } }),
        "security-alerts",
      )?.state,
    ).toBe("crit");
  });

  it("says how many alerts are severe in grammatical English", () => {
    const detail = (unresolved: number, unresolvedSevere: number) =>
      rowFor(
        metrics({ securityAlerts: { unresolved, unresolvedSevere } }),
        "security-alerts",
      )?.detail;
    expect(detail(5, 1)).toBe("1 of them is high or critical.");
    expect(detail(5, 2)).toBe("2 of them are high or critical.");
    expect(detail(3, 3)).toBe("All of them are high or critical.");
    expect(detail(1, 1)).toBe("It is high or critical.");
  });

  it("flags staff invites that expired without ever being accepted", () => {
    expect(
      rowFor(
        metrics({ staffInvites: { pending: 2, expired: 0 } }),
        "staff-invites",
      )?.state,
    ).toBe("ok");
    expect(
      rowFor(
        metrics({ staffInvites: { pending: 0, expired: 3 } }),
        "staff-invites",
      )?.state,
    ).toBe("warn");
  });

  it("reports email failures against the day's send volume", () => {
    expect(
      rowFor(
        metrics({ email: { failedLast24h: 0, totalLast24h: 50 } }),
        "email",
      )?.state,
    ).toBe("ok");
    expect(
      rowFor(
        metrics({ email: { failedLast24h: 30, totalLast24h: 50 } }),
        "email",
      )?.state,
    ).toBe("crit");
  });

  it("adds an update row only when an update is actually available", () => {
    expect(buildHealthRows(metrics(), { updateAvailable: false })).toEqual([]);
    const rows = buildHealthRows(metrics(), { updateAvailable: true });
    expect(rows.map((r) => r.key)).toEqual(["updater"]);
    expect(rows[0].tab).toBe("updater");
  });
});

describe("ordering", () => {
  it("puts the worst rows first and keeps insertion order within a state", () => {
    const rows = buildHealthRows(
      metrics({
        scanQueue: {
          pending: 0,
          running: 0,
          oldestPendingAgeMs: null,
          oldestRunningAgeMs: null,
          completedLast24h: 10,
          failedLast24h: 0,
          cancelledLast24h: 0,
          refusedLast24h: 0,
          targetFailedLast24h: 0,
        },
        errorLogs: { lastHour: 3 },
        securityAlerts: { unresolved: 1, unresolvedSevere: 1 },
        supportTickets: { awaitingStaff: 0, open: 0 },
      }),
    );
    expect(rows.map((r) => r.key)).toEqual([
      "security-alerts",
      "error-logs",
      "scan-queue",
      "failed-scans",
      "support-tickets",
    ]);
  });

  it("summarises the list down to a single worst state for the nav dot", () => {
    expect(worstHealthState([])).toBe("ok");
    expect(
      worstHealthState(
        buildHealthRows(metrics({ errorLogs: { lastHour: 1 } })),
      ),
    ).toBe("warn");
    expect(
      worstHealthState(
        buildHealthRows(metrics({ errorLogs: { lastHour: 100 } })),
      ),
    ).toBe("crit");
  });

  it("ranks unknown as worse than ok but better than a real fault", () => {
    expect(worseState("ok", "unknown")).toBe("unknown");
    expect(worseState("unknown", "warn")).toBe("warn");
    expect(worseState("warn", "crit")).toBe("crit");
  });
});
