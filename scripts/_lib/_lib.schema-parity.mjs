/**
 * VulnRadar - Schema parity: derive the canonical schema from the boot
 * schema module and the reachable schema from the migration engine, so the
 * two can be compared instead of trusted.
 *
 * Why this exists
 * ---------------
 * The project has shipped the same defect twice (AUDIT-009 migration-01,
 * then AUDIT-013 migrate-01): tables and columns were added to the boot-time
 * schema and never added to scripts/migrate/versions/*.mjs, so
 * `npm run db:migrate` stamped schema_version=3.0.0 on a database that was
 * missing real tables. Both times the guard was a hand-maintained list of
 * names in a test file, which cannot fail for a name nobody remembered to
 * type.
 *
 * Everything here is derived. Nothing in this file enumerates a table or
 * column by hand except DELIBERATE_* below, which is the one place a real
 * exception has to be written down on purpose.
 *
 * What changed, and why it matters
 * --------------------------------
 * The canonical side used to be produced by reading instrumentation.ts as
 * TEXT and pulling the `pool.query(\`...\`)` template literals back out. That
 * cannot resolve a template literal whose name comes from a loop variable,
 * and six statements in that file were exactly that, so the extraction
 * silently dropped four ON DELETE SET NULL foreign keys, six CHECK
 * constraints, seven updated_at triggers and 28 redundant-index drops. The
 * boot schema now lives in lib/database/schema/ as an ordered array of steps
 * that boot and `npm run db:create` both EXECUTE, and the canonical side of
 * every check below is that same array flattened into SQL. There is no
 * TypeScript source text left to misparse, except for the frozen v1/v2
 * snapshots (which are historical files, deliberately never executed) and
 * the three helper modules a schema step names via moduleSource.
 *
 * Consumers:
 *   - tests/scripts/migrate/schema-parity.test.ts (the author-time guard)
 *   - tests/lib/database/schema-single-source.test.ts (proves boot and
 *     db:create run the same statements, in the same order)
 *   - scripts/create-fresh-db/create-fresh-db.mjs (applies the boot schema
 *     to a new database, and text-parses a frozen snapshot for v1/v2)
 *   - scripts/migrate/migrate.mjs (verifies the live schema after a run)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { SCHEMA_STEPS, stepQueries } from "../../lib/database/schema/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..", "..");

export const V1_SNAPSHOT_PATH = resolve(
  REPO_ROOT,
  "scripts",
  "create-fresh-db",
  "schemas",
  "instrumentation-v1.ts",
);

/**
 * The frozen boot-schema snapshots `npm run db:create` builds an older
 * database from, keyed by the schema version each one claims to be.
 *
 * Both carry a "DO NOT EDIT" header and both had been edited anyway
 * (AUDIT-013 migrate-07): the v2 file grew three v3.7-era support-ticket
 * tables, and the v1 file shipped a v3 table with different column names
 * than every other path. Nothing enforced the header, so
 * tests/scripts/migrate/schema-parity.test.ts checks each snapshot against
 * its registry fingerprint instead.
 */
export const FROZEN_SNAPSHOTS = Object.freeze({
  "1.0.0": V1_SNAPSHOT_PATH,
  "2.0.0": resolve(
    REPO_ROOT,
    "scripts",
    "create-fresh-db",
    "schemas",
    "instrumentation-v2.ts",
  ),
});
const VERSIONS_DIR = resolve(REPO_ROOT, "scripts", "migrate", "versions");

/**
 * The bookkeeping table the migrator itself owns. It is created by
 * scripts/migrate/_meta.mjs, not by any version file, so it is never part
 * of a schema diff.
 */
export const META_TABLE = "vulnradar_schema_meta";

/**
 * Tables that intentionally exist on the boot path only, with the reason.
 * Adding a name here has to be a conscious edit; leaving one out makes the
 * parity test fail, which is the point.
 *
 * Empty today. It is kept (rather than deleted) so that a future
 * genuinely-boot-only table has an obvious place to be declared instead of
 * being quietly dropped from the migration path again.
 */
export const DELIBERATE_BOOT_ONLY_TABLES = Object.freeze({});

/**
 * Columns that intentionally exist on the boot path only, keyed
 * "table.column". Same contract as DELIBERATE_BOOT_ONLY_TABLES.
 */
export const DELIBERATE_BOOT_ONLY_COLUMNS = Object.freeze({
  // Added by the v1 -> v2 upgrade as a plain column and then re-declared
  // inline on the v3 CREATE TABLE; the migration reaches it through
  // 1.0.0-to-2.0.0.mjs, so it is not drift. Listed because the v1 snapshot
  // predates it.
});

// ───────────────────────────────────────────────────────────────────────
// SQL extraction
// ───────────────────────────────────────────────────────────────────────

/**
 * The one regex that finds a schema statement block in a TypeScript
 * schema file. Exported as a factory because a /g regex carries mutable
 * lastIndex and must not be shared between callers.
 *
 * Only two kinds of file are still read this way: the frozen v1/v2
 * snapshots, and the three helper modules a schema step names via
 * moduleSource. The live schema is executed from lib/database/schema/, not
 * parsed, because of what this comment used to have to warn about.
 *
 * `pool\s*\.\s*query` rather than the literal "pool.query": several blocks
 * in the snapshots are written as `await pool\n  .query(...)`, which puts a
 * newline between `pool` and `.query`. A regex requiring the contiguous
 * token silently skips every one of them.
 *
 * `<[^()`]*?>` for the optional TypeScript generic, NOT `<[\s\S]*?>`: the
 * permissive form lets the generic swallow arbitrary source. At a
 * `pool.query<{ id: number; role: string | null }>("SELECT ...")` the
 * following `(` is not followed by a backtick, so the engine backtracks and
 * grows the generic until it finds SOME later `>` whose `(` IS followed by
 * one, consuming ~800 lines of real schema on the way. That is how 11 CREATE
 * TABLE statements (promoted_auto_tag_rules through support_ticket_shares)
 * went missing from every consumer of this extraction. Excluding parens and
 * backticks bounds the generic to the type argument it is meant to match.
 */
export function SQL_BLOCK_REGEX_SOURCE() {
  return /pool\s*\.\s*query(?:<[^()`]*?>)?\(\s*`([\s\S]*?)`[^`)]*\)/g;
}

/**
 * Pull every SQL statement out of a TypeScript schema file.
 */
export function extractSqlStatements(source) {
  const blockRegex = SQL_BLOCK_REGEX_SOURCE();
  const statements = [];
  let match;
  while ((match = blockRegex.exec(source)) !== null) {
    for (const part of splitStatements(match[1])) statements.push(part);
  }
  return statements;
}

/**
 * Split a SQL block on semicolons that are not inside a quoted string or a
 * dollar-quoted body. A naive `split(";")` cuts `$$ ... ; ... $$` function
 * bodies in half.
 */
export function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      buf += ch;
      i++;
      while (i < sql.length) {
        buf += sql[i];
        if (sql[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "$") {
      const tagMatch = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        buf += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (ch === ";") {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

// ───────────────────────────────────────────────────────────────────────
// Statement parsing
// ───────────────────────────────────────────────────────────────────────

const CONSTRAINT_KEYWORDS = new Set([
  "primary",
  "unique",
  "foreign",
  "check",
  "constraint",
  "exclude",
  "like",
]);

/**
 * Split a CREATE TABLE body on top-level commas, so a `CHECK (a IN (1, 2))`
 * or a multi-column `UNIQUE (a, b)` is one part rather than several.
 */
function splitTableBody(body) {
  const parts = [];
  let buf = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}

/** The body of a CREATE TABLE, paren-balanced. Null if `stmt` is not one. */
function createTableBody(stmt) {
  const head =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s*\(/i.exec(
      stmt,
    );
  if (!head) return null;
  const start = head.index + head[0].length;
  let depth = 1;
  let i = start;
  while (i < stmt.length && depth > 0) {
    if (stmt[i] === "(") depth++;
    else if (stmt[i] === ")") depth--;
    if (depth === 0) break;
    i++;
  }
  return { name: head[1], body: stmt.slice(start, i) };
}

/** "b,a" -> "a,b", lowercased and unquoted, so two spellings compare equal. */
function normalizeColumnTuple(columns) {
  return columns
    .split(",")
    .map((s) => s.trim().replace(/"/g, "").toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

/**
 * Every column tuple an `ON CONFLICT (...)` clause may legally name, per
 * table: PRIMARY KEY, inline `col ... UNIQUE`, table-level `UNIQUE (a, b)`,
 * `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (...)`, and plain (non-partial,
 * non-expression) CREATE UNIQUE INDEX.
 *
 * PostgreSQL rejects an ON CONFLICT target that matches no unique index with
 * "there is no unique or exclusion constraint matching the ON CONFLICT
 * specification", at execution time, on the write path. Partial and
 * expression unique indexes are deliberately excluded: inferring one needs
 * the ON CONFLICT clause to repeat its predicate or expression, so treating
 * them as ordinary targets would make this check pass for an upsert that
 * still throws.
 *
 * Returns Map<table, Set<"a,b">> with each tuple sorted and lowercased.
 */
export function parseUniqueTargets(statements) {
  const targets = new Map();
  const add = (table, columns) => {
    const key = normalizeColumnTuple(columns);
    if (!key || key.includes("(")) return;
    if (!targets.has(table)) targets.set(table, new Set());
    targets.get(table).add(key);
  };

  for (const stmt of statements) {
    const table = createTableBody(stmt);
    if (table) {
      for (const raw of splitTableBody(table.body)) {
        const line = raw
          .split("\n")
          .map((l) => l.replace(/--.*$/, ""))
          .join(" ")
          .trim();
        if (!line) continue;
        let m;
        if (
          (m = /^(?:CONSTRAINT\s+\w+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(
            line,
          )) ||
          (m = /^(?:CONSTRAINT\s+\w+\s+)?UNIQUE\s*\(([^)]*)\)/i.exec(line))
        ) {
          add(table.name, m[1]);
          continue;
        }
        const first = /^"?([A-Za-z_][A-Za-z0-9_]*)"?/.exec(line);
        if (!first || CONSTRAINT_KEYWORDS.has(first[1].toLowerCase())) continue;
        if (/\bPRIMARY\s+KEY\b/i.test(line) || /\bUNIQUE\b/i.test(line)) {
          add(table.name, first[1]);
        }
      }
      continue;
    }

    let m;
    if (
      (m =
        /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?[\s\S]*?ADD\s+CONSTRAINT\s+\w+\s+(?:PRIMARY\s+KEY|UNIQUE)\s*\(([^)]*)\)/i.exec(
          stmt,
        ))
    ) {
      add(m[1], m[2]);
      continue;
    }

    const index = parseCreateIndex(stmt);
    if (index && index.unique && !index.where && !index.columns.includes("(")) {
      add(index.table, index.columns);
    }
  }

  return targets;
}

/**
 * Every `INSERT INTO <table> ... ON CONFLICT (<cols>)` in a source file.
 *
 * The `[^;\`]` bound matters: an unbounded match runs past the end of one
 * SQL string and pairs an INSERT with the ON CONFLICT of a LATER statement,
 * which reports a table that has nothing to do with the clause.
 *
 * Returns [{ table, columns, line }] with columns normalized the same way
 * parseUniqueTargets normalizes its keys.
 */
export function findOnConflictTargets(source) {
  const re =
    /INSERT\s+INTO\s+"?([A-Za-z0-9_]+)"?[^;`]{0,4000}?ON\s+CONFLICT\s*\(([^)]*)\)/gi;
  const out = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push({
      table: m[1],
      columns: normalizeColumnTuple(m[2]),
      line: source.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

/** Columns declared inline in a CREATE TABLE body. */
export function parseCreateTable(stmt) {
  const head =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s*\(/i.exec(
      stmt,
    );
  if (!head) return null;
  const name = head[1];
  const bodyStart = head.index + head[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < stmt.length && depth > 0) {
    if (stmt[i] === "(") depth++;
    else if (stmt[i] === ")") depth--;
    if (depth === 0) break;
    i++;
  }
  const body = stmt.slice(bodyStart, i);

  const columns = new Set();
  let buf = "";
  let d = 0;
  const parts = [];
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (ch === "(") d++;
    if (ch === ")") d--;
    if (ch === "," && d === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);

  for (const raw of parts) {
    const line = raw
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join(" ")
      .trim();
    if (!line) continue;
    const first = /^"?([A-Za-z_][A-Za-z0-9_]*)"?/.exec(line);
    if (!first) continue;
    if (CONSTRAINT_KEYWORDS.has(first[1].toLowerCase())) continue;
    columns.add(first[1]);
  }
  return { name, columns };
}

/**
 * `ALTER TABLE t ADD COLUMN IF NOT EXISTS c ...` (possibly multi-line, and
 * possibly several comma-separated ADD COLUMN clauses in one statement,
 * which instrumentation.ts uses in a dozen places). Returns every column
 * the statement adds, not just the first.
 */
export function parseAddColumns(stmt) {
  const table =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s/i.exec(stmt);
  if (!table) return [];
  const out = [];
  const re = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi;
  let m;
  while ((m = re.exec(stmt)) !== null) {
    out.push({ table: table[1], column: m[1] });
  }
  return out;
}

/** `ALTER TABLE t DROP COLUMN IF EXISTS c`. */
export function parseDropColumn(stmt) {
  const m =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/i.exec(
      stmt,
    );
  return m ? { table: m[1], column: m[2] } : null;
}

/** `DROP TABLE IF EXISTS t`. */
export function parseDropTable(stmt) {
  const m = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/i.exec(stmt);
  return m ? m[1] : null;
}

/**
 * `CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON table [USING m] (cols)
 *  [WHERE pred]`. Returns the shape the parity test compares, normalized
 * so whitespace differences between the two sources do not register as
 * drift.
 */
export function parseCreateIndex(stmt) {
  const m =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s+ON\s+"?([A-Za-z0-9_]+)"?\s*(?:USING\s+([A-Za-z0-9_]+)\s*)?\(([\s\S]*)$/i.exec(
      stmt,
    );
  if (!m) return null;
  const rest = m[5];
  let depth = 1;
  let i = 0;
  while (i < rest.length && depth > 0) {
    if (rest[i] === "(") depth++;
    else if (rest[i] === ")") depth--;
    if (depth === 0) break;
    i++;
  }
  const columns = norm(rest.slice(0, i));
  const whereMatch = /\bWHERE\b([\s\S]*)$/i.exec(rest.slice(i + 1));
  return {
    name: m[2],
    unique: Boolean(m[1]),
    table: m[3],
    using: m[4] ? m[4].toLowerCase() : null,
    columns,
    where: whereMatch ? norm(whereMatch[1]) : null,
  };
}

function norm(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Fold a list of SQL statements into { tables, indexes }.
 *
 * `tables` is a Map<tableName, Set<columnName>>; `indexes` is a
 * Map<indexName, parsedIndex>. DROP statements are applied in order so a
 * create-then-drop pair (the github_review_usage year_month churn) nets
 * out correctly.
 */
export function foldStatements(statements, into = null) {
  const tables = into?.tables ?? new Map();
  const indexes = into?.indexes ?? new Map();

  for (const stmt of statements) {
    if (/^\s*SELECT\b/i.test(stmt)) continue;

    const created = parseCreateTable(stmt);
    if (created) {
      const existing = tables.get(created.name);
      if (existing) for (const c of created.columns) existing.add(c);
      else tables.set(created.name, new Set(created.columns));
      continue;
    }

    const dropped = /^\s*DROP\s+TABLE\b/i.test(stmt)
      ? parseDropTable(stmt)
      : null;
    if (dropped) {
      tables.delete(dropped);
      continue;
    }

    const added = parseAddColumns(stmt);
    if (added.length > 0) {
      for (const a of added) {
        if (!tables.has(a.table)) tables.set(a.table, new Set());
        tables.get(a.table).add(a.column);
      }
      continue;
    }

    const removed = parseDropColumn(stmt);
    if (removed) {
      tables.get(removed.table)?.delete(removed.column);
      continue;
    }

    const idx = parseCreateIndex(stmt);
    if (idx) {
      indexes.set(idx.name, idx);
      continue;
    }

    const dropIdx =
      /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/i.exec(
        stmt,
      );
    if (dropIdx) indexes.delete(dropIdx[1]);
  }

  return { tables, indexes };
}

// ───────────────────────────────────────────────────────────────────────
// The two sources
// ───────────────────────────────────────────────────────────────────────

/**
 * Read a FROZEN SNAPSHOT (scripts/create-fresh-db/schemas/instrumentation-
 * v{1,2}.ts) as text and return the statements it declares, in file order.
 *
 * Snapshots only. The live schema is bootSchemaStatements() below, which
 * reads the executed array rather than any source text.
 */
export function readSchemaStatements(path) {
  return extractSqlStatements(readFileSync(path, "utf8"));
}

/**
 * The SQL a single moduleSource schema step runs.
 *
 * Three schema steps do not carry their own SQL: their DDL is owned by a
 * TypeScript helper module that exports an idempotent ensure*() function
 * with its own unit test (lib/admin/staff-invites.ts,
 * lib/database/audit-log-archive.ts, lib/notifications/digest-schema.ts).
 * The boot path calls those helpers; every path that cannot import
 * TypeScript reads the DDL out of the same file, so there is still exactly
 * one copy of each.
 *
 * What used to be wrong was not the extraction, it was the POSITION: this
 * DDL was appended after every other statement, so `npm run db:create` ran
 * `CREATE INDEX ... ON staff_invites` before `CREATE TABLE staff_invites`,
 * warned, and left the index absent. These are ordered steps now.
 */
export function moduleStepStatements(step) {
  const path = resolve(REPO_ROOT, step.moduleSource);
  if (!existsSync(path)) return [];
  // These helpers take an `executor` (pool or transactional client) rather
  // than importing the pool, so match either receiver name.
  return extractSqlStatements(
    readFileSync(path, "utf8").replace(/executor\s*\.\s*query/g, "pool.query"),
  );
}

/**
 * Every statement the boot schema executes, in the order it executes them.
 *
 * This is the flattened form of lib/database/schema's SCHEMA_STEPS: the same
 * array, in the same order, that register() and `npm run db:create` both run.
 * Guard queries are excluded because they are read-only probes, not schema.
 */
export function bootSchemaStatements() {
  const statements = [];
  for (const step of SCHEMA_STEPS) {
    if (step.moduleSource) {
      for (const stmt of moduleStepStatements(step)) statements.push(stmt);
      continue;
    }
    for (const query of stepQueries(step)) {
      for (const stmt of splitStatements(query)) statements.push(stmt);
    }
  }
  return statements;
}

/**
 * The canonical schema: everything the boot path creates. The migrator's own
 * meta table is excluded, it is not application schema.
 */
export function readBootSchema() {
  const schema = foldStatements(bootSchemaStatements());
  schema.tables.delete(META_TABLE);
  return schema;
}

/**
 * The v1 baseline. A database the migration engine can be pointed at
 * starts here, so this is the floor the version files build on. Parsed
 * from the frozen v1 snapshot rather than listed by hand.
 */
export function readV1BaselineSchema(path = V1_SNAPSHOT_PATH) {
  const source = readFileSync(path, "utf8");
  const schema = foldStatements(extractSqlStatements(source));
  schema.tables.delete(META_TABLE);
  return schema;
}

/**
 * Expand one version file's `upgrade` (or `downgrade`) export into the SQL
 * the planner would generate, so both sources are compared as SQL rather
 * than as two differently-shaped object literals.
 *
 * Mirrors scripts/migrate/_planner.mjs's expandPlan. Kept in sync by
 * tests/scripts/migrate/schema-parity.test.ts, which asserts the two
 * produce the same statement count for the real plan.
 */
export function planToStatements(plan) {
  const out = [];
  for (const t of plan.addTables || []) {
    for (const s of splitStatements(t.sql)) out.push(s);
  }
  for (const t of plan.dropTables || []) {
    const name = typeof t === "string" ? t : t.name;
    out.push(`DROP TABLE IF EXISTS "${name}" CASCADE`);
  }
  for (const c of plan.addColumns || []) {
    out.push(
      `ALTER TABLE "${c.table}" ADD COLUMN IF NOT EXISTS ${c.column} ${c.definition || ""}`,
    );
  }
  for (const c of plan.dropColumns || []) {
    out.push(`ALTER TABLE "${c.table}" DROP COLUMN IF EXISTS "${c.column}"`);
  }
  for (const i of plan.addIndexes || []) {
    out.push(
      `CREATE ${i.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${i.name} ON "${i.table}"${
        i.using ? ` USING ${i.using}` : ""
      }(${i.columns})${i.where ? ` WHERE ${i.where}` : ""}`,
    );
  }
  for (const i of plan.dropIndexes || []) {
    const name = typeof i === "string" ? i : i.name;
    out.push(`DROP INDEX IF EXISTS "${name}"`);
  }
  for (const d of plan.dataUpdates || []) {
    for (const s of splitStatements(d.sql)) out.push(s);
  }
  return out;
}

/**
 * Load one version file by its filename in scripts/migrate/versions/.
 */
export async function loadVersionFile(filename) {
  const file = resolve(VERSIONS_DIR, filename);
  if (!existsSync(file)) throw new Error(`No such version file: ${filename}`);
  return import(pathToFileURL(file).href);
}

/**
 * Every upgrade file, in the order the migration engine walks them. A new
 * version file has to be appended here, and the parity test fails until it
 * is: the derived schema would otherwise stop at the previous version and
 * report the new version's own tables as boot-only drift.
 */
export const UPGRADE_CHAIN = Object.freeze([
  "1.0.0-to-2.0.0.mjs",
  "2.0.0-to-3.0.0.mjs",
]);

/**
 * The reachable schema: the v1 baseline with every registered upgrade
 * applied in order. This is what a database that only ever ran
 * `npm run db:migrate` actually has.
 *
 * `chain` exists so a caller can ask what the schema looks like PART WAY
 * along, which is how a test derives "the set of tables the 2.0.0 -> 3.0.0
 * step is supposed to add" without writing that set down by hand.
 */
export async function buildMigrationSchema(chain = UPGRADE_CHAIN) {
  const schema = readV1BaselineSchema();
  for (const filename of chain) {
    const mod = await loadVersionFile(filename);
    foldStatements(planToStatements(mod.upgrade), schema);
  }
  schema.tables.delete(META_TABLE);
  return schema;
}

/**
 * Diff two parsed schemas. `missingTables` / `missingColumns` are what
 * `have` is missing relative to `want`.
 */
export function diffSchemas(want, have) {
  const missingTables = [];
  const extraTables = [];
  const missingColumns = [];

  for (const table of want.tables.keys()) {
    if (!have.tables.has(table)) missingTables.push(table);
  }
  for (const table of have.tables.keys()) {
    if (!want.tables.has(table)) extraTables.push(table);
  }
  for (const [table, columns] of want.tables) {
    const other = have.tables.get(table);
    if (!other) continue;
    for (const column of columns) {
      if (!other.has(column)) missingColumns.push(`${table}.${column}`);
    }
  }

  missingTables.sort();
  extraTables.sort();
  missingColumns.sort();
  return { missingTables, extraTables, missingColumns };
}
