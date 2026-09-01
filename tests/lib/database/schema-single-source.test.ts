import { describe, it, expect, vi } from "vitest";

/**
 * The guard that makes `npm run db:create` and the boot path structurally
 * incapable of building different schemas.
 *
 * What went wrong
 * ---------------
 * The schema used to live as ~4,400 lines of `pool.query(\`...\`)` inside
 * instrumentation.ts, and db:create rebuilt it by reading that file as TEXT.
 * Text extraction cannot resolve a template literal whose name comes from a
 * loop variable, and six statements in that file were exactly that, so the
 * extraction silently produced the literal string `ALTER TABLE ${fk.table}`
 * and dropped it. A db:create'd database was therefore missing four ON DELETE
 * SET NULL foreign keys, six CHECK constraints, the updated_at trigger
 * function and all seven of its triggers, and the 28 redundant-index drops,
 * with nothing but a warning nobody read.
 *
 * A second instance had the same shape: DDL owned by a helper module was
 * APPENDED after every other statement, so `CREATE INDEX ... ON staff_invites`
 * ran before `CREATE TABLE staff_invites` and the index quietly did not exist.
 *
 * Both are now impossible because there is one ordered array of steps and both
 * consumers EXECUTE it. This suite proves that rather than asserting it in a
 * comment: it runs applySchema twice, once wired exactly as the boot path
 * wires it and once exactly as db:create wires it, records every statement
 * each one issues, and compares the two lists.
 *
 * Both fakes stand in for a FRESH database, which is what makes the comparison
 * meaningful: every guard resolves the way it would on an empty schema, so
 * every step actually runs instead of being skipped.
 */

const mockQuery = vi.fn(async (_sql: string) => ({ rows: [] as unknown[] }));
vi.mock("@/lib/database/db", () => ({
  default: { query: (sql: string) => mockQuery(sql) },
}));

const { applySchema, SCHEMA_STEPS, stepQueries } =
  await import("@/lib/database/schema/index.mjs");
const { applyBootSchema } =
  await import("@/lib/database/boot/apply-boot-schema");
const { bootSchemaStatements, moduleStepStatements, splitStatements } =
  await import("@/scripts/_lib/_lib.schema-parity.mjs");

type Step = {
  id: string;
  sql?: string | string[];
  moduleSource?: string;
  guard?: { sql: string };
};

/**
 * A pg-shaped fake that records every query and answers the guards the way a
 * fresh database would: no constraint of ours exists yet, and the updated_at
 * columns the trigger steps look for do. Answering every guard "false" would
 * silently skip the seven trigger steps, which is exactly the coverage this
 * file exists to provide.
 *
 * Every guard in the schema is a `SELECT EXISTS (...)`, and no DDL statement
 * starts with SELECT, so the shape is enough to tell them apart. Matching on
 * the catalog name alone would misfire: the github_review_usage window
 * migration is real DDL that mentions information_schema.columns inside a DO
 * block.
 */
function recordingExecutor() {
  const queries: string[] = [];
  const query = async (sql: string) => {
    if (/^\s*SELECT\s+EXISTS/i.test(sql)) {
      return { rows: [{ e: /information_schema\.columns/i.test(sql) }] };
    }
    queries.push(sql);
    return { rows: [] };
  };
  return { queries, executor: { query } };
}

/** Collapse whitespace so two spellings of the same statement compare equal. */
const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();

/**
 * Recorded queries reduced to individual statements. The two consumers batch
 * differently on the three moduleSource steps (the boot path calls a helper
 * that runs its whole block in one query; db:create runs the same block
 * statement by statement), so statements, not query calls, are the level at
 * which "the same schema" is a meaningful claim. Splitting BEFORE normalising
 * matters: splitStatements strips `-- ` comments to end of line, and a
 * whitespace-collapsed string has no line ends left to stop at.
 */
const asStatements = (recorded: string[]): string[] =>
  recorded.flatMap((sql) => (splitStatements(sql) as string[]).map(norm));

/** What the boot path issues: applyBootSchema's own wiring, unmodified. */
async function bootStatements(): Promise<string[]> {
  const { queries, executor } = recordingExecutor();
  // The three moduleSource steps call helpers that import the pool directly,
  // so route that mock into the same recorder.
  mockQuery.mockImplementation(((sql: string) => executor.query(sql)) as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await applyBootSchema(executor as any, "VulnRadar");
  return asStatements(queries);
}

/** What `npm run db:create` issues: the same wiring that script uses. */
async function dbCreateStatements(): Promise<string[]> {
  const { queries, executor } = recordingExecutor();
  await applySchema(executor, {
    runModuleStep: async (step: Step) => {
      const statements = moduleStepStatements(step) as string[];
      for (const sql of statements) await executor.query(sql);
      return statements;
    },
  });
  return asStatements(queries);
}

describe("one schema, two consumers", () => {
  it("db:create issues exactly the statements the boot path issues, in order", async () => {
    const boot = await bootStatements();
    const dbCreate = await dbCreateStatements();

    // Not a set comparison. Order is the property that broke last time, and
    // the only thing that catches it is comparing the sequences.
    expect(dbCreate).toEqual(boot);
    expect(boot.length).toBeGreaterThan(250);
  });

  it("creates staff_invites before indexing it", async () => {
    // The second confirmed defect: module-owned DDL was appended after
    // everything else, so db:create ran the index first, warned, and left it
    // absent. Both orders are checked because both paths run the same list.
    for (const statements of [
      await bootStatements(),
      await dbCreateStatements(),
    ]) {
      const table = statements.findIndex((s) =>
        /CREATE TABLE IF NOT EXISTS staff_invites/i.test(s),
      );
      const index = statements.findIndex((s) =>
        /idx_staff_invites_invited_by/i.test(s),
      );
      expect(table).toBeGreaterThanOrEqual(0);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(table).toBeLessThan(index);
    }
  });

  it("issues the constraints and triggers the text extraction used to drop", async () => {
    const statements = await dbCreateStatements();
    const count = (re: RegExp) => statements.filter((s) => re.test(s)).length;

    // The four ON DELETE SET NULL foreign keys, by name. (Two more FKs of the
    // same shape, fk_admin_audit_target_user and fk_access_rules_created_by,
    // were always written out longhand and were never the ones going missing.)
    for (const name of [
      "fk_sessions_impersonated_by",
      "fk_security_alerts_resolved_by",
      "fk_system_settings_updated_by",
      "fk_broadcast_messages_sent_by",
    ]) {
      expect(
        count(
          new RegExp(
            `ADD CONSTRAINT ${name} FOREIGN KEY .* ON DELETE SET NULL`,
            "i",
          ),
        ),
        name,
      ).toBe(1);
    }
    // Six value-set CHECK constraints.
    expect(count(/ADD CONSTRAINT \w+_check CHECK \(.*\) NOT VALID/i)).toBe(6);
    // The trigger function and its seven triggers.
    expect(count(/CREATE OR REPLACE FUNCTION vulnradar_set_updated_at/i)).toBe(
      1,
    );
    expect(count(/CREATE TRIGGER trg_\w+_updated_at BEFORE UPDATE/i)).toBe(7);
    // The redundant-index drops.
    expect(count(/DROP INDEX CONCURRENTLY IF EXISTS/i)).toBe(28);
  });

  it("leaves no unresolved template interpolation in any step", async () => {
    // The exact failure signature: a statement that reached the database as
    // the literal text `ALTER TABLE ${fk.table}`. Nothing here may contain a
    // `${`, in either the SQL or a guard.
    const unresolved: string[] = [];
    for (const step of SCHEMA_STEPS as Step[]) {
      for (const sql of [
        ...(stepQueries(step) as string[]),
        step.guard?.sql ?? "",
      ]) {
        if (sql.includes("${")) unresolved.push(`${step.id}: ${norm(sql)}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("keeps the schema out of instrumentation.ts", async () => {
    // The schema lives in lib/database/schema. If DDL creeps back into the
    // boot file, the extraction problem comes back with it.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { REPO_ROOT } = await import("@/scripts/_lib/_lib.schema-parity.mjs");
    const source = readFileSync(
      resolve(REPO_ROOT as string, "instrumentation.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/CREATE\s+TABLE/i);
    expect(source).not.toMatch(/ALTER\s+TABLE/i);
    expect(source).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
  });

  it("flattens to the same statements the parity guard compares", async () => {
    // bootSchemaStatements() is what tests/scripts/migrate/schema-parity.test.ts
    // folds into the canonical schema. If it drifted from what applySchema
    // executes, that whole suite would be comparing something nothing runs.
    const flattened = (bootSchemaStatements() as string[]).map(norm);
    expect(await dbCreateStatements()).toEqual(flattened);
  });
});
