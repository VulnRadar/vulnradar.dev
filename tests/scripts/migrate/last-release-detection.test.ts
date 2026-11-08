import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * gap-migration-upgrade-path-8 and -9: what the migrator makes of a database
 * the last released version left behind.
 *
 * Between `npm run db:migrate` and the first boot of a new release, a database
 * has everything the previous release built and nothing the new one adds. The
 * in-app updater runs the migrator in exactly that gap. The fixture is that
 * state, derived from the v3.9.1 tag's own schema module.
 */
const { fingerprintDetect } = await import("@/scripts/migrate/_detect.mjs");
const { getVersion, VERSIONS } =
  await import("@/scripts/migrate/_registry.mjs");
const {
  assessSameVersionRun,
  missingFromSchema,
  expectedSchemaFor,
  expectedSchemaFromRegistry,
} = await import("@/scripts/migrate/_verify.mjs");

const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "tests/scripts/migrate/fixtures/schema-v3.9.1.json"),
    "utf8",
  ),
) as { release: string; tables: Record<string, string[]> };

const latest = VERSIONS[VERSIONS.length - 1];
const introduced = latest.fingerprint.introducedThisRelease as Set<string>;

describe("detecting a database the last release left behind", () => {
  it("recognises it as the current schema version", () => {
    expect(fingerprintDetect(fixture.tables)).toMatchObject({
      version: latest.name,
      confidence: "high",
    });
  });

  it("requires no table the last release lacked", () => {
    // A boot-only table that detection requires is a database that can never
    // be recognised until it has already booted the release being installed.
    const absent = [...latest.fingerprint.tables].filter(
      (t) => !fixture.tables[t as string] && !introduced.has(t as string),
    );
    expect(
      absent,
      `These tables are not in ${fixture.release}. Add them to ` +
        "fingerprint.introducedThisRelease in scripts/migrate/_registry.mjs.",
    ).toEqual([]);
  });

  it("still expects every table it skips", () => {
    for (const table of introduced) {
      expect(latest.fingerprint.tables.has(table), table).toBe(true);
    }
  });

  it("does not put a column the last release lacked in the fingerprint", () => {
    const absent: string[] = [];
    for (const [table, columns] of Object.entries(
      (latest.fingerprint.columns ?? {}) as Record<string, Set<string>>,
    )) {
      for (const column of columns) {
        if (!fixture.tables[table]?.includes(column.toLowerCase())) {
          absent.push(`${table}.${column}`);
        }
      }
    }
    expect(absent).toEqual([]);
  });

  it("lists only tables that really are new in this release", () => {
    const stale = [...introduced].filter((t) => fixture.tables[t as string]);
    expect(
      stale,
      `${fixture.release} already has these, so they are not new any more.`,
    ).toEqual([]);
  });
});

describe("what the verification still expects", () => {
  it("keeps this release's tables in the expectation", async () => {
    const expected = await expectedSchemaFor(latest.name);
    for (const table of introduced) {
      expect(expected.has(table), `${table} left the expectation`).toBe(true);
    }
  });

  it("keeps them there when the version files cannot be read", () => {
    const expected = expectedSchemaFromRegistry(getVersion(latest.name));
    for (const table of introduced) {
      expect(expected.has(table)).toBe(true);
    }
  });
});

describe("assessSameVersionRun", () => {
  const gap = { missingTables: ["ai_chat_events"], missingColumns: [] };

  it("is clean when nothing is missing", () => {
    expect(
      assessSameVersionRun({
        missing: { missingTables: [], missingColumns: [] },
        recordedAppVersion: "3.9.1",
        appVersion: "4.0.0",
      }),
    ).toBe("complete");
  });

  it("expects gaps before this release has been recorded on the database", () => {
    // The updater path: it runs the migrator and only then restarts, so the
    // first boot of the new release has not created anything yet. Failing
    // here would fail every update.
    expect(
      assessSameVersionRun({
        missing: gap,
        recordedAppVersion: "3.9.1",
        appVersion: "4.0.0",
      }),
    ).toBe("pending-boot");
  });

  it("fails once the database is recorded at this release and is still short", () => {
    expect(
      assessSameVersionRun({
        missing: gap,
        recordedAppVersion: "4.0.0",
        appVersion: "4.0.0",
      }),
    ).toBe("incomplete");
  });

  it("compares versions numerically", () => {
    expect(
      assessSameVersionRun({
        missing: gap,
        recordedAppVersion: "3.10.0",
        appVersion: "3.9.1",
      }),
    ).toBe("incomplete");
  });

  it("treats a database with no recorded version as not yet at this release", () => {
    expect(
      assessSameVersionRun({
        missing: gap,
        recordedAppVersion: null,
        appVersion: "4.0.0",
      }),
    ).toBe("pending-boot");
  });
});

describe("missingFromSchema", () => {
  it("names missing tables and columns, sorted, and matches columns case-blind", () => {
    const expected = new Map([
      ["users", new Set(["id", "Email"])],
      ["zeta", new Set(["id"])],
      ["alpha", new Set(["id"])],
    ]);
    expect(missingFromSchema(expected, { users: ["id"] })).toEqual({
      missingTables: ["alpha", "zeta"],
      missingColumns: ["users.Email"],
    });
    expect(
      missingFromSchema(expected, {
        users: ["id", "email"],
        zeta: ["id"],
        alpha: ["id"],
      }),
    ).toEqual({ missingTables: [], missingColumns: [] });
  });
});

describe("the same-version run", () => {
  const src = readFileSync("scripts/migrate/migrate.mjs", "utf8");

  it("verifies the schema rather than only promising to", () => {
    const from = src.indexOf("Step 6: Execute");
    const noDdl = src.indexOf("No DDL changes needed", from);
    const realRun = src.indexOf("await runPlan(livePool, plan, {", noDdl);
    expect(noDdl).toBeGreaterThan(from);
    expect(src.slice(noDdl, realRun)).toContain("checkSameVersionSchema(");
  });

  it("no longer claims a safety net that does not run", () => {
    expect(src).not.toContain("no-op safety net");
    expect(src).not.toContain("safety-net re-run");
    expect(src).not.toContain("catch any missed steps");
  });
});
