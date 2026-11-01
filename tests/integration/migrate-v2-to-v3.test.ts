import { it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { Client, Pool } from "pg";
import { describeIntegration } from "./_db";

/**
 * The 2.0.0 -> 3.0.0 upgrade, executed for real against a database built from
 * the frozen v2.0.0 snapshot.
 *
 * gap-migration-upgrade-path-1: the scan_history_teams backfill sat inside the
 * addTables SQL and read scan_history.team_id, which only addColumns creates,
 * and addTables always runs first. runPlan wraps the plan in one transaction,
 * so that one statement rolled back every v1 and v2 upgrade. The unit tier
 * reads this file's SQL as text and never ran it, which is how a plan that
 * could not succeed on any database passed every test.
 *
 * The rest of this tier runs against the schema the boot path built, which is
 * already v3. An upgrade needs a database that starts at v2, so this suite
 * creates its own scratch database next to the tier's one, replays the
 * snapshot into it the way `npm run db:create` does, runs the plan and drops
 * the database again.
 */

const { FROZEN_SNAPSHOTS, readSchemaStatements } =
  await import("@/scripts/_lib/_lib.schema-parity.mjs");
const { buildPlan } = await import("@/scripts/migrate/_planner.mjs");
const { runPlan } = await import("@/scripts/migrate/_runner.mjs");
const { fingerprintDetect } = await import("@/scripts/migrate/_detect.mjs");
const { getActualSchema } = await import("@/scripts/_lib/_lib.schema.mjs");

interface PlanStep {
  kind: string;
  sql: string;
  label: string;
}

const BACKFILL_LABEL =
  /^Backfill scan_history_teams from scan_history\.team_id/;

const ssl =
  process.env.INTEGRATION_DATABASE_SSL === "true"
    ? { rejectUnauthorized: true }
    : false;

let adminClient: Client | null = null;
let scratchName = "";
let scratch: Pool | null = null;
let userId = 0;
let teamId = 0;
let scanId = 0;
let replayErrors: string[] = [];
let versionBefore: string | null = null;
let plan: { steps: PlanStep[] };
let result: { executed: number; failed: number };

function db(): Pool {
  if (!scratch) throw new Error("the scratch database was never created");
  return scratch;
}

/**
 * Replays the snapshot exactly as scripts/create-fresh-db/create-fresh-db.mjs
 * does: bare SELECTs skipped (the snapshot's boot-time checks, not schema),
 * "already exists" tolerated (the snapshot creates a few objects twice).
 * Anything else is collected rather than warned, so a snapshot that stopped
 * replaying cleanly fails here by name instead of as a confusing upgrade error.
 */
async function buildFromV2Snapshot(pool: Pool): Promise<string[]> {
  const statements: string[] = readSchemaStatements(FROZEN_SNAPSHOTS["2.0.0"]);
  const errors: string[] = [];
  for (const stmt of statements.filter((s) => !/^\s*SELECT\b/i.test(s))) {
    try {
      await pool.query(stmt);
    } catch (err) {
      const message = (err as Error).message;
      if (!message.includes("already exists")) errors.push(message);
    }
  }
  return errors;
}

describeIntegration(
  "2.0.0 -> 3.0.0 upgrade against a real v2.0.0 database",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.INTEGRATION_DATABASE_URL as string);
      const base =
        decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
      scratchName = `${base}_migrate_v2_${randomBytes(4).toString("hex")}`;

      adminClient = new Client({ connectionString: url.toString(), ssl });
      await adminClient.connect();
      // The name is ours (a fixed prefix plus hex), but it is still an
      // identifier in DDL, so it is quoted rather than trusted.
      await adminClient.query(`CREATE DATABASE "${scratchName}"`);

      url.pathname = `/${scratchName}`;
      scratch = new Pool({ connectionString: url.toString(), ssl, max: 2 });

      replayErrors = await buildFromV2Snapshot(db());
      versionBefore = fingerprintDetect(await getActualSchema(db())).version;

      // A user, a team they own and a scan of theirs: the rows a real v2
      // install has, written with only the columns v2.0.0 has.
      const user = await db().query<{ id: number }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, 'not-a-real-hash') RETURNING id`,
        [`migrate-v2-${randomBytes(4).toString("hex")}@example.test`],
      );
      userId = user.rows[0].id;
      const team = await db().query<{ id: number }>(
        `INSERT INTO teams (name, slug, owner_id) VALUES ('Upgrade Team', $1, $2) RETURNING id`,
        [`upgrade-${randomBytes(4).toString("hex")}`, userId],
      );
      teamId = team.rows[0].id;
      const scan = await db().query<{ id: number }>(
        `INSERT INTO scan_history (user_id, url) VALUES ($1, 'https://example.test/') RETURNING id`,
        [userId],
      );
      scanId = scan.rows[0].id;

      plan = await buildPlan("2.0.0", "3.0.0");
      result = await runPlan(db(), plan);
    }, 180_000);

    afterAll(async () => {
      if (scratch) await scratch.end().catch(() => {});
      if (adminClient) {
        if (scratchName) {
          await adminClient
            .query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`)
            .catch(() => {});
        }
        await adminClient.end().catch(() => {});
      }
    }, 60_000);

    it("starts from a clean v2.0.0 database built from the frozen snapshot", () => {
      expect(replayErrors).toEqual([]);
      expect(versionBefore).toBe("2.0.0");
    });

    it("runs every step of the plan without a failure", () => {
      expect(result.failed).toBe(0);
      expect(result.executed).toBe(plan.steps.length);
    });

    it("leaves a database the detector recognises as 3.0.0", async () => {
      const after = fingerprintDetect(await getActualSchema(db()));
      expect(after.version).toBe("3.0.0");
    });

    it("keeps the rows the v2 database had", async () => {
      const { rows } = await db().query<{ user_id: number }>(
        "SELECT user_id FROM scan_history WHERE id = $1",
        [scanId],
      );
      expect(rows).toEqual([{ user_id: userId }]);
    });

    it("runs the scan_history_teams backfill as a data step, after the column it reads exists", () => {
      const backfillAt = plan.steps.findIndex((s) =>
        BACKFILL_LABEL.test(s.label),
      );
      const columnAt = plan.steps.findIndex(
        (s) =>
          s.kind === "addColumn" &&
          s.label === "ALTER TABLE scan_history ADD COLUMN team_id",
      );
      expect(backfillAt).toBeGreaterThan(-1);
      expect(columnAt).toBeGreaterThan(-1);
      expect(plan.steps[backfillAt].kind).toBe("dataUpdate");
      expect(backfillAt).toBeGreaterThan(columnAt);
    });

    it("backfilled scan_history_teams, and the backfill converges a scan written to the column alone", async () => {
      // A v2 database has no scan_history.team_id until this upgrade, so the
      // first pass correctly copies nothing.
      const empty = await db().query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM scan_history_teams",
      );
      expect(empty.rows[0].n).toBe(0);

      // Three lib/scanner/ write paths still set only the column, which is why
      // the backfill is unconditional. Run the plan's own step again against a
      // scan in that state and it has to pick it up, once.
      await db().query("UPDATE scan_history SET team_id = $1 WHERE id = $2", [
        teamId,
        scanId,
      ]);
      const backfill = plan.steps.filter((s) => BACKFILL_LABEL.test(s.label));
      for (let pass = 0; pass < 2; pass++) {
        const rerun = await runPlan(db(), { steps: backfill });
        expect(rerun.failed).toBe(0);
      }

      const { rows } = await db().query<{ scan_id: number; team_id: number }>(
        "SELECT scan_id, team_id FROM scan_history_teams",
      );
      expect(rows).toEqual([{ scan_id: scanId, team_id: teamId }]);
    });
  },
);
