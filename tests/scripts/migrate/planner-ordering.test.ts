import { describe, it, expect, vi, afterEach } from "vitest";
import path from "node:path";

/**
 * The planner's ordering guard (gap-migration-upgrade-path-1).
 *
 * expandPlan runs tables, then columns, then indexes, then dataUpdates,
 * whatever order a version file lists them in. 2.0.0-to-3.0.0.mjs had a
 * backfill inside its addTables SQL that read scan_history.team_id, which
 * only its addColumns creates, so every v1 and v2 upgrade failed on that one
 * statement and rolled back. Nothing here needs a database: the guard reads
 * the SQL, which is the point of it, since the unit tier never executes the
 * SQL and that is how the bug got past it.
 */

const FIXTURE = path.resolve(
  __dirname,
  "fixtures",
  "backfill-before-column.mjs",
);

const override = vi.hoisted(() => ({ file: null as string | null }));

vi.mock("@/scripts/migrate/_registry.mjs", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/scripts/migrate/_registry.mjs")>();
  return {
    ...real,
    findVersionFile: (step: Parameters<typeof real.findVersionFile>[0]) =>
      override.file ?? real.findVersionFile(step),
  };
});

const { buildPlan, expandPlan, findOrderingViolations } =
  await import("@/scripts/migrate/_planner.mjs");
const { VERSIONS } = await import("@/scripts/migrate/_registry.mjs");

const TRANSITION = { from: "2.0.0", to: "3.0.0", direction: "upgrade" };

interface Violation {
  step: { label: string; kind: string };
  column: string;
  addedBy: { label: string; kind: string };
}

function violationsOf(plan: Record<string, unknown>): Violation[] {
  return findOrderingViolations(expandPlan(plan, TRANSITION));
}

afterEach(() => {
  override.file = null;
});

describe("findOrderingViolations", () => {
  it("flags a backfill in addTables that reads a column addColumns adds", async () => {
    const fixture = await import(FIXTURE);
    const violations = violationsOf(fixture.upgrade);
    expect(violations).toHaveLength(1);
    expect(violations[0].column).toBe("scan_history.team_id");
    expect(violations[0].step.kind).toBe("createTable");
    expect(violations[0].addedBy.label).toBe(
      "ALTER TABLE scan_history ADD COLUMN team_id",
    );
  });

  it("accepts the same backfill once it is a dataUpdate", () => {
    const violations = violationsOf({
      addTables: [
        {
          name: "scan_history_teams",
          sql: `CREATE TABLE IF NOT EXISTS scan_history_teams (
                  scan_id INTEGER NOT NULL REFERENCES scan_history(id),
                  team_id INTEGER NOT NULL REFERENCES teams(id)
                )`,
        },
      ],
      addColumns: [
        { table: "scan_history", column: "team_id", definition: "INTEGER" },
      ],
      dataUpdates: [
        {
          label: "backfill",
          sql: "INSERT INTO scan_history_teams (scan_id, team_id) SELECT id, team_id FROM scan_history WHERE team_id IS NOT NULL",
        },
      ],
    });
    expect(violations).toEqual([]);
  });

  it("does not read a new table's own column definitions as a read of another table", () => {
    // scan_history_teams.team_id and scan_history.team_id share a name. The
    // CREATE TABLE defines the first and only points at scan_history(id).
    const violations = violationsOf({
      addTables: [
        {
          name: "scan_history_teams",
          sql: `CREATE TABLE IF NOT EXISTS scan_history_teams (
                  scan_id INTEGER NOT NULL REFERENCES scan_history(id),
                  team_id INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_sht_team ON scan_history_teams(team_id)`,
        },
      ],
      addColumns: [
        { table: "scan_history", column: "team_id", definition: "INTEGER" },
      ],
    });
    expect(violations).toEqual([]);
  });

  it("flags a foreign key in addTables that points at a column added later", () => {
    const violations = violationsOf({
      addTables: [
        {
          name: "scan_links",
          sql: "CREATE TABLE IF NOT EXISTS scan_links (public_id TEXT REFERENCES scan_history(public_id))",
        },
      ],
      addColumns: [
        { table: "scan_history", column: "public_id", definition: "TEXT" },
      ],
    });
    expect(violations.map((v) => v.column)).toEqual(["scan_history.public_id"]);
  });

  it("flags an addIndexes entry on a column only a dataUpdate adds", () => {
    // The github_review_usage.window_start case 2.0.0-to-3.0.0.mjs already
    // works around by hand: addIndexes runs before every dataUpdate.
    const violations = violationsOf({
      addIndexes: [
        {
          name: "idx_gru_window",
          table: "github_review_usage",
          columns: "user_id, window_start",
        },
      ],
      dataUpdates: [
        {
          label: "add window_start",
          sql: "ALTER TABLE github_review_usage ADD COLUMN IF NOT EXISTS window_start TIMESTAMPTZ",
        },
      ],
    });
    expect(violations.map((v) => v.column)).toEqual([
      "github_review_usage.window_start",
    ]);
    expect(violations[0].addedBy.label).toBe("add window_start");
  });

  it("does not flag an index on a column addColumns adds, which runs first", () => {
    const violations = violationsOf({
      addColumns: [
        { table: "scan_history", column: "team_id", definition: "INTEGER" },
      ],
      addIndexes: [
        {
          name: "idx_scan_history_team_id",
          table: "scan_history",
          columns: "team_id",
          where: "team_id IS NOT NULL",
        },
      ],
    });
    expect(violations).toEqual([]);
  });

  it("ignores a column name that only appears inside a string literal", () => {
    const violations = violationsOf({
      addTables: [
        {
          name: "notes",
          sql: `CREATE TABLE IF NOT EXISTS notes (body TEXT);
                INSERT INTO notes (body) SELECT 'team_id' FROM scan_history LIMIT 1`,
        },
      ],
      addColumns: [
        { table: "scan_history", column: "team_id", definition: "INTEGER" },
      ],
    });
    expect(violations).toEqual([]);
  });
});

describe("buildPlan's ordering guard", () => {
  it("refuses a version file that reads a column before adding it, before anything runs", async () => {
    override.file = FIXTURE;
    await expect(buildPlan("2.0.0", "3.0.0")).rejects.toThrow(
      /reads a column before the step that adds it[\s\S]*scan_history\.team_id[\s\S]*Move the statement that reads the column into dataUpdates/,
    );
  });

  it("plans every registered transition in both directions", async () => {
    const names = (VERSIONS as { name: string }[]).map((v) => v.name);
    for (const from of names) {
      for (const to of names) {
        if (from === to) continue;
        await expect(
          buildPlan(from, to),
          `${from} -> ${to}`,
        ).resolves.toBeDefined();
      }
    }
  });

  it("runs the scan_history_teams backfill after scan_history.team_id exists", async () => {
    const plan = await buildPlan("2.0.0", "3.0.0");
    const steps = plan.steps as { kind: string; sql: string; label: string }[];
    const columnAt = steps.findIndex(
      (s) => s.label === "ALTER TABLE scan_history ADD COLUMN team_id",
    );
    const backfillAt = steps.findIndex((s) =>
      /INSERT\s+INTO\s+scan_history_teams/i.test(s.sql),
    );
    expect(columnAt).toBeGreaterThan(-1);
    expect(backfillAt).toBeGreaterThan(columnAt);
    expect(steps[backfillAt].kind).toBe("dataUpdate");

    const createTable = steps.find(
      (s) => s.label === "CREATE TABLE scan_history_teams",
    );
    expect(createTable?.sql).not.toMatch(/INSERT\s+INTO/i);
  });
});
