import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";
import { deleteUserAccountData } from "@/lib/auth/account-deletion";

/**
 * Direct tests for the shared deletion sequence app/api/v3/admin/route.ts's
 * delete_account handler and app/api/v3/account/delete/route.ts both call --
 * see that module's own doc comment for why this used to be two
 * independently-maintained lists. These tests exercise the function in
 * isolation, against a fake PoolClient, so both routes' own tests only need
 * to confirm they call it and handle the transaction around it.
 */
describe("deleteUserAccountData", () => {
  const mockQuery = vi.fn();
  const fakeClient = { query: mockQuery } as unknown as PoolClient;

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it("deletes the user row last, after every other statement", async () => {
    await deleteUserAccountData(fakeClient, 11);
    const calls = mockQuery.mock.calls;
    const [lastSql, lastParams] = calls[calls.length - 1];
    expect(lastSql).toBe("DELETE FROM users WHERE id = $1");
    expect(lastParams).toEqual([11]);
  });

  it("touches every table a real account can have data in", async () => {
    await deleteUserAccountData(fakeClient, 11);
    const sqls = mockQuery.mock.calls.map(([sql]) => sql as string);

    const expectedTables = [
      "sessions",
      "password_reset_tokens",
      "email_verification_tokens",
      "email_2fa_codes",
      "device_trust",
      "api_usage",
      "api_keys",
      "scan_tags",
      "scheduled_scans",
      "scan_history",
      "webhooks",
      "discord_connections",
      "billing_history",
      "gifted_subscriptions",
      "team_members",
      "team_invites",
      "teams",
      "notification_preferences",
      "security_alerts",
      "staff_activity",
      "data_requests",
      "user_badges",
      "admin_user_notes",
      "admin_audit_log",
      "broadcast_recipients",
    ];
    for (const table of expectedTables) {
      expect(
        sqls.some((sql) => sql.includes(table)),
        `expected a statement referencing "${table}"`,
      ).toBe(true);
    }
  });

  it("de-identifies admin_audit_log entries targeting this user instead of deleting them", async () => {
    // The privacy policy's Data Retention section documents this exact
    // behavior: the audit log is a permanent accountability record, so a
    // deleted account's entries lose the link back to them (target_user_id
    // -> NULL) rather than disappearing outright.
    await deleteUserAccountData(fakeClient, 11);
    const call = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes("admin_audit_log"),
    );
    expect(call?.[0]).toMatch(/^UPDATE admin_audit_log SET target_user_id/);
    expect(call?.[0]).not.toMatch(/^DELETE/);
    expect(call?.[1]).toEqual([11]);
  });

  it("nulls security_alerts.resolved_by and system_settings.updated_by before deleting the user, not via CASCADE", async () => {
    await deleteUserAccountData(fakeClient, 11);
    const calls = mockQuery.mock.calls;
    const nullResolvedByIndex = calls.findIndex(
      ([sql]) =>
        sql ===
        "UPDATE security_alerts SET resolved_by = NULL WHERE resolved_by = $1",
    );
    const nullUpdatedByIndex = calls.findIndex(
      ([sql]) =>
        sql ===
        "UPDATE system_settings SET updated_by = NULL WHERE updated_by = $1",
    );
    const deleteUsersIndex = calls.findIndex(
      ([sql]) => sql === "DELETE FROM users WHERE id = $1",
    );
    expect(nullResolvedByIndex).toBeGreaterThanOrEqual(0);
    expect(nullUpdatedByIndex).toBeGreaterThanOrEqual(0);
    expect(calls[nullResolvedByIndex][1]).toEqual([11]);
    expect(calls[nullUpdatedByIndex][1]).toEqual([11]);
    expect(nullResolvedByIndex).toBeLessThan(deleteUsersIndex);
    expect(nullUpdatedByIndex).toBeLessThan(deleteUsersIndex);
  });

  it("does not touch broadcast_messages.created_by directly -- that FK is schema-level ON DELETE SET NULL now, not application-nulled", async () => {
    await deleteUserAccountData(fakeClient, 11);
    const sqls = mockQuery.mock.calls.map(([sql]) => sql as string);
    expect(sqls.some((sql) => sql.includes("broadcast_messages"))).toBe(false);
  });

  it("scopes every statement to the given userId", async () => {
    await deleteUserAccountData(fakeClient, 42);
    for (const [, params] of mockQuery.mock.calls) {
      expect(params).toEqual([42]);
    }
  });

  it("propagates a mid-sequence query failure instead of swallowing it", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockRejectedValueOnce(new Error("still connected"));
    await expect(deleteUserAccountData(fakeClient, 11)).rejects.toThrow(
      "still connected",
    );
  });
});
