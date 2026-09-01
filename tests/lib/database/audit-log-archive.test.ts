/**
 * Tests for lib/database/audit-log-archive.ts (AUDIT-010 admin-feature-gap:
 * archive-before-purge for admin_audit_log).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  ensureAuditLogArchiveTable,
  archiveAdminAuditLogBeforePurge,
} from "@/lib/database/audit-log-archive";

function fakeClient(rows: Record<string, unknown>[]) {
  const calls: { sql: string; params: unknown[] | undefined }[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql: sql.trim(), params });
    if (sql.trim().startsWith("SELECT id, admin_id, target_user_id")) {
      return { rows };
    }
    return { rows: [] };
  });
  return { query, calls } as unknown as PoolClient & {
    calls: typeof calls;
  };
}

const sampleRow = {
  id: 1,
  admin_id: 7,
  target_user_id: null,
  action: "reset_password",
  details: null,
  ip_address: "127.0.0.1",
  created_at: "2025-01-01T00:00:00Z",
};

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

describe("archiveAdminAuditLogBeforePurge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects rows older than the cutoff and archives them as one JSONB batch, running no DDL of its own", async () => {
    const client = fakeClient([sampleRow, { ...sampleRow, id: 2 }]);

    const archived = await archiveAdminAuditLogBeforePurge(client, 365);

    expect(archived).toBe(2);
    // instrumentation.ts creates the table at boot (AUDIT-013#schema-02).
    // This helper used to re-run the CREATE TABLE on every cleanup pass,
    // which put DDL inside the long cleanup transaction for nothing.
    expect(client.calls.some((c) => c.sql.includes("CREATE TABLE"))).toBe(
      false,
    );

    const selectCall = client.calls[0];
    expect(selectCall.sql).toContain("FROM admin_audit_log");
    expect(selectCall.sql).toContain("WHERE created_at < NOW()");
    expect(selectCall.params).toEqual([365]);

    const insertCall = client.calls[1];
    expect(insertCall.sql).toContain(
      "INSERT INTO admin_audit_log_archive (retention_days, row_count, rows)",
    );
    expect(insertCall.params?.[0]).toBe(365);
    expect(insertCall.params?.[1]).toBe(2);
    expect(JSON.parse(insertCall.params?.[2] as string)).toEqual([
      sampleRow,
      { ...sampleRow, id: 2 },
    ]);
  });

  it("writes no archive batch at all when there is nothing to archive", async () => {
    const client = fakeClient([]);

    const archived = await archiveAdminAuditLogBeforePurge(client, 365);

    expect(archived).toBe(0);
    expect(client.calls.some((c) => c.sql.startsWith("INSERT INTO"))).toBe(
      false,
    );
  });
});
