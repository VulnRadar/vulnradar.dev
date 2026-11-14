import { describe, it, expect } from "vitest";

/**
 * The boot schema takes no table lock on a database that already has it
 * (bug-db-3). These tests hold the schema to that: every step either has its
 * effect probed from the catalog, carries an explicit guard, is its own
 * CREATE INDEX CONCURRENTLY step, or takes row locks only. A step that is none
 * of those fails here, by name, rather than quietly locking its table on
 * every restart again.
 *
 * What PostgreSQL does with the probes is a question for a real database, and
 * tests/integration/boot-schema.test.ts asks it. These prove which statements
 * the runner sends.
 */

const {
  SCHEMA_STEPS,
  applySchema,
  stepQueries,
  LOCK_TIMEOUT_ATTEMPTS,
  LOCK_TIMEOUT_CODE,
} = await import("@/lib/database/schema/index.mjs");
const {
  INDEX_STATE_SQL,
  appliedSql,
  checkValues,
  classifyStatement,
  constraintAbsent,
  lockPlan,
  relationAbsent,
  splitSqlStatements,
  stepProbe,
} = await import("@/lib/database/schema/applied-probe.mjs");
const { moduleStepStatements } =
  await import("@/scripts/_lib/_lib.schema-parity.mjs");

type Step = {
  id: string;
  sql?: string | string[];
  moduleSource?: string;
  concurrentIndex?: string;
  onError?: "throw" | "warn" | "ignore";
  guard?: { sql: string; params?: unknown[]; runWhen?: boolean };
};

const steps = SCHEMA_STEPS as Step[];
const byId = (id: string) => steps.find((s) => s.id === id) as Step;
const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("classifyStatement", () => {
  it("reads an additive ALTER as the columns it adds", () => {
    const c = classifyStatement(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS a TEXT, ADD COLUMN IF NOT EXISTS b VARCHAR(10) DEFAULT 'x,y'",
    );
    expect(c?.conditions).toHaveLength(3);
    expect(c?.conditions?.join(" ")).toContain("attname = 'a'");
    expect(c?.conditions?.join(" ")).toContain("attname = 'b'");
  });

  it("keeps an array default with a comma in it as one column", () => {
    const c = classifyStatement(
      "ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS events TEXT[] NOT NULL DEFAULT ARRAY['a', 'b']::text[]",
    );
    expect(c?.conditions).toHaveLength(2);
  });

  it("reads indexes, tables, statistics and IF EXISTS drops", () => {
    for (const sql of [
      "CREATE TABLE IF NOT EXISTS t (id INT)",
      "CREATE UNIQUE INDEX IF NOT EXISTS i ON t(id)",
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON t(id)",
      "DROP INDEX CONCURRENTLY IF EXISTS i",
      "DROP TABLE IF EXISTS t CASCADE",
      "CREATE STATISTICS IF NOT EXISTS s ON (lower(x)) FROM t",
      "ALTER TABLE t DROP COLUMN IF EXISTS c",
      "ALTER TABLE t ALTER COLUMN c DROP NOT NULL",
    ]) {
      expect(classifyStatement(sql)?.conditions?.length, sql).toBeGreaterThan(
        0,
      );
    }
  });

  it("lets row-lock statements through to run every boot", () => {
    expect(classifyStatement("UPDATE users SET x = 1")).toEqual({
      always: true,
    });
    expect(classifyStatement("INSERT INTO t SELECT 1")).toEqual({
      always: true,
    });
  });

  it("refuses the shapes whose effect it cannot read back", () => {
    for (const sql of [
      "ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0)",
      "ALTER TABLE t ALTER COLUMN c SET DEFAULT NOW()",
      "CREATE TRIGGER trg BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION f()",
      "DROP TRIGGER IF EXISTS trg ON t",
      "CREATE INDEX i ON t(id)",
      "ALTER TABLE t ADD COLUMN c TEXT",
      "DO $$ BEGIN END $$",
    ]) {
      expect(classifyStatement(sql), sql).toBeNull();
    }
  });
});

describe("splitSqlStatements", () => {
  it("does not split inside quotes, dollar quotes or comments", () => {
    expect(
      splitSqlStatements(
        "SELECT 'a;b'; -- c;d\nDO $x$ BEGIN PERFORM 1; END $x$; /* e;f */ SELECT 2",
      ),
    ).toEqual(["SELECT 'a;b'", "DO $x$ BEGIN PERFORM 1; END $x$", "SELECT 2"]);
  });
});

describe("every schema step avoids a steady-state table lock", () => {
  it("has a lock plan for every step", () => {
    const unprobed = steps
      .filter((s) => lockPlan(s) === "unprobed")
      .map((s) => s.id);
    expect(unprobed).toEqual([]);
  });

  it("probes every additive ALTER and every plain index in an unguarded step", () => {
    for (const step of steps) {
      if (step.guard || step.concurrentIndex || step.moduleSource) continue;
      const ddl = stepQueries(step)
        .flatMap((q: string) => splitSqlStatements(q))
        .filter((s: string) => /^(ALTER|CREATE (UNIQUE )?INDEX)\b/i.test(s));
      if (ddl.length === 0) continue;
      expect(stepProbe(step), step.id).not.toBeNull();
    }
  });

  it("builds every scan_history index outside its CREATE TABLE concurrently", () => {
    const plain = steps
      .filter((s) => !s.concurrentIndex && s.id !== "scan-history")
      .flatMap((s) =>
        stepQueries(s).flatMap((q: string) => splitSqlStatements(q)),
      )
      .filter((s: string) =>
        /^CREATE (UNIQUE )?INDEX (IF NOT EXISTS )?\w+ ON scan_history\b/i.test(
          norm(s),
        ),
      );
    expect(plain).toEqual([]);
    const concurrent = steps.filter((s) => s.concurrentIndex);
    for (const step of concurrent) {
      const [sql] = stepQueries(step) as string[];
      expect(sql, step.id).toMatch(
        new RegExp(
          `^CREATE (UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS ${step.concurrentIndex}\\s`,
        ),
      );
      expect(step.onError, step.id).toBe("warn");
    }
    // The four wave-1 read indexes, the crawl parent index and the older ones.
    expect(concurrent.map((s) => s.concurrentIndex)).toEqual(
      expect.arrayContaining([
        "idx_scan_history_user_shared",
        "idx_scan_history_user_url_completed",
        "idx_scan_history_public_host",
        "idx_scan_history_public_origin_path",
        "idx_scan_history_crawl_parent_id",
      ]),
    );
  });

  it("guards each module-owned step on exactly what its helper creates", () => {
    // The runner cannot read a TypeScript helper's SQL, so each of these
    // steps carries a hand-written guard. Deriving the same check from the
    // helper's own statements and comparing is what keeps a column added to
    // a helper from being skipped forever by a guard that never heard of it.
    for (const step of steps.filter((s) => s.moduleSource)) {
      const conditions = (moduleStepStatements(step) as string[])
        .flatMap((sql) => splitSqlStatements(sql))
        .flatMap((sql) => {
          const classified = classifyStatement(sql);
          expect(classified?.conditions, `${step.id}: ${sql}`).toBeDefined();
          return classified?.conditions ?? [];
        });
      expect(step.guard?.sql, step.id).toBe(appliedSql(conditions));
      expect(step.guard?.runWhen ?? false, step.id).toBe(false);
    }
  });
});

describe("checkValues", () => {
  it("reads the quoted values out of an IN list", () => {
    expect(checkValues("role IN ('user', 'admin')")).toEqual(["user", "admin"]);
  });
});

/**
 * A fake database that already has the whole schema: every probe says applied,
 * every index is valid, and every guard answers the way that skips its step.
 */
function steadyStateExecutor() {
  const runWhenByGuard = new Map<string, boolean>();
  for (const step of steps) {
    if (step.guard)
      runWhenByGuard.set(step.guard.sql, step.guard.runWhen ?? false);
  }
  const sent: string[] = [];
  const query = async (sql: string) => {
    if (sql === INDEX_STATE_SQL) return { rows: [{ state: "valid" }] };
    if (runWhenByGuard.has(sql)) {
      return { rows: [{ answer: !runWhenByGuard.get(sql) }] };
    }
    if (sql.trim().endsWith("AS applied")) {
      return { rows: [{ applied: true }] };
    }
    sent.push(sql);
    return { rows: [] };
  };
  return { sent, executor: { query } };
}

describe("applySchema on a database that already has the schema", () => {
  it("sends no DDL at all, only the row-level backfills", async () => {
    const { sent, executor } = steadyStateExecutor();
    await applySchema(executor, {
      runModuleStep: async () => {
        throw new Error("a module step ran on a steady-state database");
      },
    });
    const ddl = sent
      .flatMap((sql) => splitSqlStatements(sql))
      .filter(
        (s) => !/^(UPDATE|INSERT|DELETE|CREATE OR REPLACE FUNCTION)\b/i.test(s),
      );
    expect(ddl).toEqual([]);
    expect(sent.length).toBeGreaterThan(0);
  });
});

describe("applySchema and a lock timeout", () => {
  function lockTimeout() {
    return Object.assign(new Error("canceling statement due to lock timeout"), {
      code: LOCK_TIMEOUT_CODE,
    });
  }

  it("skips a step that times out once the catalog shows it applied", async () => {
    // users-locale is a single ADD COLUMN IF NOT EXISTS with no backfill.
    const target = stepProbe(byId("users-locale"));
    expect(target).not.toBeNull();
    let probes = 0;
    let attempts = 0;
    const notices: string[] = [];
    const query = async (sql: string) => {
      if (sql === target!.sql) {
        probes += 1;
        // Not applied when first asked; applied by the time the ALTER timed
        // out (another booting process got there first).
        return { rows: [{ applied: probes > 1 }] };
      }
      if (/ADD COLUMN IF NOT EXISTS locale/.test(sql)) {
        attempts += 1;
        throw lockTimeout();
      }
      if (/^\s*SELECT\b/i.test(sql)) return { rows: [] };
      return { rows: [] };
    };
    await applySchema(
      { query },
      {
        onNotice: (m: string) => notices.push(m),
        runModuleStep: async () => {},
      },
    );
    expect(attempts).toBe(1);
    expect(notices.some((n) => n.includes("users-locale"))).toBe(true);
  });

  it("retries a step that is not applied, then lets its onError decide", async () => {
    let attempts = 0;
    const warned: string[] = [];
    const query = async (sql: string) => {
      if (/ADD COLUMN IF NOT EXISTS locale/.test(sql)) {
        attempts += 1;
        throw lockTimeout();
      }
      return { rows: [] };
    };
    await applySchema(
      { query },
      {
        onWarn: (step: Step) => warned.push(step.id),
        runModuleStep: async () => {},
      },
    );
    expect(attempts).toBe(LOCK_TIMEOUT_ATTEMPTS);
    expect(warned).toContain("users-locale");
  });

  it("still aborts on a fatal step that never gets its lock", async () => {
    const query = async (sql: string) => {
      if (/CREATE TABLE IF NOT EXISTS sessions/.test(sql)) throw lockTimeout();
      return { rows: [] };
    };
    await expect(
      applySchema({ query }, { runModuleStep: async () => {} }),
    ).rejects.toMatchObject({ code: LOCK_TIMEOUT_CODE });
  });
});

describe("a CREATE INDEX CONCURRENTLY step", () => {
  const step = byId("scan-history-user-shared-index");

  async function run(state: "valid" | "invalid" | null) {
    const sent: string[] = [];
    const query = async (sql: string, params?: unknown[]) => {
      if (sql === INDEX_STATE_SQL) {
        const own = params?.[0] === step.concurrentIndex;
        return { rows: own && state ? [{ state }] : [] };
      }
      if (sql.includes(step.concurrentIndex as string)) sent.push(norm(sql));
      return { rows: [] };
    };
    await applySchema({ query }, { runModuleStep: async () => {} });
    return sent;
  }

  it("does nothing while the index is valid", async () => {
    expect(await run("valid")).toEqual([]);
  });

  it("builds a missing index concurrently", async () => {
    expect(await run(null)).toEqual([norm((stepQueries(step) as string[])[0])]);
  });

  it("drops an invalid leftover of an interrupted build and builds it again", async () => {
    expect(await run("invalid")).toEqual([
      `DROP INDEX CONCURRENTLY IF EXISTS ${step.concurrentIndex}`,
      norm((stepQueries(step) as string[])[0]),
    ]);
  });
});

/**
 * ai_usage swaps its (user_id, window_start) primary key for the
 * (user_id, window_start, kind) unique index. The index step is warn-mode and
 * can give up on the boot's lock timeout, and the drop used to be guarded on
 * the old key alone, so it went ahead and left the table with no key: every
 * ON CONFLICT (user_id, window_start, kind) upsert then failed.
 */
describe("the ai_usage key swap", () => {
  it("drops the old key only once the new one exists", () => {
    const build = byId("ai-usage-kind");
    const created =
      /CREATE UNIQUE INDEX IF NOT EXISTS (\w+)\s+ON ai_usage\(user_id, window_start, kind\)/.exec(
        String(build.sql),
      )?.[1];
    expect(created).toBe("idx_ai_usage_user_window_kind");

    const drop = byId("ai-usage-drop-window-key");
    // The step runs when the guard says "not applied", so the guard has to
    // count a missing replacement as nothing to do.
    expect(drop.guard?.runWhen ?? false).toBe(false);
    expect(drop.guard?.sql).toBe(
      appliedSql([
        `(${constraintAbsent("ai_usage", "ai_usage_pkey")}) OR (${relationAbsent(created!)})`,
      ]),
    );
    // And it comes after the step that builds the index.
    expect(steps.indexOf(drop)).toBeGreaterThan(steps.indexOf(build));
  });
});

describe("the drop-and-re-add steps are conditional on what is stored", () => {
  it("compares a value-set CHECK by its values, not its name", () => {
    const step = byId("check-users_role_check");
    expect(step.guard?.sql).toContain("pg_get_constraintdef");
    expect(step.guard?.sql).toContain("'super_admin'");
    expect(norm(String(step.sql))).toMatch(
      /^ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check, ADD CONSTRAINT users_role_check CHECK/,
    );
  });

  it("checks a SET NULL foreign key by its delete rule", () => {
    for (const id of [
      "fk-sessions-impersonated_by",
      "fk-admin-user-notes-admin-id",
      "fk-gifted-subscriptions-gifted-by",
      "broadcast-messages-created-by-fk",
    ]) {
      expect(byId(id).guard?.sql, id).toContain("c.confdeltype = 'n'");
    }
  });

  it("re-creates an updated_at trigger only when it is missing", () => {
    const step = byId("updated-at-trigger-users");
    expect(step.guard?.sql).toContain("pg_trigger");
    expect(step.guard?.params).toEqual(["users", "trg_users_updated_at"]);
    expect(step.guard?.runWhen).toBe(true);
  });
});
