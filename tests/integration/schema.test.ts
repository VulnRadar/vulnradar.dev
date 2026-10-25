import { it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import pool from "@/lib/database/db";
import { REQUIRED_TABLES } from "@/lib/database/required-tables";
import { createUser, describeIntegration } from "./_db";

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
const {
  findOnConflictTargets,
  normalizeConflictTarget,
  readBootSchema,
  REPO_ROOT,
} = await import("@/scripts/_lib/_lib.schema-parity.mjs");

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
    // Partial (indpred) unique indexes are excluded for the same reason the
    // static parity test excludes them: PostgreSQL will not infer one from
    // `ON CONFLICT (...)` unless the clause repeats the predicate. Expression
    // indexes are read from their definition and normalized the same way the
    // static half normalizes source and schema, so LOWER(name) in the clause
    // matches lower((name)::text) in the catalog.
    const { rows } = await pool.query<{ table_name: string; def: string }>(
      `SELECT c.relname AS table_name,
              pg_get_indexdef(i.indexrelid) AS def
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE i.indisunique
          AND i.indpred IS NULL
          AND n.nspname = 'public'`,
    );
    uniqueTargets = new Map();
    for (const row of rows) {
      const open = row.def.indexOf("(", row.def.indexOf(" USING "));
      if (open === -1) continue;
      let depth = 0;
      let close = -1;
      for (let i = open; i < row.def.length; i++) {
        if (row.def[i] === "(") depth++;
        else if (row.def[i] === ")" && --depth === 0) {
          close = i;
          break;
        }
      }
      if (close === -1) continue;
      const set = uniqueTargets.get(row.table_name) ?? new Set<string>();
      set.add(normalizeConflictTarget(row.def.slice(open + 1, close)));
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

  it("added the v4.0.0 foundation columns, including to tables that already existed", async () => {
    // Every one of these is also an ALTER ... ADD COLUMN IF NOT EXISTS step,
    // which is the only way a database created before the column gets it.
    // This database was built from empty, so it proves the DDL runs and the
    // types are what the writers expect, not the upgrade path itself (the
    // static parity suites hold the two paths together).
    const expected: Record<string, Record<string, string>> = {
      scan_history: { failure_kind: "text" },
      system_error_logs: { scan_id: "integer" },
      email_logs: {
        template: "character varying",
        from_address: "character varying",
        smtp_host: "character varying",
        smtp_code: "integer",
        smtp_command: "character varying",
        smtp_response: "text",
        error_code: "character varying",
        message_id: "text",
      },
      worker_failure_state: {
        last_success_at: "timestamp with time zone",
        last_failure_at: "timestamp with time zone",
        last_error: "text",
      },
      support_tickets: { assigned_to: "integer" },
    };
    const { rows } = await pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [Object.keys(expected)],
    );
    const live = new Map(
      rows.map((r) => [`${r.table_name}.${r.column_name}`, r]),
    );
    for (const [table, columns] of Object.entries(expected)) {
      for (const [column, type] of Object.entries(columns)) {
        const row = live.get(`${table}.${column}`);
        expect(row?.data_type, `${table}.${column}`).toBe(type);
        // All nullable: every existing row gets NULL, which each reader
        // treats as "not recorded".
        expect(row?.is_nullable, `${table}.${column}`).toBe("YES");
      }
    }
  });

  it("wires the new foreign keys to delete the way their comments say", async () => {
    // 'c' CASCADE, 'n' SET NULL. The AI tables go with their conversation
    // and with the account; a ticket outlives the staff member it was
    // assigned to and goes back to the shared queue.
    const { rows } = await pool.query<{
      child: string;
      column: string;
      parent: string;
      confdeltype: string;
    }>(
      `SELECT c.relname AS child, a.attname AS column, p.relname AS parent,
              con.confdeltype
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_class p ON p.oid = con.confrelid
         JOIN pg_attribute a ON a.attrelid = con.conrelid
                            AND a.attnum = ANY(con.conkey)
        WHERE con.contype = 'f'
          AND c.relname IN ('ai_chat_events', 'ai_message_feedback', 'support_tickets')`,
    );
    const rule = (child: string, column: string) =>
      rows.find((r) => r.child === child && r.column === column);
    expect(rule("ai_chat_events", "conversation_id")?.confdeltype).toBe("c");
    expect(rule("ai_chat_events", "conversation_id")?.parent).toBe(
      "ai_conversations",
    );
    expect(rule("ai_chat_events", "user_id")?.confdeltype).toBe("c");
    expect(rule("ai_message_feedback", "conversation_id")?.confdeltype).toBe(
      "c",
    );
    expect(rule("ai_message_feedback", "user_id")?.confdeltype).toBe("c");
    expect(rule("support_tickets", "assigned_to")?.confdeltype).toBe("n");
  });

  it("enforces one rating per person per AI reply, of -1 or 1", async () => {
    const userId = (await createUser()).id;
    const { rows: convs } = await pool.query<{ id: number }>(
      `INSERT INTO ai_conversations (session_id, user_id)
       VALUES (gen_random_uuid(), $1) RETURNING id`,
      [userId],
    );
    const conversationId = convs[0].id;
    const rate = (rating: number) =>
      pool.query(
        `INSERT INTO ai_message_feedback (conversation_id, message_index, user_id, rating)
         VALUES ($1, 1, $2, $3)
         ON CONFLICT (conversation_id, message_index, user_id)
         DO UPDATE SET rating = EXCLUDED.rating`,
        [conversationId, userId, rating],
      );

    try {
      await rate(1);
      // Changing your mind updates the one row rather than adding a second.
      await rate(-1);
      const { rows } = await pool.query<{ rating: number }>(
        "SELECT rating FROM ai_message_feedback WHERE conversation_id = $1",
        [conversationId],
      );
      expect(rows.map((r) => r.rating)).toEqual([-1]);
      await expect(rate(0)).rejects.toThrow(/check constraint/);

      await pool.query(
        `INSERT INTO ai_chat_events (conversation_id, user_id, message_index, model, usage)
         VALUES ($1, $2, 1, 'test-model', '{"totalTokens": 12}'::jsonb)`,
        [conversationId, userId],
      );
      // Deleting the conversation (the retention prune, or account erasure)
      // takes both with it.
      await pool.query("DELETE FROM ai_conversations WHERE id = $1", [
        conversationId,
      ]);
      const { rows: left } = await pool.query<{ n: number }>(
        `SELECT (SELECT COUNT(*) FROM ai_chat_events WHERE conversation_id = $1)
              + (SELECT COUNT(*) FROM ai_message_feedback WHERE conversation_id = $1) AS n`,
        [conversationId],
      );
      expect(Number(left[0].n)).toBe(0);
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    }
  });

  it("retired the single-column audit target index for the composite one", async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE indexname IN ('idx_admin_audit_target_user', 'idx_admin_audit_target_created')`,
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      "idx_admin_audit_target_created",
    ]);
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
        const where = `${relative(REPO_ROOT, file).replace(/\\/g, "/")}:${target.line}`;
        const known = uniqueTargets.get(target.table);
        if (!known?.has(target.columns)) {
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
