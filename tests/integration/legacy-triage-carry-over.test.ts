import { it, expect, afterAll, beforeEach } from "vitest";
import pool from "@/lib/database/db";
import { carryOverLegacyTriage } from "@/lib/database/boot/backfills";
import { generateId, legacyFindingId } from "@/lib/scanner/_helpers";
import { AI_FEEDBACK_NOTE } from "@/lib/scanner/feedback-source";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The carry-over of triage to the new finding ids runs once per database.
 *
 * It ran at every boot, and it keeps the legacy rows on purpose, so it undid
 * people's triage: setting a finding back to open deletes its remediation row
 * under the new key (app/api/v3/scan/remediation/route.ts), and the next
 * restart copied the legacy accepted_risk row back over it. Whether that
 * happens is decided by an ON CONFLICT, a DELETE and a row in
 * vulnradar_schema_meta, none of which a faked pool can answer for.
 */

const seededUsers: number[] = [];

async function seedUser(): Promise<number> {
  const user = await createUser();
  seededUsers.push(user.id);
  return user.id;
}

function bareUrl(prefix: string): string {
  return `https://${unique(prefix).replace(/[^a-z0-9]/g, "")}.example.test`;
}

async function remediationStatus(
  userId: number,
  findingId: string,
  findingUrl: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM finding_remediation
      WHERE user_id = $1 AND finding_id = $2 AND finding_url = $3`,
    [userId, findingId, findingUrl],
  );
  return rows[0]?.status ?? null;
}

describeIntegration("the legacy triage carry-over runs once", () => {
  beforeEach(async () => {
    // register() in the global setup has already recorded a pass on this
    // database. Each case starts from a database that has not had one.
    await pool.query(
      "UPDATE vulnradar_schema_meta SET legacy_triage_done_at = NULL WHERE id = 1",
    );
  });

  afterAll(async () => {
    if (seededUsers.length === 0) return;
    await pool.query(
      "DELETE FROM scan_finding_feedback WHERE user_id = ANY($1::int[])",
      [seededUsers],
    );
    await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [
      seededUsers,
    ]);
  });

  it("does not bring back a status the person reopened, however many restarts follow", async () => {
    const userId = await seedUser();
    const bare = bareUrl("reopen");
    const oldId = legacyFindingId("csp-missing", bare);
    const newId = generateId("csp-missing", bare);
    await pool.query(
      `INSERT INTO finding_remediation (user_id, finding_id, finding_url, status)
       VALUES ($1, $2, $3, 'accepted_risk')`,
      [userId, oldId, bare],
    );

    await carryOverLegacyTriage(pool, "App");
    expect(await remediationStatus(userId, newId, `${bare}/`)).toBe(
      "accepted_risk",
    );

    // What POST /scan/remediation does with status "open".
    await pool.query(
      `DELETE FROM finding_remediation
        WHERE user_id = $1 AND finding_id = $2 AND finding_url = $3`,
      [userId, newId, `${bare}/`],
    );

    await carryOverLegacyTriage(pool, "App");
    await carryOverLegacyTriage(pool, "App");

    expect(await remediationStatus(userId, newId, `${bare}/`)).toBeNull();
    // The legacy row stays: scans that already ran still carry the old id.
    expect(await remediationStatus(userId, oldId, bare)).toBe("accepted_risk");
    const { rows } = await pool.query<{ done: boolean }>(
      `SELECT legacy_triage_done_at IS NOT NULL AS done
         FROM vulnradar_schema_meta WHERE id = 1`,
    );
    expect(rows[0].done).toBe(true);
  });

  it("copies an AI suggestion as an AI suggestion, with what the verifier said", async () => {
    const userId = await seedUser();
    const bare = bareUrl("aicopy");
    const oldId = legacyFindingId("csp-missing", bare);
    const newId = generateId("csp-missing", bare);
    await pool.query(
      `INSERT INTO scan_finding_feedback
         (user_id, finding_id, finding_url, verdict, notes, source, ai_reason, ai_probe_status)
       VALUES ($1, $2, $3, 'false_positive', $4, 'ai', 'Header set by the CDN.', 'probed')`,
      [userId, oldId, bare, AI_FEEDBACK_NOTE],
    );

    await carryOverLegacyTriage(pool, "App");

    const { rows } = await pool.query<{
      source: string;
      ai_reason: string | null;
      ai_probe_status: string | null;
    }>(
      `SELECT source, ai_reason, ai_probe_status FROM scan_finding_feedback
        WHERE user_id = $1 AND finding_id = $2 AND finding_url = $3`,
      [userId, newId, `${bare}/`],
    );
    // Without source the copy fell to the column default, 'human', and an AI
    // guess became a verdict that hides the finding.
    expect(rows).toEqual([
      {
        source: "ai",
        ai_reason: "Header set by the CDN.",
        ai_probe_status: "probed",
      },
    ]);
  });
});
