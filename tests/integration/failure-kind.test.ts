import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { SCHEMA_STEPS } from "@/lib/database/schema/index.mjs";
import { finalizeScanFailure } from "@/lib/scanner/scan-jobs";
import { describeIntegration, createUser } from "./_db";

/**
 * scan_history.failure_kind on a real database: the boot backfill that
 * classifies rows written before the column existed, the CHECK that keeps the
 * column to FAILURE_KINDS, and finalizeScanFailure writing it.
 *
 * The backfill is a CASE over LIKE patterns and a regex, run as an UPDATE
 * with a WHERE that must leave classified rows alone. A faked pool would
 * answer it however the test told it to, which proves nothing about which
 * branch PostgreSQL actually takes for each sentence (tests/README.md, "Two
 * tiers, two rules"). The sentences below are the exact ones the pipeline
 * writes.
 */
const backfillSql = String(
  SCHEMA_STEPS.find(
    (s: { id: string }) => s.id === "scan-history-failure-kind-backfill",
  )?.sql,
);

async function insertScan(
  userId: number,
  status: string,
  errorMessage: string | null,
  failureKind: string | null = null,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history (user_id, url, status, error_message, failure_kind, started_at)
     VALUES ($1, 'https://example.test/', $2, $3, $4, NOW())
     RETURNING id`,
    [userId, status, errorMessage, failureKind],
  );
  return rows[0].id;
}

async function kindOf(scanId: number): Promise<string | null> {
  const { rows } = await pool.query<{ failure_kind: string | null }>(
    "SELECT failure_kind FROM scan_history WHERE id = $1",
    [scanId],
  );
  return rows[0].failure_kind;
}

describeIntegration("scan_history.failure_kind", () => {
  it("classifies every sentence the pipeline writes", async () => {
    expect(backfillSql).toContain("UPDATE scan_history");
    const user = await createUser();
    const cases: Array<[string, string]> = [
      ["Cancelled", "cancelled"],
      [
        "Scan interrupted by a server restart. Please run it again.",
        "interrupted",
      ],
      ["API key daily limit reached mid-batch.", "quota_refused"],
      [
        "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.",
        "quota_refused",
      ],
      [
        "Bulk scan batch exceeded its 600s time limit before this URL ran.",
        "not_run",
      ],
      [
        "The bulk scan batch this URL belonged to stopped before it ran.",
        "not_run",
      ],
      ["Scan exceeded the 300s time limit.", "timeout"],
      ["Crawl scan exceeded the 900s time limit.", "timeout"],
      [
        "Could not reach the target URL: fetch failed. The site may be down, blocking automated requests, or not publicly accessible.",
        "target_unreachable",
      ],
      ['relation "scan_history" does not exist', "internal"],
      ["An unexpected error occurred during the scan.", "internal"],
    ];
    const ids: Array<[number, string, string]> = [];
    for (const [message, kind] of cases) {
      ids.push([await insertScan(user.id, "failed", message), message, kind]);
    }
    // A failed row with no message at all still gets a kind.
    const silent = await insertScan(user.id, "failed", null);

    await pool.query(backfillSql);

    for (const [id, message, kind] of ids) {
      expect(await kindOf(id), message).toBe(kind);
    }
    expect(await kindOf(silent)).toBe("internal");
  });

  it("leaves rows that are not failed, or already classified, alone", async () => {
    const user = await createUser();
    const completed = await insertScan(user.id, "completed", null);
    const running = await insertScan(user.id, "running", null);
    // Already says cancelled; the text would classify it as internal.
    const classified = await insertScan(
      user.id,
      "failed",
      "something unrecognisable",
      "cancelled",
    );

    await pool.query(backfillSql);
    // Idempotent: a second boot changes nothing.
    await pool.query(backfillSql);

    expect(await kindOf(completed)).toBeNull();
    expect(await kindOf(running)).toBeNull();
    expect(await kindOf(classified)).toBe("cancelled");
  });

  it("refuses a kind that is not in FAILURE_KINDS", async () => {
    const user = await createUser();
    await expect(
      insertScan(user.id, "failed", "x", "server_on_fire"),
    ).rejects.toThrow(/failure_kind/);
  });

  it("is written by finalizeScanFailure, defaulting to internal", async () => {
    const user = await createUser();
    const plain = await insertScan(user.id, "running", null);
    const cancelled = await insertScan(user.id, "running", null);

    expect(await finalizeScanFailure(plain, "boom")).toBe(true);
    expect(await finalizeScanFailure(cancelled, "Cancelled", "cancelled")).toBe(
      true,
    );

    expect(await kindOf(plain)).toBe("internal");
    expect(await kindOf(cancelled)).toBe("cancelled");
  });

  it("serves the failed-scan read from its partial index", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE indexname = 'idx_scan_history_failed_scanned'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/WHERE.*status.*'failed'/);
  });
});
