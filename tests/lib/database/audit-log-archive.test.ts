/**
 * Tests for lib/database/audit-log-archive.ts (AUDIT-010 admin-feature-gap:
 * archive-before-purge for admin_audit_log).
 */
import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  ensureAuditLogArchiveTable,
  purgeExpiredAdminAuditLog,
} from "@/lib/database/audit-log-archive";

function fakeClient(rows: Record<string, unknown>[]) {
  const calls: { sql: string; params: unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql: sql.trim(), params });
    return { rows };
  });
  return { query, calls } as unknown as PoolClient & {
    calls: typeof calls;
  };
}

describe("ensureAuditLogArchiveTable", () => {
  it("issues an idempotent CREATE TABLE IF NOT EXISTS with an index on purged_at", async () => {
    const client = fakeClient([]);
    await ensureAuditLogArchiveTable(client);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].sql).toContain(
      "CREATE TABLE IF NOT EXISTS admin_audit_log_archive",
    );
    expect(client.calls[0].sql).toContain("CREATE INDEX IF NOT EXISTS");
    expect(client.calls[0].sql).toContain("purged_at");
  });
});

describe("purgeExpiredAdminAuditLog", () => {
  it("deletes and archives in one statement, the batch built from what the delete returned", async () => {
    const client = fakeClient([{ row_count: 3 }]);

    const purged = await purgeExpiredAdminAuditLog(client, 365);

    expect(purged).toBe(3);
    // One statement is the whole fix: a SELECT ahead of the DELETE is what let
    // two overlapping passes archive the same rows.
    expect(client.calls).toHaveLength(1);
    const { sql, params } = client.calls[0];
    expect(sql).toMatch(/^WITH purged AS \(\s*DELETE FROM admin_audit_log/);
    expect(sql).toContain("RETURNING *");
    expect(sql).toContain(
      "INSERT INTO admin_audit_log_archive (retention_days, row_count, rows)",
    );
    expect(sql).toMatch(/FROM purged\s+HAVING count\(\*\) > 0/);
    expect(sql).not.toContain("CREATE TABLE");
    expect(params).toEqual([365]);
  });

  it("reports zero when nothing expired and the statement inserted no batch", async () => {
    const client = fakeClient([]);
    await expect(purgeExpiredAdminAuditLog(client, 365)).resolves.toBe(0);
  });
});
