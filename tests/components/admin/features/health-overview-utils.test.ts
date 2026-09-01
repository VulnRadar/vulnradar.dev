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
  worstHealthState,
  worseState,
  type HealthMetrics,
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
