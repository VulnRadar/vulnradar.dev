import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Pool } from "pg";

/**
 * runBootBackfills' order, with every phase stubbed (tests-7).
 *
 * The order is load-bearing: the super_admin bootstrap has to run before the
 * staff-plan reconciliation (which grants the plan the new role carries), and
 * everything has to run after the schema. The helper-module phases are
 * mocked to record themselves; the phases that run their own SQL are
 * recognised by the statement they send, on the boot's own connection.
 */

const order: string[] = [];

vi.mock("@/lib/auth/security-migration", () => ({
  migratePlaintextSecretsToEncrypted: async () => {
    order.push("encrypted-secrets");
  },
}));
vi.mock("@/lib/uploads/avatar-migration", () => ({
  migrateBase64AvatarsToDatabase: async () => {
    order.push("avatars-base64");
  },
  migrateAvatarFilesToDatabase: async () => {
    order.push("avatars-files");
  },
}));
vi.mock("@/lib/billing/staff-plan", () => ({
  syncPlanForRoleChange: async () => {
    order.push("sync-plan");
  },
  reconcileStaffPlans: async () => {
    order.push("reconcile-staff-plans");
    return 0;
  },
}));
vi.mock("@/lib/webhooks/secret", () => ({
  migratePlaintextWebhookSecrets: async () => {
    order.push("webhook-secrets");
  },
}));

const { runBootBackfills, backfillAiFeedbackSource } =
  await import("@/lib/database/boot/backfills");
const { DEFAULT_BADGES_SQL } = await import("@/lib/database/schema/seeds.mjs");
const { AI_FEEDBACK_NOTE } = await import("@/lib/scanner/feedback-source");

const SQL_PHASES: Array<[string, (sql: string) => boolean]> = [
  ["super-admin", (sql) => sql.includes("WHERE role = 'super_admin'")],
  ["badges", (sql) => sql === DEFAULT_BADGES_SQL],
  ["sub-daily-schedules", (sql) => sql.includes("FROM scheduled_scans")],
  ["scan-urls", (sql) => sql.includes("FROM scan_history")],
  ["audit-redaction", (sql) => sql.includes("UPDATE admin_audit_log")],
  ["feedback-source", (sql) => sql.includes("UPDATE scan_finding_feedback")],
  ["finding-id-remap", (sql) => sql.includes("FROM finding_remediation")],
];

/** The phases that walk whole tables, which the boot connection runs. */
const TABLE_PHASES = [
  "sub-daily-schedules",
  "scan-urls",
  "audit-redaction",
  "feedback-source",
  "finding-id-remap",
];

function bootPool() {
  const release = vi.fn();
  const onClient: string[] = [];
  const record = (text: string, where: "pool" | "client") => {
    const phase = SQL_PHASES.find(([, test]) => test(text));
    if (phase && order.at(-1) !== phase[0]) order.push(phase[0]);
    if (phase && where === "client" && onClient.at(-1) !== phase[0]) {
      onClient.push(phase[0]);
    }
    return { rows: [], rowCount: 0 };
  };
  const clientQuery = vi.fn(async (config: { text: string }) =>
    record(config.text, "client"),
  );
  const pool = {
    query: vi.fn(async (text: string) => record(text, "pool")),
    connect: vi.fn(async () => ({ query: clientQuery, release })),
  } as unknown as Pool;
  return { pool, release, onClient };
}

beforeEach(() => {
  order.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runBootBackfills", () => {
  it("runs every phase once, in order, and the table walks on the boot connection", async () => {
    const { pool, release, onClient } = bootPool();
    await runBootBackfills(pool, "App");
    expect(order).toEqual([
      "encrypted-secrets",
      "avatars-base64",
      "avatars-files",
      "super-admin",
      "reconcile-staff-plans",
      "badges",
      "webhook-secrets",
      "sub-daily-schedules",
      "scan-urls",
      "audit-redaction",
      "feedback-source",
      "finding-id-remap",
    ]);
    expect(onClient).toEqual(TABLE_PHASES);
    expect(release).toHaveBeenCalledWith(true);
  });

  it("keeps going when a phase fails", async () => {
    const { pool } = bootPool();
    (pool.query as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (text: string) => {
        if (text === DEFAULT_BADGES_SQL) throw new Error("badges broke");
        return { rows: [], rowCount: 0 };
      },
    );
    await expect(runBootBackfills(pool, "App")).resolves.toBeUndefined();
    expect(order).toContain("feedback-source");
  });

  it("finishes the boot when the boot connection cannot be opened", async () => {
    const { pool } = bootPool();
    (pool.connect as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("timeout exceeded when trying to connect"),
    );
    await expect(runBootBackfills(pool, "App")).resolves.toBeUndefined();
    expect(order).toContain("webhook-secrets");
    expect(order).not.toContain("scan-urls");
  });
});

describe("backfillAiFeedbackSource", () => {
  it("marks only rows carrying the verifier's exact note, and only once", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({
      rows: [],
      rowCount: 0,
    }));
    await backfillAiFeedbackSource({ query } as unknown as Pool);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("SET source = 'ai'");
    expect(sql).toContain("WHERE notes = $1");
    // A boot with nothing to fix rewrites no row.
    expect(sql).toContain("source IS DISTINCT FROM 'ai'");
    expect(params).toEqual([AI_FEEDBACK_NOTE]);
    expect(AI_FEEDBACK_NOTE).toBe(
      "Set automatically from an AI verify verdict.",
    );
  });

  it("does not throw when the column is not there yet, so a boot is never stopped", async () => {
    const query = vi.fn(async () => {
      throw new Error('column "source" does not exist');
    });
    await expect(
      backfillAiFeedbackSource({ query } as unknown as Pool),
    ).resolves.toBeUndefined();
  });
});
