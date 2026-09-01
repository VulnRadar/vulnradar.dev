import { it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import pool from "@/lib/database/db";
import { REQUIRED_TABLES } from "@/lib/database/required-tables";
import { describeIntegration } from "./_db";

/**
 * What the real boot path actually built, checked against the live catalog.
 *
 * tests/lib/database/on-conflict-parity.test.ts already checks ON CONFLICT
 * targets by parsing instrumentation.ts. This is the executed twin of that
 * check and it is strictly stronger in two ways. It reads pg_index, so it
 * sees what PostgreSQL ended up with rather than what the source text says
 * it should have: a constraint whose CREATE ran inside a `.catch()` that
 * swallowed a failure is present in the parse and absent here, which is
 * precisely the shape AUDIT-013 recorded on github_review_usage. And it only
 * exists because the DDL ran at all, so a statement that no longer parses
 * fails the bootstrap before any assertion is reached.
 */
const { findOnConflictTargets, readBootSchema, REPO_ROOT } =
  await import("@/scripts/_lib/_lib.schema-parity.mjs");

/**
 * What lib/database/schema says the database should contain. `npm run
 * db:create` executes this same step list, so proving the boot path produced
 * every relation in it proves both paths land on the same schema: the static
 * half of that claim is tests/lib/database/schema-single-source.test.ts, which
 * shows the two consumers issue identical statements in identical order; this
 * is the half that shows those statements actually build what they promise.
 */
const declared = readBootSchema() as {
  tables: Map<string, Set<string>>;
  indexes: Map<string, { name: string }>;
};

const SOURCE_ROOTS = ["lib", "app"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

describeIntegration("the schema the boot path builds", () => {
  /** table -> set of "a,b" column tuples with a plain unique index. */
  let uniqueTargets: Map<string, Set<string>>;

  beforeAll(async () => {
    // Partial (indpred) and expression (indexprs) unique indexes are excluded
    // for the same reason the static parity test excludes them: PostgreSQL
    // will not infer one from a bare `ON CONFLICT (cols)` unless the clause
    // repeats the predicate or expression, so counting them here would make
    // this pass for an upsert that still throws at runtime.
    const { rows } = await pool.query<{ table_name: string; cols: string }>(
      `SELECT c.relname AS table_name,
              (SELECT string_agg(att.attname, ',' ORDER BY att.attname)
                 FROM unnest(i.indkey::int2[]) AS k(attnum)
                 JOIN pg_attribute att
                   ON att.attrelid = c.oid AND att.attnum = k.attnum) AS cols
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE i.indisunique
          AND i.indpred IS NULL
          AND i.indexprs IS NULL
          AND n.nspname = 'public'`,
    );
    uniqueTargets = new Map();
    for (const row of rows) {
      if (!row.cols) continue;
      const set = uniqueTargets.get(row.table_name) ?? new Set<string>();
      set.add(row.cols.toLowerCase());
      uniqueTargets.set(row.table_name, set);
    }
  });

  it("created every table the health check calls load-bearing", async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    const present = new Set(rows.map((r) => r.tablename));
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
    expect(missing).toEqual([]);
    // The boot path creates far more than the required set; a count this low
    // would mean the bootstrap gave up partway through.
    expect(present.size).toBeGreaterThan(60);
  });

  it("applied the loop-driven DDL, not just the statements a parser can extract", async () => {
    // These four constraints are added by a `for (const fk of [...])` loop in
    // instrumentation.ts, so their SQL only exists after the template literal
    // is interpolated. Anything that builds the schema by scraping the source
    // text ends up without them. Asserting them here is what proves this tier
    // is testing the real boot path. ref: AUDIT-013#schema-03
    const { rows } = await pool.query<{ conname: string; confdeltype: string }>(
      `SELECT conname, confdeltype
         FROM pg_constraint
        WHERE contype = 'f'
          AND conname IN ('fk_sessions_impersonated_by',
                          'fk_security_alerts_resolved_by',
                          'fk_system_settings_updated_by',
                          'fk_broadcast_messages_sent_by')`,
    );
    expect(rows.map((r) => r.conname).sort()).toEqual([
      "fk_broadcast_messages_sent_by",
      "fk_security_alerts_resolved_by",
      "fk_sessions_impersonated_by",
      "fk_system_settings_updated_by",
    ]);
    // 'n' is ON DELETE SET NULL. Anything else and deleting a staff account
    // that ever resolved an alert or edited a setting fails on a FK violation.
    expect(rows.every((r) => r.confdeltype === "n")).toBe(true);
  });

  it("added every value-set CHECK constraint", async () => {
    // Same story as the foreign keys above: written as a loop, so a schema
    // rebuilt from source text had none of them. Without users_plan_check,
    // lib/database/cleanup.ts's per-plan retention silently keeps a row with
    // an unknown plan forever, and lib/rate-limiting/daily-limits.ts casts the
    // value straight to PlanType. ref: AUDIT-013#schema-07
    const { rows } = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname = ANY($1::text[])`,
      [
        [
          "users_role_check",
          "users_plan_check",
          "gifted_subscriptions_plan_check",
          "team_members_role_check",
          "team_invites_role_check",
          "domains_status_check",
        ],
      ],
    );
    expect(rows.map((r) => r.conname).sort()).toEqual([
      "domains_status_check",
      "gifted_subscriptions_plan_check",
      "team_invites_role_check",
      "team_members_role_check",
      "users_plan_check",
      "users_role_check",
    ]);
  });

  it("attached the updated_at trigger to every table the boot path lists", async () => {
    const { rows: fn } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_proc WHERE proname = 'vulnradar_set_updated_at'`,
    );
    expect(fn[0].n).toBe(1);

    const { rows } = await pool.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'trg_%_updated_at'`,
    );
    const { UPDATED_AT_TABLES } =
      await import("@/lib/database/schema/04-constraints.mjs");
    const present = new Set(rows.map((r) => r.tgname));
    expect(
      (UPDATED_AT_TABLES as string[]).filter(
        (t) => !present.has(`trg_${t}_updated_at`),
      ),
    ).toEqual([]);
  });

  it("created every table lib/database/schema declares", async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    const live = new Set(rows.map((r) => r.tablename));
    expect(
      [...declared.tables.keys()].filter((t) => !live.has(t)).sort(),
    ).toEqual([]);
  });

  it("created every index lib/database/schema declares", async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
    );
    const live = new Set(rows.map((r) => r.indexname));
    // Names are compared literally: CREATE INDEX IF NOT EXISTS <name> produces
    // exactly <name>, so a miss here means the statement did not run, not that
    // PostgreSQL renamed anything.
    expect(
      [...declared.indexes.keys()].filter((i) => !live.has(i)).sort(),
    ).toEqual([]);
  });

  it("has a real unique index behind every ON CONFLICT target in the codebase", () => {
    const files = [
      ...SOURCE_ROOTS.flatMap((dir) => sourceFiles(resolve(REPO_ROOT, dir))),
      resolve(REPO_ROOT, "instrumentation.ts"),
    ];

    const unmatched: string[] = [];
    let checked = 0;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const target of findOnConflictTargets(source) as Array<{
        table: string;
        columns: string;
        line: number;
      }>) {
        checked += 1;
        const known = uniqueTargets.get(target.table);
        if (!known?.has(target.columns)) {
          const where = `${relative(REPO_ROOT, file).replace(/\\/g, "/")}:${target.line}`;
          unmatched.push(
            `${where} ON CONFLICT (${target.columns}) on ${target.table}` +
              (known
                ? ` -- live unique indexes: ${[...known].sort().join(" | ")}`
                : " -- table has no unique index at all"),
          );
        }
      }
    }

    // A guard against the reverse failure: if the scan found nothing, an
    // empty `unmatched` would be a false pass rather than a clean bill.
    expect(checked).toBeGreaterThan(30);
    // A name here means that INSERT throws "there is no unique or exclusion
    // constraint matching the ON CONFLICT specification" in production.
    expect(unmatched.sort()).toEqual([]);
  });
});
