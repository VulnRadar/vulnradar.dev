import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { purgeUserScans } from "@/lib/admin/purge-user-scans";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * Admin "Delete All Scans", against the real foreign-key graph.
 *
 * host_reputation.source_scan_id is ON DELETE SET NULL, so a bare DELETE on
 * scan_history does not remove the findings copy that /host/<hostname> serves:
 * it orphans it. The orphan is then unreachable, because every purge path
 * keys on source_scan_id. A mocked pool answers `DELETE FROM scan_history`
 * with "success" whatever the schema says, so only Postgres can say whether
 * anything survives.
 */
async function seedScan(userId: number): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history (user_id, url, status, started_at, scanned_at, scan_type)
     VALUES ($1, $2, 'completed', NOW(), NOW(), 'web')
     RETURNING id`,
    [userId, `https://${unique("purge")}.example.test/`],
  );
  return rows[0].id;
}

async function seedReport(scanId: number): Promise<string> {
  const host = `${unique("purge-host")}.example.test`;
  await pool.query(
    `INSERT INTO host_reputation (host, danger_score, source_scan_id)
     VALUES ($1, 40, $2)`,
    [host, scanId],
  );
  return host;
}

async function reportExists(host: string): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM host_reputation WHERE host = $1",
    [host],
  );
  return rows[0].n === 1;
}

async function scanExists(id: number): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM scan_history WHERE id = $1",
    [id],
  );
  return rows[0].n === 1;
}

describeIntegration("purging every scan a user owns", () => {
  it("leaves no host_reputation row behind, and touches nobody else's", async () => {
    const owner = await createUser();
    const bystander = await createUser();

    const ownerScans = [await seedScan(owner.id), await seedScan(owner.id)];
    const ownerReports = [
      await seedReport(ownerScans[0]),
      await seedReport(ownerScans[1]),
    ];
    // A scan that never produced a report, to prove the counts are separate.
    ownerScans.push(await seedScan(owner.id));

    const bystanderScan = await seedScan(bystander.id);
    const bystanderReport = await seedReport(bystanderScan);

    const result = await purgeUserScans(owner.id);

    expect(result).toEqual({ scans: 3, hostReports: 2 });
    for (const id of ownerScans) expect(await scanExists(id)).toBe(false);
    // The bug: these survived with source_scan_id NULL and kept serving.
    for (const host of ownerReports)
      expect(await reportExists(host)).toBe(false);

    expect(await scanExists(bystanderScan)).toBe(true);
    expect(await reportExists(bystanderReport)).toBe(true);

    await pool.query("DELETE FROM host_reputation WHERE host = $1", [
      bystanderReport,
    ]);
    await pool.query("DELETE FROM scan_history WHERE id = $1", [bystanderScan]);
  });

  it("is a no-op for a user with no scans", async () => {
    const user = await createUser();
    expect(await purgeUserScans(user.id)).toEqual({ scans: 0, hostReports: 0 });
  });

  it("does not take a report that another user's later scan now sources", async () => {
    // host_reputation is keyed by host, so a newer scan of the same host by a
    // different account takes over source_scan_id. Deleting the first
    // account's scans must not remove the report the second now owns.
    const first = await createUser();
    const second = await createUser();
    const firstScan = await seedScan(first.id);
    const host = await seedReport(firstScan);
    const secondScan = await seedScan(second.id);
    await pool.query(
      "UPDATE host_reputation SET source_scan_id = $2 WHERE host = $1",
      [host, secondScan],
    );

    const result = await purgeUserScans(first.id);

    expect(result).toEqual({ scans: 1, hostReports: 0 });
    expect(await reportExists(host)).toBe(true);

    await pool.query("DELETE FROM host_reputation WHERE host = $1", [host]);
    await pool.query("DELETE FROM scan_history WHERE id = $1", [secondScan]);
  });
});
