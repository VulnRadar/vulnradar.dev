import { beforeEach, expect, it, vi } from "vitest";
import pool from "@/lib/database/db";
import { createTeam, createUser, describeIntegration, unique } from "./_db";

/**
 * Which webhooks a finished scan fires.
 *
 * The team clause is SQL and only Postgres can say what it matches: a faked
 * pool answers the old statement and the new one identically. Three things
 * have to hold against the real schema. A scan shared through the
 * scan_history_teams join table fires that team's webhooks, not only a scan
 * whose single team_id column points there. A webhook whose creator has left
 * the team stops firing for that team's scans, because the creator's endpoint
 * would otherwise go on receiving a team's results after they left it. And
 * the creator's own scans keep reaching their own webhook regardless.
 */
const mockDeliverWebhook = vi.fn();
vi.mock("@/lib/webhooks/delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/webhooks/delivery")>()),
  deliverWebhook: (...args: unknown[]) => mockDeliverWebhook(...args),
}));

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => undefined),
}));

const { notifyScanComplete } =
  await import("@/lib/webhooks/scan-notifications");

const SUMMARY = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };

async function addMember(teamId: number, userId: number): Promise<void> {
  await pool.query(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'member')`,
    [teamId, userId],
  );
}

async function createWebhook(
  userId: number,
  teamId: number | null,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO webhooks (user_id, team_id, url, name, type)
     VALUES ($1, $2, $3, 'hook', 'generic')
     RETURNING id`,
    [userId, teamId, `https://${unique("hook")}.example.test/in`],
  );
  return rows[0].id;
}

async function createScan(
  userId: number,
  teamId: number | null,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history (user_id, team_id, url, status, started_at, scanned_at, scan_type)
     VALUES ($1, $2, $3, 'completed', NOW(), NOW(), 'web')
     RETURNING id`,
    [userId, teamId, `https://${unique("scan")}.example.test/`],
  );
  return rows[0].id;
}

async function firedFor(userId: number, scanId: number): Promise<number[]> {
  mockDeliverWebhook.mockClear();
  await notifyScanComplete({
    userId,
    scanId,
    target: { kind: "url", value: "https://scan.example.test/" },
    summary: SUMMARY,
    findings: [],
    duration: 10,
    scannedAt: new Date().toISOString(),
    silenceRoutineEmail: true,
  });
  return mockDeliverWebhook.mock.calls
    .map(([target]) => (target as { id: number }).id)
    .sort((a, b) => a - b);
}

describeIntegration("which webhooks a finished scan fires", () => {
  beforeEach(() => {
    mockDeliverWebhook.mockReset();
    mockDeliverWebhook.mockResolvedValue(undefined);
  });

  it("fires a member's team webhook for a scan on the team_id column", async () => {
    const owner = await createUser();
    const scanner = await createUser();
    const teamId = await createTeam(owner.id);
    await addMember(teamId, owner.id);
    await addMember(teamId, scanner.id);
    const hook = await createWebhook(owner.id, teamId);
    const scanId = await createScan(scanner.id, teamId);

    expect(await firedFor(scanner.id, scanId)).toEqual([hook]);
  });

  it("fires for a scan shared only through the join table", async () => {
    const owner = await createUser();
    const scanner = await createUser();
    const teamA = await createTeam(owner.id);
    const teamB = await createTeam(owner.id);
    await addMember(teamA, owner.id);
    await addMember(teamB, owner.id);
    const hookA = await createWebhook(owner.id, teamA);
    const hookB = await createWebhook(owner.id, teamB);
    const scanId = await createScan(scanner.id, teamA);
    await pool.query(
      `INSERT INTO scan_history_teams (scan_id, team_id) VALUES ($1, $2)`,
      [scanId, teamB],
    );

    expect(await firedFor(scanner.id, scanId)).toEqual(
      [hookA, hookB].sort((a, b) => a - b),
    );
  });

  it("stops once the webhook's creator has left the team", async () => {
    const creator = await createUser();
    const scanner = await createUser();
    const teamId = await createTeam(scanner.id);
    await addMember(teamId, creator.id);
    await addMember(teamId, scanner.id);
    const hook = await createWebhook(creator.id, teamId);
    const scanId = await createScan(scanner.id, teamId);

    expect(await firedFor(scanner.id, scanId)).toEqual([hook]);

    await pool.query(
      `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, creator.id],
    );

    expect(await firedFor(scanner.id, scanId)).toEqual([]);
  });

  it("keeps a departed creator's own scans reaching their own webhook", async () => {
    const creator = await createUser();
    const teamId = await createTeam((await createUser()).id);
    const hook = await createWebhook(creator.id, teamId);
    const scanId = await createScan(creator.id, null);

    expect(await firedFor(creator.id, scanId)).toEqual([hook]);
  });

  it("fires once for a webhook that matches both clauses", async () => {
    const creator = await createUser();
    const teamId = await createTeam(creator.id);
    await addMember(teamId, creator.id);
    const hook = await createWebhook(creator.id, teamId);
    const scanId = await createScan(creator.id, teamId);

    expect(await firedFor(creator.id, scanId)).toEqual([hook]);
  });

  it("does not fire another team's webhook for a personal scan", async () => {
    const creator = await createUser();
    const scanner = await createUser();
    const teamId = await createTeam(creator.id);
    await addMember(teamId, creator.id);
    await createWebhook(creator.id, teamId);
    const scanId = await createScan(scanner.id, null);

    expect(await firedFor(scanner.id, scanId)).toEqual([]);
  });

  it("carries the public id of the scan, and a paused webhook stays quiet", async () => {
    const creator = await createUser();
    const hook = await createWebhook(creator.id, null);
    const scanId = await createScan(creator.id, null);
    const { rows } = await pool.query<{ public_id: string }>(
      `SELECT public_id FROM scan_history WHERE id = $1`,
      [scanId],
    );

    await firedFor(creator.id, scanId);
    const body = JSON.parse(mockDeliverWebhook.mock.calls[0][2] as string);
    expect(body.scan_public_id).toBe(rows[0].public_id);

    await pool.query(`UPDATE webhooks SET active = false WHERE id = $1`, [
      hook,
    ]);
    expect(await firedFor(creator.id, scanId)).toEqual([]);
  });
});
