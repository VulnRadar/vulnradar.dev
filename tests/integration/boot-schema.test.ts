import { it, expect } from "vitest";
import { Client, Pool } from "pg";
import pool from "@/lib/database/db";
import {
  applyBootSchema,
  withBootClient,
} from "@/lib/database/boot/apply-boot-schema";
import { backfillAiFeedbackSource } from "@/lib/database/boot/backfills";
import { repairSequences } from "@/lib/database/boot/safety-nets";
import { SCHEMA_STEPS, isStepApplied } from "@/lib/database/schema/index.mjs";
import { lockPlan } from "@/lib/database/schema/applied-probe.mjs";
import { AI_FEEDBACK_NOTE } from "@/lib/scanner/feedback-source";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The boot schema against a real PostgreSQL, on a database the tier's own
 * register() has already built, which is exactly the steady state a restart
 * meets.
 *
 * Every question here is about what PostgreSQL does: which lock a statement
 * takes before it finds out it has nothing to do (bug-db-3), whether a
 * session's statement_timeout is the one in force (ops-10), what an
 * interrupted CREATE INDEX CONCURRENTLY leaves behind, and whether a
 * sequence moves. A faked pool answers all of them however it is told to.
 */

const ssl =
  process.env.INTEGRATION_DATABASE_SSL === "true"
    ? { rejectUnauthorized: true }
    : false;
const connectionString = process.env.DATABASE_URL as string;

type Step = { id: string };

/** Steps whose whole job is a row-level DELETE or UPDATE every boot. */
const DATA_ONLY_STEPS = new Set(["email-2fa-codes-unsalted-cleanup"]);

async function indexValid(name: string): Promise<boolean | null> {
  const { rows } = await pool.query<{ valid: boolean }>(
    `SELECT i.indisvalid AS valid FROM pg_index i
      WHERE i.indexrelid = to_regclass('public.' || $1)`,
    [name],
  );
  return rows[0]?.valid ?? null;
}

describeIntegration("boot schema", () => {
  it("finds every step already applied on a database it built", async () => {
    // The probes and guards are only worth anything if they say "applied"
    // for real: one that never matches would run its DDL, and take its lock,
    // on every boot.
    const notApplied: string[] = [];
    for (const step of SCHEMA_STEPS as Step[]) {
      if (lockPlan(step) === "always" || DATA_ONLY_STEPS.has(step.id)) continue;
      if (!(await isStepApplied(pool, step))) notApplied.push(step.id);
    }
    expect(notApplied).toEqual([]);
  });

  it("takes no exclusive lock while another session holds sessions open", async () => {
    const holder = new Client({ connectionString, ssl });
    const watcher = new Client({ connectionString, ssl });
    await holder.connect();
    await watcher.connect();
    const {
      rows: [{ pid: holderPid }],
    } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");

    // A transaction that has written sessions and read users and is still
    // open: the ROW EXCLUSIVE it holds is what every ALTER TABLE sessions and
    // every plain CREATE INDEX on sessions has to wait for, IF NOT EXISTS or
    // not, and the ACCESS SHARE on users blocks any ALTER TABLE users.
    await holder.query("BEGIN");
    await holder.query("LOCK TABLE sessions IN ROW EXCLUSIVE MODE");
    await holder.query("SELECT count(*) FROM users");

    const seen: Array<{ mode: string; granted: boolean; relation: string }> =
      [];
    let polling = true;
    const poll = (async () => {
      while (polling) {
        const { rows } = await watcher.query<{
          mode: string;
          granted: boolean;
          relation: string;
        }>(
          // Client backends only: autovacuum may take a brief ACCESS
          // EXCLUSIVE to truncate a table, and that is not the boot's.
          `SELECT l.mode, l.granted, l.relation::regclass::text AS relation
             FROM pg_locks l
             JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE l.locktype = 'relation'
              AND a.backend_type = 'client backend'
              AND l.pid NOT IN (pg_backend_pid(), $1)
              AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
              AND (l.mode = 'AccessExclusiveLock' OR NOT l.granted)`,
          [holderPid],
        );
        seen.push(...rows);
      }
    })();

    const started = Date.now();
    try {
      await applyBootSchema(pool, "Test");
    } finally {
      polling = false;
      await poll;
      await holder.query("ROLLBACK");
      await holder.end();
      await watcher.end();
    }
    expect(seen).toEqual([]);
    // Shorter than one lock_timeout: no step waited for the open transaction.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("completes on a pool whose statement timeout is 50 ms", async () => {
    const slow = new Pool({
      connectionString,
      ssl,
      max: 2,
      statement_timeout: 50,
    });
    slow.on("error", () => {});
    try {
      // The pool's own limit is real ...
      await expect(slow.query("SELECT pg_sleep(0.2)")).rejects.toThrow(
        /statement timeout/,
      );
      // ... and the boot connection does not run under it.
      await expect(
        withBootClient(slow, (executor) =>
          executor.query("SELECT pg_sleep(0.2)"),
        ),
      ).resolves.toBeDefined();

      // So a boot that has real work to do on scan_history finishes it.
      await pool.query(
        "DROP INDEX IF EXISTS idx_scan_history_user_url_completed",
      );
      await applyBootSchema(slow, "Test");
      expect(await indexValid("idx_scan_history_user_url_completed")).toBe(
        true,
      );
    } finally {
      await slow.end();
    }
  });

  it("drops the invalid index an interrupted build left and builds it again", async () => {
    // A CREATE UNIQUE INDEX CONCURRENTLY that meets a duplicate fails and
    // leaves its catalog entry behind, invalid, which IF NOT EXISTS then
    // takes for the finished index on every boot after.
    const user = await createUser();
    const dup = unique("dup").replace(/[^a-z0-9]/g, "");
    await pool.query("DROP INDEX IF EXISTS idx_scan_history_public_id");
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO scan_history (user_id, url, public_id)
       VALUES ($1, 'https://dup.example.test/', $2), ($1, 'https://dup.example.test/', $2)
       RETURNING id`,
      [user.id, dup],
    );
    await expect(
      pool.query(
        "CREATE UNIQUE INDEX CONCURRENTLY idx_scan_history_public_id ON scan_history(public_id)",
      ),
    ).rejects.toThrow();
    expect(await indexValid("idx_scan_history_public_id")).toBe(false);

    await pool.query(
      "UPDATE scan_history SET public_id = replace(gen_random_uuid()::text, '-', '') WHERE id = $1",
      [rows[1].id],
    );
    await applyBootSchema(pool, "Test");
    expect(await indexValid("idx_scan_history_public_id")).toBe(true);
    await pool.query("DELETE FROM scan_history WHERE user_id = $1", [user.id]);
  });

  it("replaces a value-set CHECK whose values fell behind the code's list", async () => {
    // A name-only guard left this constraint as it was, so a role added to
    // the list was refused by every database that already had it.
    await pool.query(
      `ALTER TABLE users DROP CONSTRAINT users_role_check,
         ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'super_admin')) NOT VALID`,
    );
    await applyBootSchema(pool, "Test");
    const user = await createUser({ role: "security_analyst" });
    expect(user.id).toBeGreaterThan(0);
    await pool.query("DELETE FROM users WHERE id = $1", [user.id]);
  });

  it("marks the verifier's old feedback rows as AI and leaves people's alone, once", async () => {
    const user = await createUser();
    const url = `https://${unique("fb").replace(/[^a-z0-9]/g, "")}.example.test/`;
    const insert = async (findingId: string, notes: string | null) => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO scan_finding_feedback (user_id, finding_id, finding_url, verdict, notes)
         VALUES ($1, $2, $3, 'false_positive', $4) RETURNING id`,
        [user.id, findingId, url, notes],
      );
      return rows[0].id;
    };
    // Written before the column existed, so it took the 'human' default.
    const aiRow = await insert("hdr--1", AI_FEEDBACK_NOTE);
    const humanRow = await insert("hdr--2", null);
    // A person clicked a verdict the AI had filled in, which overwrites the note.
    const claimedRow = await insert("hdr--3", "Checked by hand");

    const sources = async () => {
      const { rows } = await pool.query<{
        id: string;
        source: string;
        xmin: string;
      }>(
        `SELECT id, source, xmin::text AS xmin FROM scan_finding_feedback
          WHERE id = ANY($1::bigint[]) ORDER BY id`,
        [[aiRow, humanRow, claimedRow]],
      );
      return rows;
    };
    expect((await sources()).map((r) => r.source)).toEqual([
      "human",
      "human",
      "human",
    ]);

    // The backfill only runs until the legacy carry-over has finished, and
    // register() in the global setup has already recorded one on this
    // database. A boot of a database upgraded to 4.0.0 has not.
    const { rows: meta } = await pool.query<{ done_at: Date | null }>(
      "SELECT legacy_triage_done_at AS done_at FROM vulnradar_schema_meta WHERE id = 1",
    );
    const doneAt = meta[0]?.done_at ?? null;
    await pool.query(
      "UPDATE vulnradar_schema_meta SET legacy_triage_done_at = NULL WHERE id = 1",
    );
    try {
      await backfillAiFeedbackSource(pool);
      const first = await sources();
      expect(first.map((r) => r.source)).toEqual(["ai", "human", "human"]);

      // The second boot finds nothing to do and rewrites no row.
      await backfillAiFeedbackSource(pool);
      expect(await sources()).toEqual(first);

      // Once the carry-over has finished, source is the record and the note
      // is only text: a row whose note matches is left as it is.
      await pool.query(
        "UPDATE vulnradar_schema_meta SET legacy_triage_done_at = NOW() WHERE id = 1",
      );
      await pool.query(
        "UPDATE scan_finding_feedback SET source = 'human' WHERE id = $1",
        [aiRow],
      );
      await backfillAiFeedbackSource(pool);
      expect((await sources()).map((r) => r.source)).toEqual([
        "human",
        "human",
        "human",
      ]);
    } finally {
      await pool.query(
        "UPDATE vulnradar_schema_meta SET legacy_triage_done_at = $1 WHERE id = 1",
        [doneAt],
      );
      await pool.query("DELETE FROM scan_finding_feedback WHERE user_id = $1", [
        user.id,
      ]);
    }
  });

  it("moves a sequence behind MAX(id) forward and never moves one back", async () => {
    const seq = "broadcast_templates_id_seq";
    const lastValue = async () => {
      const { rows } = await pool.query<{ v: string | null }>(
        "SELECT pg_sequence_last_value($1::regclass) AS v",
        [seq],
      );
      return Number(rows[0].v ?? 0);
    };
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO broadcast_templates (name, subject, content)
       VALUES ($1, 's', 'c') RETURNING id`,
      [unique("tpl")],
    );
    const id = rows[0].id;

    // Ahead of MAX(id), the way a live instance leaves it after rows above
    // the maximum were deleted: the repair must leave it where it is.
    await pool.query("SELECT setval($1::regclass, $2)", [seq, id + 1000]);
    await repairSequences(pool, "Test");
    expect(await lastValue()).toBe(id + 1000);

    // Behind MAX(id), the way an explicit-id import leaves it.
    await pool.query(
      `INSERT INTO broadcast_templates (id, name, subject, content)
       VALUES ($1, $2, 's', 'c')`,
      [id + 2000, unique("tpl")],
    );
    await repairSequences(pool, "Test");
    expect(await lastValue()).toBe(id + 2000);

    await pool.query("DELETE FROM broadcast_templates WHERE id IN ($1, $2)", [
      id,
      id + 2000,
    ]);
  });
});
