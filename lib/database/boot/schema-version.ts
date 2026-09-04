/**
 * The schema-version gate: the first thing register() does against the
 * database, and the one thing that can stop the process before any DDL runs.
 *
 * The app requires MIN_SCHEMA_VERSION. If the connected database is older (or
 * has no meta row at all), startup is blocked so the app does not crash trying
 * to create indexes on columns that do not exist (CREATE INDEX idx_users_plan
 * on a v1 database where users.plan does not exist). The friendly boxes below
 * name the exact command to run.
 *
 * Split out of instrumentation.ts unchanged. It runs BEFORE the boot advisory
 * lock on purpose: it is a read plus at most one INSERT of the meta row, and a
 * second booting process reaching the same conclusion concurrently is
 * harmless (the INSERT is ON CONFLICT DO NOTHING).
 */

import { KNOWN_SCHEMA_VERSIONS } from "@/lib/config/constants";
import type { Pool } from "pg";
import { META_TABLE_SQL } from "@/lib/database/schema/index.mjs";

/**
 * Compare two "X.Y.Z" semver-style strings. Returns -1 if a < b, 0 if a == b,
 * 1 if a > b. Missing segments default to 0. Used to compare schema versions
 * stored in vulnradar_schema_meta.
 */
/**
 * Map a stored schema version onto a version that actually exists.
 *
 * The schema_version column has, over time, been written with APP versions,
 * so a database can claim to be at v3.5.0 when no such schema was ever
 * designed: the 3.x line has exactly one schema, 3.0.0. The boot banner then
 * reports a state that is not real, and an operator comparing two instances
 * sees a difference that does not exist.
 *
 * Resolution is always to the newest KNOWN version at or below the stored one.
 * Rounding down is safe: it cannot turn a passing check into a failing one,
 * because the stored value was already at least this high. Rounding UP would
 * assert that migrations ran when they did not, which is how a database gets
 * used with columns the app expects and the tables lack.
 *
 * Returned unchanged when the value is already real, when it is older than
 * every known version (that is a genuine downgrade and the caller must report
 * it), or when it cannot be parsed at all.
 */
export function normalizeSchemaVersion(
  stored: string,
  known: readonly string[] = KNOWN_SCHEMA_VERSIONS,
): string {
  if (!stored || known.includes(stored)) return stored;
  if (!/^\d+\.\d+\.\d+$/.test(stored)) return stored;
  let best: string | null = null;
  for (const candidate of known) {
    if (compareVersions(stored, candidate) < 0) continue;
    if (best === null || compareVersions(candidate, best) > 0) best = candidate;
  }
  return best ?? stored;
}

export function compareVersions(a: string, b: string): number {
  const av = a.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const bv = b.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The boxed console output both refusal paths below print. */
function printBox(title: string, body: string[]): void {
  const BOX_INNER = 72;
  const pad = (text: string) => {
    const right = BOX_INNER - 2 - text.length;
    return "║  " + text + " ".repeat(Math.max(0, right)) + "║";
  };
  const blank = "║" + " ".repeat(BOX_INNER) + "║";
  const lines = [
    "╔" + "═".repeat(BOX_INNER) + "╗",
    pad(title),
    blank,
    ...body.map((line) => (line === "" ? blank : pad(line))),
    "╚" + "═".repeat(BOX_INNER) + "╝",
  ];
  console.error("");
  console.error("\x1b[31m\x1b[1m");
  for (const ln of lines) console.error(ln);
  console.error("\x1b[0m");
}

export interface SchemaVersionContext {
  appName: string;
  appVersion: string;
  minSchemaVersion: string;
}

/**
 * Verify (and, on an empty database, stamp) the schema version. Calls
 * process.exit(1) rather than returning on every path the app must not boot
 * on, after firing an admin alert, exactly as it did inline.
 */
export async function ensureSchemaVersion(
  pool: Pool,
  { appName, appVersion, minSchemaVersion }: SchemaVersionContext,
): Promise<void> {
  try {
    await pool.query(META_TABLE_SQL);

    const metaRes = await pool.query(`
      SELECT schema_version, app_version, applied_at
      FROM vulnradar_schema_meta
      WHERE id = 1
    `);

    // A missing meta row means one of two very different things, and
    // conflating them made a fresh self-host impossible: the app refused to
    // start on an empty database, and the recovery command it printed lives in
    // scripts/, which the runtime image did not carry.
    //
    //   1. EMPTY database, no application tables at all. This is a first boot
    //      against a blank Postgres, which is exactly what `docker compose up
    //      -d` does. applySchema() builds the current schema from scratch, so
    //      there is nothing to migrate and nothing to protect against. Stamp
    //      the meta row and continue.
    //
    //   2. POPULATED database with no meta row. Ambiguous, and genuinely
    //      dangerous: it is probably a v1/v2 database that predates the meta
    //      table, where the schema would try to index columns that do not
    //      exist. Keep refusing and point at the migrator.
    //
    // `users` is the discriminator because every schema version back to v1 has
    // it, and the app cannot function without it.
    if (metaRes.rows.length === 0) {
      const existing = await pool.query<{ n: number }>(`
        SELECT COUNT(*)::int AS n
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      `);
      const isFreshDatabase = existing.rows[0].n === 0;

      if (isFreshDatabase) {
        await pool.query(
          `INSERT INTO vulnradar_schema_meta (id, schema_version, app_version, applied_at)
           VALUES (1, $1, $2, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [minSchemaVersion, appVersion],
        );
        console.log(
          `[${appName}] Empty database detected. Creating schema v${minSchemaVersion} from scratch.`,
        );
        // Fall through to the schema application in register().
      } else {
        printBox("SCHEMA VERSION NOT SET", [
          "This database has no schema version recorded.",
          "",
          "The database was probably created without going",
          "through the migration tool. To start the app, do one of:",
          "",
          "  1. Run the migration to detect and set the version:",
          "       npm run db:migrate",
          "",
          "  2. Or create a fresh database:",
          "       npm run db:create",
          "",
          "If you want to use a different database, update your",
          "DATABASE_URL in .env.local.",
        ]);
        const { sendAdminAlert } = await import("@/lib/admin/alert-webhook");
        await sendAdminAlert({
          event: "boot_schema_version_unset",
          severity: "critical",
          message: `${appName} failed to start: database has no schema version recorded.`,
        });
        process.exit(1);
      }
    }

    // Only meaningful when the row already existed. A database we just stamped
    // above is by definition at MIN_SCHEMA_VERSION, and the schema is built
    // right after this, so skip the downgrade check.
    const storedSchema =
      metaRes.rows.length > 0
        ? (metaRes.rows[0].schema_version as string)
        : minSchemaVersion;

    // Only three schema versions have ever existed, and the 3.x line has one:
    // the schema has not changed since 3.0.0. A stored value like "3.5.0" is
    // therefore an APP version that reached this column, not a schema that was
    // ever designed, and it makes the boot banner claim a database state that
    // does not exist.
    //
    // Normalising is only ever DOWNWARD, to the newest real version at or
    // below what is stored. That cannot weaken the check below (3.5.0 and
    // 3.0.0 both satisfy a 3.0.0 minimum) and cannot invent migrations that
    // never ran, which is what rounding UP would do. A value already on the
    // list, or one older than every entry, is left exactly as it is.
    const dbSchema = normalizeSchemaVersion(storedSchema);
    if (dbSchema !== storedSchema) {
      console.log(
        `[${appName}] Schema version v${storedSchema} is not a real schema version; reading it as v${dbSchema}.`,
      );
      await pool
        .query(
          `UPDATE vulnradar_schema_meta SET schema_version = $1 WHERE id = 1`,
          [dbSchema],
        )
        .catch(() => {
          // Best effort. The in-memory value above is what this boot uses, so
          // a read-only role or a locked row costs a repeated log line and
          // nothing else.
        });
    }
    if (compareVersions(dbSchema, minSchemaVersion) < 0) {
      printBox("SCHEMA VERSION MISMATCH", [
        "Database schema:    v" + dbSchema,
        "App requires:        v" + minSchemaVersion,
        "",
        "This app cannot start on this database.",
        "It expects columns and tables that don't exist yet.",
        "",
        "To fix:",
        "  1. Run the migration to upgrade the database:",
        "       npm run db:migrate",
        "",
        "  2. Or, if you want to use a different (newer) database,",
        "     update DATABASE_URL in .env.local.",
        "",
        "The app will not start until the database is upgraded.",
      ]);
      const { sendAdminAlert } = await import("@/lib/admin/alert-webhook");
      await sendAdminAlert({
        event: "boot_schema_version_mismatch",
        severity: "critical",
        message: `${appName} failed to start: database schema v${dbSchema} is older than the required v${minSchemaVersion}. Run npm run db:migrate.`,
      });
      process.exit(1);
    }

    console.log(
      `[${appName}] Schema version: v${dbSchema} (required: v${minSchemaVersion}) ✓`,
    );
  } catch (schemaError) {
    console.error(`[${appName}] Schema version check failed:`, schemaError);
    const { sendAdminAlert } = await import("@/lib/admin/alert-webhook");
    await sendAdminAlert({
      event: "boot_schema_check_failed",
      severity: "critical",
      message: `${appName} failed to start: the schema version check itself errored.`,
    });
    process.exit(1);
  }
}
