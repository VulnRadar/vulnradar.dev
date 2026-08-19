import { describe, it, expect } from "vitest";

/**
 * scripts/migrate/versions/*.mjs runs raw SQL through the migration runner
 * (scripts/** is excluded from coverage in vitest.config.ts and the repo
 * has no live-database test fixture -- see the header of
 * 2.0.0-to-3.0.0.test.ts). What IS meaningfully testable without a live
 * Postgres is the exact DDL/DML text and the wiring through _registry.mjs,
 * _planner.mjs, and _detect.mjs. So this suite asserts the three required
 * conversion behaviors at the SQL level (they are guaranteed by clauses in
 * the statement text) plus the registry/planner/detector wiring.
 *
 * v3.0.0 -> v3.5.0 moves uploaded avatars into Postgres: it adds the
 * user_avatars BYTEA table and converts every legacy base64 data:image
 * avatar_url into a row there.
 */
const migration = await import("@/scripts/migrate/versions/3.0.0-to-3.5.0.mjs");
const { transitions, findVersionFile, VERSIONS, getVersion, getRecommendedVersion } =
  await import("@/scripts/migrate/_registry.mjs");
const { buildPlan } = await import("@/scripts/migrate/_planner.mjs");
const { fingerprintDetect } = await import("@/scripts/migrate/_detect.mjs");

describe("3.0.0-to-3.5.0 migration: exports", () => {
  it("declares the correct from/to versions", () => {
    expect(migration.from).toBe("3.0.0");
    expect(migration.to).toBe("3.5.0");
  });

  it("upgrade adds the user_avatars table as one-row-per-user BYTEA storage", () => {
    const table = migration.upgrade.addTables.find(
      (t: { name: string }) => t.name === "user_avatars",
    );
    expect(table).toBeDefined();
    expect(table?.sql).toContain(
      "user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE",
    );
    expect(table?.sql).toContain("image_data BYTEA NOT NULL");
    expect(table?.sql).toContain("content_type TEXT NOT NULL");
    expect(table?.sql).toContain("updated_at TIMESTAMPTZ DEFAULT NOW()");
    // Created with IF NOT EXISTS so it is safe on a database that already
    // has the table (fresh boot creates it from instrumentation.ts).
    expect(table?.sql).toContain("CREATE TABLE IF NOT EXISTS user_avatars");
  });

  it("downgrade drops user_avatars", () => {
    expect(migration.downgrade.dropTables).toEqual(["user_avatars"]);
  });
});

describe("3.0.0-to-3.5.0 migration: base64 -> BYTEA data conversion", () => {
  const sql = () => {
    const step = migration.upgrade.dataUpdates.find(
      (d: { sql: string }) => d.sql.includes("user_avatars"),
    );
    expect(step).toBeDefined();
    return step!.sql as string;
  };

  it("is a pure-database step: reads the base64 column, decodes it, and writes the BYTEA table -- no filesystem", () => {
    const s = sql();
    // Selects the legacy base64 avatars straight off the users column...
    expect(s).toContain("FROM users");
    expect(s).toContain("data:image/png;base64,%");
    expect(s).toContain("data:image/jpeg;base64,%");
    // ...decodes base64 -> bytea and writes user_avatars. No fs anywhere.
    expect(s).toContain("decode(b64, 'base64')");
    expect(s).toContain("INSERT INTO user_avatars");
    expect(s).not.toMatch(/require\(|readFile|readdir|fs\./);
  });

  it("converts a base64 avatar into a user_avatars row and normalizes avatar_url", () => {
    const s = sql();
    expect(s).toContain("INSERT INTO user_avatars (user_id, image_data, content_type, updated_at)");
    // avatar_url is normalized to the serving route (with a cache-buster).
    expect(s).toContain("SET avatar_url =");
    expect(s).toContain("'/api/v3/avatar/'");
  });

  it("validates magic bytes + size the way lib/uploads/avatar.ts does", () => {
    const s = sql();
    // 5 MiB cap.
    expect(s).toContain("5242880");
    // PNG signature (89 50 4E 47 0D 0A 1A 0A).
    expect(s).toContain("get_byte(raw_bytes, 0) = 137");
    expect(s).toContain("get_byte(raw_bytes, 1) = 80");
    // JPEG signature (FF D8 FF).
    expect(s).toContain("get_byte(raw_bytes, 0) = 255");
    expect(s).toContain("get_byte(raw_bytes, 1) = 216");
  });

  it("is idempotent: skips a user already migrated, and a normalized row no longer matches the filter", () => {
    const s = sql();
    // Skip when a row already exists (re-run safety).
    expect(s).toContain("IF EXISTS (SELECT 1 FROM user_avatars a WHERE a.user_id = r.id) THEN");
    expect(s).toContain("ON CONFLICT (user_id) DO NOTHING");
    // The WHERE only ever matches data:image URLs; a converted row's
    // avatar_url becomes /api/v3/avatar/... and is never picked up again.
    expect(s).toContain("WHERE avatar_url LIKE 'data:image/png;base64,%'");
  });

  it("skips one malformed data URL without aborting the whole migration", () => {
    const s = sql();
    // Per-row exception handler: an undecodable/invalid row is logged and
    // skipped, not fatal.
    expect(s).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(s).toContain("RAISE WARNING");
    expect(migration.upgrade.dataUpdates[0].destructive).toBe(false);
  });
});

describe("3.0.0-to-3.5.0 migration: registry + planner + detector wiring", () => {
  it("registers 3.5.0 as the newest version and the recommendation for app v3.5.0", () => {
    expect(VERSIONS.map((v: { name: string }) => v.name)).toEqual([
      "1.0.0",
      "2.0.0",
      "3.0.0",
      "3.5.0",
    ]);
    expect(getRecommendedVersion("3.5.0").name).toBe("3.5.0");
  });

  it("the 3.5.0 fingerprint is v3.0.0 plus user_avatars", () => {
    const v350 = getVersion("3.5.0");
    const v300 = getVersion("3.0.0");
    expect(v350.fingerprint.tables.has("user_avatars")).toBe(true);
    // Every v3.0.0 table is still part of the v3.5.0 fingerprint.
    for (const t of v300.fingerprint.tables) {
      expect(v350.fingerprint.tables.has(t)).toBe(true);
    }
    expect(
      (v350.fingerprint.columns as Record<string, Set<string>>).user_avatars,
    ).toEqual(new Set(["user_id", "image_data", "content_type", "updated_at"]));
  });

  it("resolves the 3.0.0 -> 3.5.0 upgrade to this version file", () => {
    const steps = transitions("3.0.0", "3.5.0");
    expect(steps).toEqual([
      { from: "3.0.0", to: "3.5.0", direction: "upgrade" },
    ]);
    expect(findVersionFile(steps[0])).toMatch(/3\.0\.0-to-3\.5\.0\.mjs$/);
  });

  it("buildPlan emits the CREATE TABLE and the data conversion, in that order", async () => {
    const plan = await buildPlan("3.0.0", "3.5.0");
    const createIdx = plan.steps.findIndex(
      (s: { kind: string; sql: string }) =>
        s.kind === "createTable" && s.sql.includes("user_avatars"),
    );
    const dataIdx = plan.steps.findIndex(
      (s: { kind: string; sql: string }) =>
        s.kind === "dataUpdate" && s.sql.includes("INSERT INTO user_avatars"),
    );
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(dataIdx).toBeGreaterThan(createIdx);
  });

  it("downgrade plan drops user_avatars", async () => {
    const plan = await buildPlan("3.5.0", "3.0.0");
    const drop = plan.steps.find(
      (s: { kind: string; sql: string }) =>
        s.kind === "dropTable" && s.sql.includes("user_avatars"),
    );
    expect(drop).toBeDefined();
    expect(drop?.destructive).toBe(true);
  });

  it("a live v3.0.0 database (no user_avatars) still detects as 3.0.0, not 3.5.0", () => {
    const v300 = getVersion("3.0.0");
    const actual: Record<string, string[]> = {};
    for (const t of v300.fingerprint.tables) actual[t] = [];
    for (const [t, cols] of Object.entries(v300.fingerprint.columns)) {
      actual[t] = [...(cols as Set<string>)].map((c) => c.toLowerCase());
    }
    expect(fingerprintDetect(actual).version).toBe("3.0.0");

    // Once user_avatars exists (migration applied), it detects as 3.5.0.
    actual.user_avatars = [
      "user_id",
      "image_data",
      "content_type",
      "updated_at",
    ];
    expect(fingerprintDetect(actual).version).toBe("3.5.0");
  });
});
