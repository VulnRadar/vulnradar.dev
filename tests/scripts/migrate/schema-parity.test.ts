import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The guard that makes migration drift structurally impossible.
 *
 * The project has shipped the same defect twice. AUDIT-009#migration-01
 * found 4 tables that instrumentation.ts (the boot-time schema) created
 * and scripts/migrate/versions/*.mjs did not, so `npm run db:migrate`
 * stamped schema_version=3.0.0 on a database that was missing real
 * tables. It was fixed, declared closed "for good" in a comment in that
 * same version file, and re-opened as AUDIT-013#migrate-01 at 11 tables
 * and 8 columns: roughly three times the original size.
 *
 * Both times the guard was a hand-maintained list of names inside
 * tests/scripts/migrate/versions/2.0.0-to-3.0.0.test.ts, asserted with
 * `expect.arrayContaining`. That is a subset check against a literal
 * somebody typed, so it can only ever fail for a name that is already
 * written down. It cannot fail for the one thing it exists to catch: a
 * table added to instrumentation.ts that nobody remembered to add to the
 * migration.
 *
 * Nothing below writes a table or column name. Both sides are PARSED:
 * the canonical side out of instrumentation.ts, the reachable side out of
 * the v1 baseline snapshot plus every version file's own upgrade export.
 * If someone adds table 32 to instrumentation.ts and not to the
 * migration, this suite goes red and names it. A deliberate exception has
 * to be declared in DELIBERATE_BOOT_ONLY_TABLES / _COLUMNS in
 * scripts/_lib/_lib.schema-parity.mjs, which makes adding one a conscious
 * edit instead of a silent omission.
 */
const parity = await import("@/scripts/_lib/_lib.schema-parity.mjs");
const { getVersion, VERSIONS } =
  await import("@/scripts/migrate/_registry.mjs");
const { buildPlan } = await import("@/scripts/migrate/_planner.mjs");

const {
  readBootSchema,
  readV1BaselineSchema,
  readSchemaStatements,
  buildMigrationSchema,
  planToStatements,
  splitStatements,
  foldStatements,
  loadVersionFile,
  UPGRADE_CHAIN,
  FROZEN_SNAPSHOTS,
  META_TABLE,
  REPO_ROOT,
  DELIBERATE_BOOT_ONLY_TABLES,
  DELIBERATE_BOOT_ONLY_COLUMNS,
} = parity;

type Schema = {
  tables: Map<string, Set<string>>;
  indexes: Map<
    string,
    {
      name: string;
      unique: boolean;
      table: string;
      using: string | null;
      columns: string;
      where: string | null;
    }
  >;
};

const canonical = readBootSchema() as Schema;
const reachable = (await buildMigrationSchema()) as Schema;

const sorted = (values: Iterable<string>) => [...values].sort();

/** "table.column" for every column in a parsed schema. */
function columnKeys(schema: Schema): string[] {
  const out: string[] = [];
  for (const [table, columns] of schema.tables) {
    for (const column of columns) out.push(`${table}.${column}`);
  }
  return out.sort();
}

describe("schema parity: the extraction itself", () => {
  /**
   * Every assertion below compares two parsed sets. A regex regression
   * that made BOTH sides empty would make all of them pass, which is
   * precisely the failure mode that let 11 CREATE TABLE statements go
   * missing from every consumer of this extraction once already (see
   * SQL_BLOCK_REGEX_SOURCE's own comment). These three assertions are the
   * floor that stops a silent no-op from reading as parity.
   */
  it("derives a realistic number of tables from the boot schema", () => {
    expect(canonical.tables.size).toBeGreaterThan(60);
    expect(canonical.indexes.size).toBeGreaterThan(100);
  });

  it("parses the v1 baseline snapshot", () => {
    expect(readV1BaselineSchema().tables.size).toBeGreaterThan(15);
  });

  it("finds the tables at both ends of the step list", () => {
    // `users` is the first schema step, `support_ticket_shares` one of the
    // last. A derivation that stops short drops the tail.
    expect(canonical.tables.has("users")).toBe(true);
    expect(canonical.tables.has("support_ticket_shares")).toBe(true);
    // Owned by an ensure*() helper in another module rather than declared
    // inline, so this also proves the moduleSource steps are wired.
    expect(canonical.tables.has("staff_invites")).toBe(true);
    expect(canonical.tables.has("admin_audit_log_archive")).toBe(true);
    // Added by lib/notifications/digest-schema.ts, which was in NO derivation
    // at all before: these three columns existed on a booted database and on
    // neither `npm run db:create` nor `npm run db:migrate`.
    expect(canonical.tables.get("users")?.has("digest_email_enabled")).toBe(
      true,
    );
    expect(canonical.tables.get("users")?.has("last_digest_sent_at")).toBe(
      true,
    );
    expect(
      canonical.tables
        .get("notification_preferences")
        ?.has("email_posture_digest"),
    ).toBe(true);
  });

  it("resolves every file in the upgrade chain", async () => {
    for (const filename of UPGRADE_CHAIN) {
      const mod = await loadVersionFile(filename);
      expect(mod.upgrade).toBeDefined();
      expect(mod.downgrade).toBeDefined();
    }
    // One file per registered transition. Adding a version file without
    // adding it here would make the derived schema stop short and report
    // the new version's tables as drift, so this keeps the two in step.
    expect(UPGRADE_CHAIN).toHaveLength(VERSIONS.length - 1);
  });
});

describe("schema parity: instrumentation.ts vs the migration path", () => {
  it("the migration path creates every table instrumentation.ts creates", () => {
    const bootOnly = sorted(
      [...canonical.tables.keys()].filter(
        (t) =>
          !reachable.tables.has(t) &&
          !(t in (DELIBERATE_BOOT_ONLY_TABLES as Record<string, string>)),
      ),
    );
    // A non-empty array here IS the defect: `npm run db:migrate` would
    // stamp the target schema version on a database missing these.
    expect(bootOnly).toEqual([]);
  });

  it("the migration path creates no table instrumentation.ts does not", () => {
    // The other direction matters too: a table only the migration creates
    // is one the app never maintains, and it would be silently absent from
    // any freshly-booted database.
    expect(
      sorted(
        [...reachable.tables.keys()].filter((t) => !canonical.tables.has(t)),
      ),
    ).toEqual([]);
  });

  it("both sides agree on the exact table set", () => {
    expect(sorted(reachable.tables.keys())).toEqual(
      sorted(canonical.tables.keys()),
    );
  });

  it("the migration path adds every column instrumentation.ts adds", () => {
    const deliberate = DELIBERATE_BOOT_ONLY_COLUMNS as Record<string, string>;
    const missing: string[] = [];
    for (const [table, columns] of canonical.tables) {
      const other = reachable.tables.get(table);
      if (!other) continue; // reported by the table assertions above
      for (const column of columns) {
        const key = `${table}.${column}`;
        if (!other.has(column) && !(key in deliberate)) missing.push(key);
      }
    }
    expect(missing.sort()).toEqual([]);
  });

  it("both sides agree on the exact column set", () => {
    expect(columnKeys(reachable)).toEqual(columnKeys(canonical));
  });

  it("both sides agree on index names, and on which of them are UNIQUE", () => {
    // AUDIT-013 migrate-06: two indexes were UNIQUE on the boot path and
    // non-unique on the migration path under the SAME name. CREATE INDEX
    // IF NOT EXISTS matches on the name alone, so whichever path ran first
    // silently decided whether the constraint existed at all.
    const shape = (schema: Schema) =>
      sorted(
        [...schema.indexes.values()].map(
          (i) =>
            `${i.unique ? "UNIQUE " : ""}${i.name} ON ${i.table}(${i.columns})${
              i.where ? ` WHERE ${i.where}` : ""
            }`,
        ),
      );
    expect(shape(reachable)).toEqual(shape(canonical));
  });
});

describe("schema parity: the registry fingerprint", () => {
  const latest = VERSIONS[VERSIONS.length - 1].name;

  it("the newest fingerprint's table set is exactly the derived one", () => {
    // migrate.mjs verifies the live schema against this fingerprint after
    // a migration, so a fingerprint that under-describes the version is a
    // verification that cannot fail.
    const fingerprint = getVersion(latest).fingerprint;
    expect(sorted(fingerprint.tables)).toEqual(sorted(reachable.tables.keys()));
  });

  it("every column named in the newest fingerprint really exists", () => {
    const fingerprint = getVersion(latest).fingerprint;
    const unknown: string[] = [];
    for (const [table, columns] of Object.entries(
      (fingerprint.columns ?? {}) as Record<string, Set<string>>,
    )) {
      const derived = reachable.tables.get(table);
      for (const column of columns) {
        if (!derived?.has(column)) unknown.push(`${table}.${column}`);
      }
    }
    expect(unknown.sort()).toEqual([]);
  });
});

describe("schema parity: the frozen snapshots are actually frozen", () => {
  /**
   * scripts/create-fresh-db/schemas/instrumentation-v{1,2}.ts are what
   * `npm run db:create` builds an older database from. Both say "DO NOT
   * EDIT" and both had been edited anyway (AUDIT-013 migrate-07): the v2
   * file grew three v3.7-era support-ticket tables, and the v1 file
   * shipped processed_stripe_events with `event_id TEXT` / `received_at`
   * where every other path uses `event_id VARCHAR(255)` / `processed_at`.
   * Since all three paths use CREATE TABLE IF NOT EXISTS, neither of the
   * later ones could ever repair those column names.
   *
   * A comment is not a guard. These are.
   */
  for (const [version, path] of Object.entries(
    FROZEN_SNAPSHOTS as Record<string, string>,
  )) {
    it(`the v${version} snapshot creates exactly the v${version} fingerprint tables`, () => {
      const snapshot = foldStatements(readSchemaStatements(path)) as Schema;
      snapshot.tables.delete(META_TABLE);
      expect(sorted(snapshot.tables.keys())).toEqual(
        sorted(getVersion(version).fingerprint.tables),
      );
    });

    it(`every v${version} fingerprint column exists in the v${version} snapshot`, () => {
      const snapshot = foldStatements(readSchemaStatements(path)) as Schema;
      const missing: string[] = [];
      for (const [table, columns] of Object.entries(
        (getVersion(version).fingerprint.columns ?? {}) as Record<
          string,
          Set<string>
        >,
      )) {
        const declared = snapshot.tables.get(table);
        for (const column of columns) {
          if (!declared?.has(column)) missing.push(`${table}.${column}`);
        }
      }
      expect(missing.sort()).toEqual([]);
    });
  }

  it("the v2.0.0 snapshot matches what the 1.0.0 -> 2.0.0 upgrade produces", async () => {
    // The snapshot and the migration are two ways to reach the same
    // schema version, and a scratch v2.0.0 database built from the
    // snapshot is how the migration path gets verified end to end. If the
    // two disagree, that verification is checking the wrong shape, which
    // is part of how the v3 drift went unnoticed twice.
    const throughV2 = (await buildMigrationSchema(
      UPGRADE_CHAIN.slice(0, 1),
    )) as Schema;
    const snapshot = foldStatements(
      readSchemaStatements(FROZEN_SNAPSHOTS["2.0.0"]),
    ) as Schema;
    snapshot.tables.delete(META_TABLE);
    expect(sorted(throughV2.tables.keys())).toEqual(
      sorted(snapshot.tables.keys()),
    );
  });
});

describe("schema parity: the 2.0.0 -> 3.0.0 step declares what it actually adds", () => {
  it("addTables is exactly the set of tables that appear between 2.0.0 and 3.0.0", async () => {
    const at2 = (await buildMigrationSchema(
      UPGRADE_CHAIN.slice(0, 1),
    )) as Schema;
    const mod = await loadVersionFile("2.0.0-to-3.0.0.mjs");
    const derived = sorted(
      [...reachable.tables.keys()].filter((t) => !at2.tables.has(t)),
    );
    expect(
      sorted(mod.upgrade.addTables.map((t: { name: string }) => t.name)),
    ).toEqual(derived);
    // The downgrade has to undo exactly what the upgrade did, or a
    // rollback leaves orphaned tables behind.
    expect(
      sorted(
        mod.downgrade.dropTables.map((t: string | { name: string }) =>
          typeof t === "string" ? t : t.name,
        ),
      ),
    ).toEqual(derived);
  });

  it("dropColumns names columns a v2.0.0 database really has, and the downgrade restores every one", async () => {
    // AUDIT-011 drift-17 added the first dropColumns entries this upgrade
    // has ever had, which opens two new ways to be wrong, neither of which
    // any existing assertion would notice:
    //
    //   - DROP COLUMN IF EXISTS on a column that was never at v2.0.0 is a
    //     silent no-op. A typo'd table or column name looks exactly like a
    //     successful drop.
    //   - a dropped column the downgrade does not re-add means a rollback
    //     lands on something that is not a v2.0.0 shape, the same defect
    //     AUDIT-009 migration-04 fixed for indexes.
    const at2 = (await buildMigrationSchema(
      UPGRADE_CHAIN.slice(0, 1),
    )) as Schema;
    const mod = await loadVersionFile("2.0.0-to-3.0.0.mjs");
    const key = (c: { table: string; column: string }) =>
      `${c.table}.${c.column}`;
    const dropped = sorted((mod.upgrade.dropColumns ?? []).map(key));

    expect(
      dropped.filter((k) => {
        const [table, column] = k.split(".");
        return !at2.tables.get(table)?.has(column);
      }),
    ).toEqual([]);

    expect(sorted((mod.downgrade.addColumns ?? []).map(key))).toEqual(dropped);

    // And neither path may still be creating them: a column dropped by the
    // migration and re-added by instrumentation.ts would flip on every boot.
    const stillCreated: string[] = [];
    for (const k of dropped) {
      const [table, column] = k.split(".");
      if (canonical.tables.get(table)?.has(column)) {
        stillCreated.push(`${k} (instrumentation.ts)`);
      }
      if (reachable.tables.get(table)?.has(column)) {
        stillCreated.push(`${k} (migration path)`);
      }
    }
    expect(stillCreated.sort()).toEqual([]);
  });

  it("system_error_logs carries every column its writer inserts", () => {
    // AUDIT-012 obs-07 added request_id to this table AND to the INSERT in
    // lib/database/error-log-capture.ts. Landing either half alone is a
    // live defect in one direction (every capture throws "column does not
    // exist", silently, since the insert is fire-and-forget and swallows
    // its own failures) and dead schema in the other, which is exactly the
    // drift-17 problem. Parsed from the writer rather than listed here.
    const source = readFileSync(
      resolve(REPO_ROOT as string, "lib", "database", "error-log-capture.ts"),
      "utf8",
    );
    const inserted = /INSERT INTO system_error_logs\s*\(([^)]*)\)/i.exec(
      source,
    );
    expect(inserted, "no INSERT INTO system_error_logs found").not.toBeNull();
    const columns = inserted![1]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    expect(columns.length).toBeGreaterThan(2);
    for (const schema of [canonical, reachable]) {
      expect(
        columns.filter((c) => !schema.tables.get("system_error_logs")?.has(c)),
      ).toEqual([]);
    }
  });

  it("buildPlan emits one createTable step per declared table", async () => {
    const mod = await loadVersionFile("2.0.0-to-3.0.0.mjs");
    const plan = await buildPlan("2.0.0", "3.0.0");
    const created = plan.steps.filter(
      (s: { kind: string }) => s.kind === "createTable",
    );
    expect(created).toHaveLength(mod.upgrade.addTables.length);
  });

  it("planToStatements mirrors the real planner", async () => {
    // buildMigrationSchema derives the reachable schema through
    // planToStatements, a reimplementation of _planner.mjs's expandPlan.
    // If the two drift, every assertion above is measuring a plan the
    // migrator would never actually run. Folding both into a schema and
    // comparing proves the mirror is faithful without demanding the two
    // emit byte-identical SQL.
    const mod = await loadVersionFile("2.0.0-to-3.0.0.mjs");
    const plan = await buildPlan("2.0.0", "3.0.0");
    const fromPlanner: string[] = [];
    for (const step of plan.steps) {
      for (const part of splitStatements(step.sql)) fromPlanner.push(part);
    }
    const a = foldStatements(fromPlanner) as Schema;
    const b = foldStatements(planToStatements(mod.upgrade)) as Schema;
    expect(columnKeys(a)).toEqual(columnKeys(b));
    expect(sorted(a.indexes.keys())).toEqual(sorted(b.indexes.keys()));
  });
});
