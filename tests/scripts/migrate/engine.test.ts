import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The three modules that decide what a migration does and then do it:
 * _detect.mjs (which version the database is at), _planner.mjs (which
 * steps that implies) and _runner.mjs (executing them).
 *
 * AUDIT-013 cov-07: scripts/migrate/ is 4,400 lines and the only test
 * touching it was for one version file's DDL text. The engine deciding
 * whether to run that DDL, and the transaction executing it against a
 * populated production database, had no test at all. `scripts/**` is also
 * excluded from coverage in vitest.config.ts, so the gap did not appear in
 * any report either.
 *
 * Nothing here needs a live database: the detector is a pure function over
 * a schema snapshot, the planner is a pure function over the version files,
 * and the runner takes a pool, which is faked at the pool.connect ->
 * client.query -> client.release boundary the rest of the suite uses.
 */
const { fingerprintDetect } = await import("@/scripts/migrate/_detect.mjs");
const { buildPlan } = await import("@/scripts/migrate/_planner.mjs");
const { runPlan, repairAllSequences } =
  await import("@/scripts/migrate/_runner.mjs");
const { VERSIONS, getVersion } =
  await import("@/scripts/migrate/_registry.mjs");

/**
 * A live-schema snapshot ({ table: [columns] }, the shape getActualSchema
 * returns) that satisfies a version's fingerprint exactly. Built FROM the
 * fingerprint rather than typed out, so these tests describe the detector's
 * behaviour rather than restating the registry.
 */
function schemaFor(version: string): Record<string, string[]> {
  const fingerprint = getVersion(version).fingerprint;
  const out: Record<string, string[]> = {};
  for (const table of fingerprint.tables as Set<string>) out[table] = ["id"];
  for (const [table, columns] of Object.entries(
    (fingerprint.columns ?? {}) as Record<string, Set<string>>,
  )) {
    out[table] = [...new Set([...(out[table] ?? []), ...columns])].map((c) =>
      c.toLowerCase(),
    );
  }
  return out;
}

describe("fingerprintDetect", () => {
  it("detects the newest version when the live schema satisfies it", () => {
    const latest = VERSIONS[VERSIONS.length - 1].name;
    const result = fingerprintDetect(schemaFor(latest));
    expect(result.version).toBe(latest);
    expect(result.confidence).toBe("high");
  });

  it("falls back to the highest version that is genuinely complete", () => {
    const latest = VERSIONS[VERSIONS.length - 1].name;
    const previous = VERSIONS[VERSIONS.length - 2].name;
    // The union of both fingerprints, not schemaFor(latest) on its own.
    // Since AUDIT-011 drift-17 the 2.0.0 -> 3.0.0 upgrade DROPS a v2 column
    // (users.email_session_revoked, a legacy duplicate), so the v3
    // fingerprint is no longer a superset of the v2 one: a snapshot built
    // from v3 alone is not a valid v2 database either, and the detector
    // rightly refuses both. That is not what this test is about. The state
    // the fallback exists for is a half-upgraded database, which still
    // carries every v2 column, so that is what gets built here.
    const live = schemaFor(previous);
    for (const [table, columns] of Object.entries(schemaFor(latest))) {
      live[table] = [...new Set([...(live[table] ?? []), ...columns])];
    }
    // Remove a table only the newest version has.
    const onlyInLatest = [
      ...(getVersion(latest).fingerprint.tables as Set<string>),
    ].find(
      (t) => !(getVersion(previous).fingerprint.tables as Set<string>).has(t),
    )!;
    delete live[onlyInLatest];
    const result = fingerprintDetect(live);
    expect(result.version).toBe(previous);
  });

  it("does NOT report a version whose fingerprint columns are missing", () => {
    // AUDIT-013 migrate-08, the regression this exists for. A missing
    // COLUMN used to only downgrade confidence from "high" to "medium"
    // while still returning the version, which is exactly the state a
    // half-finished 1.0.0 -> 2.0.0 run leaves: every v2 table present,
    // users.plan and friends absent. migrate.mjs accepted that, planned
    // 2.0.0 -> 3.0.0, skipped the addColumns that would have supplied
    // them, stamped 3.0.0, and the next boot died on
    // `CREATE INDEX idx_users_plan ON users(plan)` -- permanently, since
    // the meta row now said 3.0.0.
    const live = schemaFor("2.0.0");
    expect(live.users).toContain("plan");
    live.users = live.users.filter((c) => c !== "plan");
    const result = fingerprintDetect(live);
    expect(result.version).not.toBe("2.0.0");
    expect(result.version).not.toBe("3.0.0");
  });

  it("reports low confidence and no version for a schema it does not recognize", () => {
    const result = fingerprintDetect({ something_else: ["id"] });
    expect(result.version).toBeNull();
    expect(result.confidence).toBe("low");
  });

  it("ignores extra tables the fingerprint does not mention", () => {
    const latest = VERSIONS[VERSIONS.length - 1].name;
    const live = schemaFor(latest);
    live.a_table_from_the_future = ["id"];
    expect(fingerprintDetect(live).version).toBe(latest);
  });
});

describe("buildPlan", () => {
  it("plans nothing when the database is already at the target", async () => {
    const plan = await buildPlan("3.0.0", "3.0.0");
    expect(plan.steps).toEqual([]);
  });

  it("refuses to plan from or to a version it does not know", async () => {
    await expect(buildPlan("9.9.9", "3.0.0")).rejects.toThrow(
      /Unknown version/,
    );
    await expect(buildPlan("1.0.0", "9.9.9")).rejects.toThrow(
      /Unknown version/,
    );
  });

  it("walks every intermediate version on a multi-step upgrade", async () => {
    const plan = await buildPlan("1.0.0", "3.0.0");
    expect(plan.transitions.map((t: { to: string }) => t.to)).toEqual([
      "2.0.0",
      "3.0.0",
    ]);
    // Every step records which transition produced it, which is what lets
    // the preview group them.
    expect(
      plan.steps.every((s: { versionStep?: unknown }) => s.versionStep),
    ).toBe(true);
  });

  it("resolves the reversed filename for a downgrade", async () => {
    // 3.0.0 -> 2.0.0 has no 3.0.0-to-2.0.0.mjs; findVersionFile falls back
    // to the upgrade file's `downgrade` export.
    const plan = await buildPlan("3.0.0", "2.0.0");
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(
      plan.steps.filter((s: { kind: string }) => s.kind === "dropTable").length,
    ).toBeGreaterThan(0);
  });

  it("marks table and column drops destructive and index drops not", async () => {
    const plan = await buildPlan("3.0.0", "2.0.0");
    for (const step of plan.steps) {
      if (step.kind === "dropTable" || step.kind === "dropColumn") {
        expect(step.destructive).toBe(true);
      }
      if (step.kind === "dropIndex") expect(step.destructive).toBe(false);
    }
  });

  it("emits CREATE UNIQUE INDEX for a unique index, not a plain one", async () => {
    // AUDIT-013 migrate-06: the planner dropped the `unique` flag, so the
    // migration path and instrumentation.ts created indexes with the SAME
    // NAME and different uniqueness. CREATE INDEX IF NOT EXISTS matches on
    // the name alone, so whichever ran first silently decided whether the
    // constraint existed.
    const plan = await buildPlan("2.0.0", "3.0.0");
    const mod = await import("@/scripts/migrate/versions/2.0.0-to-3.0.0.mjs");
    const uniqueNames = mod.upgrade.addIndexes
      .filter((i: { unique?: boolean }) => i.unique)
      .map((i: { name: string }) => i.name);
    for (const name of uniqueNames) {
      const step = plan.steps.find(
        (s: { kind: string; sql: string }) =>
          s.kind === "createIndex" && s.sql.includes(` ${name} `),
      );
      expect(step, `no createIndex step for ${name}`).toBeDefined();
      expect(step.sql).toContain("CREATE UNIQUE INDEX");
    }
    // And a non-unique one must not have acquired the keyword.
    const plainStep = plan.steps.find(
      (s: { kind: string; sql: string }) =>
        s.kind === "createIndex" && !s.sql.includes("UNIQUE"),
    );
    expect(plainStep).toBeDefined();
  });
});

describe("runPlan", () => {
  let queries: { sql: string; params?: unknown[] }[];
  let failOn: string | null;
  let release: ReturnType<typeof vi.fn>;
  let pool: { connect: () => Promise<unknown> };
  let logSpy: ReturnType<typeof vi.spyOn>;

  const step = (sql: string) => ({
    kind: "createTable",
    sql,
    label: sql,
    destructive: false,
    dataLoss: null,
  });

  beforeEach(() => {
    queries = [];
    failOn = null;
    release = vi.fn();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    pool = {
      connect: async () => ({
        query: async (sql: string, params?: unknown[]) => {
          queries.push({ sql: String(sql).trim(), params });
          if (failOn && String(sql).includes(failOn)) {
            throw new Error(`simulated failure: ${failOn}`);
          }
          return { rows: [], rowCount: 0 };
        },
        release,
      }),
    };
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const sqls = () => queries.map((q) => q.sql);

  it("runs every step inside one transaction and commits", async () => {
    const result = await runPlan(pool, {
      steps: [step("CREATE TABLE a ()"), step("CREATE TABLE b ()")],
    });
    expect(result).toMatchObject({ executed: 2, failed: 0 });
    expect(sqls()[0]).toBe("BEGIN");
    expect(sqls()).toContain("COMMIT");
    expect(sqls()).not.toContain("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("bounds how long it can block the running app", async () => {
    // AUDIT-013 migrate-13: the self-updater runs db:migrate from inside
    // the serving app without restarting it, and two of the plan's steps
    // take ACCESS EXCLUSIVE on scan_history for the rest of the
    // transaction. Without a lock_timeout every request queues behind the
    // migration indefinitely.
    await runPlan(pool, { steps: [step("CREATE TABLE a ()")] });
    expect(sqls()).toContain("SET LOCAL lock_timeout = '30s'");
    expect(
      sqls().some((s) => s.startsWith("SET LOCAL statement_timeout")),
    ).toBe(true);
  });

  it("rolls back and stops at the first failing step", async () => {
    failOn = "CREATE TABLE b";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runPlan(pool, {
      steps: [
        step("CREATE TABLE a ()"),
        step("CREATE TABLE b ()"),
        step("CREATE TABLE c ()"),
      ],
    });
    errSpy.mockRestore();
    expect(result).toMatchObject({ executed: 1, failed: 1 });
    expect(sqls()).toContain("ROLLBACK");
    expect(sqls()).not.toContain("COMMIT");
    // The step after the failure never ran.
    expect(sqls()).not.toContain("CREATE TABLE c ()");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("writes the schema-version marker inside the same transaction as the DDL", async () => {
    // AUDIT-013 migrate-05: the marker used to be a separate commit
    // afterwards, so an interruption between the two left a fully migrated
    // database whose meta row held the old version -- and instrumentation.ts
    // then refused to boot with a SCHEMA VERSION MISMATCH box that told the
    // operator the opposite of what was true.
    // `client: object` in the JSDoc signature runPlan declares, narrowed
    // here where it is actually called.
    const beforeCommit = vi.fn(async (client: object) => {
      await (client as { query: (s: string) => unknown }).query(
        "UPDATE vulnradar_schema_meta SET schema_version = $1",
      );
    });
    await runPlan(
      pool,
      { steps: [step("CREATE TABLE a ()")] },
      { beforeCommit },
    );
    expect(beforeCommit).toHaveBeenCalledTimes(1);
    const markerAt = sqls().findIndex((s) =>
      s.startsWith("UPDATE vulnradar_schema_meta"),
    );
    const commitAt = sqls().indexOf("COMMIT");
    expect(markerAt).toBeGreaterThan(-1);
    expect(markerAt).toBeLessThan(commitAt);
  });

  it("does not write the marker when a step failed", async () => {
    failOn = "CREATE TABLE a";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const beforeCommit = vi.fn();
    await runPlan(
      pool,
      { steps: [step("CREATE TABLE a ()")] },
      { beforeCommit },
    );
    errSpy.mockRestore();
    expect(beforeCommit).not.toHaveBeenCalled();
  });

  it("executes the SQL for real on a dry run, then rolls it back", async () => {
    // A dry run that only printed labels could never catch a broken
    // statement, which is the entire point of running one first.
    const beforeCommit = vi.fn();
    const result = await runPlan(
      pool,
      { steps: [step("CREATE TABLE a ()")] },
      { dryRun: true, beforeCommit },
    );
    expect(result.executed).toBe(1);
    expect(sqls()).toContain("CREATE TABLE a ()");
    expect(sqls()).toContain("ROLLBACK");
    expect(sqls()).not.toContain("COMMIT");
    expect(beforeCommit).not.toHaveBeenCalled();
  });

  it("does not repair sequences on a dry run", async () => {
    await runPlan(
      pool,
      { steps: [step("CREATE TABLE a ()")] },
      { dryRun: true },
    );
    expect(sqls().some((s) => s.includes("pg_advisory_lock"))).toBe(false);
  });

  it("treats a sequence-repair failure after COMMIT as non-fatal", async () => {
    // AUDIT-009 migration-03: this used to run unguarded, so a failure in
    // the safety net reported an already-committed migration as a failure
    // and skipped the caller's meta write.
    failOn = "pg_advisory_lock";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runPlan(pool, { steps: [step("CREATE TABLE a ()")] });
    warnSpy.mockRestore();
    expect(result).toMatchObject({ executed: 1, failed: 0 });
    expect(sqls()).toContain("COMMIT");
  });

  it("does nothing at all for an empty plan", async () => {
    const result = await runPlan(pool, { steps: [] });
    expect(result).toMatchObject({ executed: 0, failed: 0 });
    expect(queries).toEqual([]);
  });
});

describe("repairAllSequences", () => {
  it("only ever moves a sequence forward, and takes a lock while it does", async () => {
    // AUDIT-013 migrate-03: this ran an unconditional
    // `setval(seq, MAX(id))` whenever MAX(id) > 0, with no comparison
    // against the sequence's current value, unlike the copy in
    // instrumentation.ts. That moves a sequence BACKWARDS whenever rows
    // above MAX(id) were deleted, and it runs post-COMMIT while the app is
    // still inserting: read MAX(id)=N, a concurrent INSERT takes N+1 and
    // commits, setval(N) executes, the next INSERT gets N+1 again and
    // fails with a duplicate key violation. The rewind also hands out ids
    // that used to belong to another user's row.
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(String(sql));
        return { rows: [] };
      },
    };
    await repairAllSequences(client);
    const body = queries.join("\n");
    expect(body).toContain("pg_sequence_last_value");
    expect(body).toContain("max_val > COALESCE(r.last_val, 0)");
    expect(queries.some((q) => q.includes("pg_advisory_lock"))).toBe(true);
    expect(queries.some((q) => q.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("releases the advisory lock even when the repair throws", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(String(sql));
        if (String(sql).includes("DO $$")) throw new Error("boom");
        return { rows: [] };
      },
    };
    await expect(repairAllSequences(client)).rejects.toThrow("boom");
    expect(queries.some((q) => q.includes("pg_advisory_unlock"))).toBe(true);
  });
});
