import { it, expect, vi, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, type TestUser } from "./_db";

/**
 * The Security Alerts panel's unresolved view, judged by Postgres.
 *
 * bug-ui-admin-6: the panel fetched the newest 100 alerts of every kind and
 * dropped the resolved ones itself. An unresolved alert with 100 or more
 * resolved ones written after it never reached the browser, and the header
 * read "All clear" over it. The fix is a resolved_at IS NULL filter in the
 * list query and a separate unresolved count, both SQL, so they are proven
 * here with the exact shape that hid it: one old unresolved alert under 120
 * newer resolved ones.
 *
 * Scoped to one user with the list's user_id filter, because the table is
 * shared with every other suite.
 */
let sessionUserId = 0;

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () => ({
      userId: sessionUserId,
      email: "admin@example.test",
      name: null,
      tosAcceptedAt: null,
      role: "admin",
    }),
  };
});

vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return { ...actual, getClientIp: async () => "127.0.0.1" };
});

const { POST } = await import("@/app/api/v3/admin/features/route");

async function list(body: Record<string, unknown>) {
  const res = await POST(
    new NextRequest("http://localhost/api/v3/admin/features", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        section: "security_alerts",
        action: "list",
        ...body,
      }),
    }),
  );
  expect(res.status).toBe(200);
  return res.json();
}

describeIntegration("the unresolved security alerts view", () => {
  let admin: TestUser;
  let subject: TestUser;
  let unresolvedId: number;

  beforeAll(async () => {
    admin = await createUser({ role: "admin" });
    sessionUserId = admin.id;
    subject = await createUser();

    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO security_alerts (user_id, alert_type, severity, description, created_at)
       VALUES ($1, 'brute_force', 'critical', 'The one still open', NOW() - INTERVAL '1 day')
       RETURNING id`,
      [subject.id],
    );
    unresolvedId = rows[0].id;
    await pool.query(
      `INSERT INTO security_alerts
         (user_id, alert_type, severity, description, created_at, resolved_at, resolved_by, action_taken)
       SELECT $1::int, 'new_device_login', 'low', 'Handled', NOW() - make_interval(secs => g), NOW(), $2::int, 'manual_review'
         FROM generate_series(1, 120) AS g`,
      [subject.id, admin.id],
    );
  });

  it("returns the unresolved alert that 120 newer resolved ones used to push off the page", async () => {
    const data = await list({
      unresolved_only: true,
      user_id: subject.id,
      limit: 100,
    });
    expect(data.alerts.map((a: { id: number }) => a.id)).toEqual([
      unresolvedId,
    ]);
    expect(data.hasMore).toBe(false);
    expect(data.unresolved).toEqual({
      total: 1,
      critical: 1,
      high: 0,
      medium: 0,
      low: 0,
    });
  });

  it("is the filter doing it: the unfiltered newest 100 still miss it", async () => {
    const data = await list({ user_id: subject.id, limit: 100 });
    expect(data.alerts).toHaveLength(100);
    expect(data.alerts.some((a: { id: number }) => a.id === unresolvedId)).toBe(
      false,
    );
    expect(data.hasMore).toBe(true);
    // The header count does not depend on what the page happened to hold.
    expect(data.unresolved.total).toBe(1);
  });

  it("reaches it with Load more when resolved alerts are shown", async () => {
    const data = await list({ user_id: subject.id, limit: 100, offset: 100 });
    expect(data.alerts.map((a: { id: number }) => a.id)).toContain(
      unresolvedId,
    );
    expect(data.hasMore).toBe(false);
  });
});
