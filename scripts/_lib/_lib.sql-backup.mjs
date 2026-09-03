/**
 * VulnRadar - Plain-SQL database dump written in JavaScript, for hosts with
 * no pg_dump.
 *
 * Why this exists
 * ---------------
 * `npm run db:backup` shells out to `pg_dump`. The official Docker image
 * installs postgresql-client for exactly that reason, so image users are
 * fine. Game-panel installs (Pterodactyl / Pelican) that run VulnRadar from
 * source are not: the Node egg gives a bare runtime, the operator does not
 * control the image and has no root inside the container, so postgresql-client
 * cannot be added. On those hosts `npm run db:backup` has always failed with
 * "pg_dump not found", which means they have had NO backup at all. For them
 * this is not a fallback, it is the only backup that can ever run, and the
 * same goes for the restore: nothing in this file shells out, so it also
 * works on a box with no `psql`.
 *
 * What it emits
 * -------------
 * Plain SQL, the same shape `pg_dump --format=plain` produces: a SET
 * preamble, DDL, `COPY ... FROM stdin` data blocks, then constraints,
 * indexes, triggers and `setval()` calls. That is a deliberate choice over a
 * bespoke container format. A backup only our own tooling can read is a
 * lock-in, and the moment it matters is the moment our tooling may not be
 * working. This file can be restored by anything that speaks SQL:
 *
 *     psql -v ON_ERROR_STOP=1 --single-transaction -f dump.sql mydb
 *
 * and equally by pgAdmin, DBeaver or a managed provider's import tool.
 *
 * The DDL is read out of the live catalog, and PostgreSQL itself renders the
 * hard parts: pg_get_constraintdef, pg_get_indexdef, pg_get_triggerdef,
 * pg_get_functiondef and pg_get_viewdef all return text Postgres guarantees it
 * can parse back. What is hand-rolled here is only the mechanical shell:
 * CREATE TABLE column lines, CREATE SEQUENCE parameters, ALTER TABLE ... SET
 * DEFAULT and setval. Object order follows pg_dump's: functions and sequences
 * before tables, defaults after sequences, data before constraints and
 * indexes, foreign keys last, so a foreign key can never be violated by the
 * order rows arrive in.
 *
 * How our own restore reads it without a SQL parser
 * ------------------------------------------------
 * Every executable statement is introduced by a `--#VR:` marker line. To psql
 * those are comments and mean nothing; to restoreSqlDump they are the frame
 * that makes splitting the file exact instead of heuristic. That matters
 * because the schema contains dollar-quoted plpgsql (`$fn$ ... $fn$`), which a
 * naive split-on-semicolon would tear in half. We generate the file, so we can
 * afford to be strict about its shape and skip writing a SQL tokenizer.
 *
 * What this does NOT capture (say it plainly, do not let an operator assume
 * otherwise)
 * ----------------------------------------------------------------------
 * Only the `public` schema, and within it: extensions, sequences, tables,
 * columns, defaults, constraints, indexes, functions, triggers, views and
 * table data. It does NOT capture roles, ownership, GRANTs, row-level
 * security policies, materialized views, partitioned tables, table
 * inheritance, foreign tables, custom types (enum/domain/range), large
 * objects, tablespaces, comments, publications/subscriptions, or any other
 * schema. Anything in that list which is actually PRESENT makes the dump
 * refuse to run rather than quietly write an incomplete file (see
 * findUnsupportedObjects); none of it exists in VulnRadar's own schema.
 *
 * `pg_dump` covers all of it, which is why it stays the default wherever it
 * is installed.
 *
 * Value encoding
 * --------------
 * Every value is PostgreSQL's own TEXT OUTPUT for that column's type, taken
 * with `col::text` in the SELECT, then escaped with COPY's text-format rules.
 * A restore hands it back to the type's INPUT function (COPY's own, under
 * psql; a bind parameter, under our restore). Output function out, input
 * function back in: the round trip is the type's, not a guess made from
 * whichever JavaScript value the driver happened to build. In particular
 * `numeric` never touches a JS float, `jsonb` is never re-serialized by
 * JSON.stringify, and `timestamptz` is never rendered in a local timezone.
 *
 * Six session GUCs are pinned for the dump so that text is deterministic and
 * reversible; see DUMP_SESSION_GUCS for what each one buys.
 */

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import {
  getTableNames,
  getPrimaryKeys,
  getForeignKeys,
} from "./_lib.schema-introspect.mjs";
import {
  orderTablesForCopy,
  TRANSIENT_TABLES,
  META_TABLE,
} from "./_lib.table-copy.mjs";

/** Written into the file's marker line. Changing it invalidates old dumps. */
export const DUMP_FORMAT = "vulnradar-sql-dump";

/** Bumped only when an older reader could no longer make sense of the file. */
export const DUMP_FORMAT_VERSION = 1;

/** Prefix of every machine-readable marker. A SQL comment to everything else. */
export const MARKER_PREFIX = "--#VR:";

/**
 * Printed by the CLI, written into the file header, and repeated by the
 * restore. An operator must never be left believing this is pg_dump.
 */
export const DUMP_LIMITS_NOTICE = [
  "This dump was written by VulnRadar's built-in dumper, not by pg_dump.",
  "It contains the public schema only: extensions, sequences, tables,",
  "columns, defaults, constraints, indexes, functions, triggers, views and",
  "all table data. It does NOT contain roles, ownership, GRANTs, row-level",
  "security policies, materialized views, partitioned tables, foreign tables,",
  "custom types, large objects, tablespaces or any other schema. pg_dump",
  "captures those; use it instead wherever it is installed.",
];

/**
 * Pinned for the duration of the dump transaction. Each one turns a
 * session-dependent rendering into a fixed, reversible one.
 */
export const DUMP_SESSION_GUCS = Object.freeze([
  // ISO renders a timestamp as `2026-09-02 03:04:05.678901+00`, which every
  // Postgres parses back identically. Every other DateStyle is ambiguous.
  "SET LOCAL DateStyle = 'ISO, MDY'",
  // With TimeZone=UTC a timestamptz carries an explicit +00 offset, so the
  // restoring session's timezone cannot shift the instant. A `timestamp
  // without time zone` has no offset either way: it is a wall-clock reading
  // and comes back as the same wall-clock reading.
  "SET LOCAL TimeZone = 'UTC'",
  "SET LOCAL IntervalStyle = 'postgres'",
  // `\x48656c6c6f`. bytea's input function auto-detects the \x prefix, so hex
  // round-trips whatever the restoring server's bytea_output happens to be.
  "SET LOCAL bytea_output = 'hex'",
  // On PG12+ any positive value selects the shortest text that reads back as
  // the identical float; before that it forced maximum precision. Either way
  // a float survives the round trip.
  "SET LOCAL extra_float_digits = 3",
  // Empty search_path is what makes pg_get_*def() schema-qualify every name
  // it renders, so the emitted SQL does not depend on the restoring session's
  // search_path. pg_dump does exactly this. pg_catalog stays implicitly
  // visible, and every query in this file qualifies its own tables.
  "SET LOCAL search_path = ''",
  // The pool sets a 30s statement_timeout, which is right for the app and
  // wrong for one page over a large table on a slow disk.
  "SET LOCAL statement_timeout = 0",
]);

/**
 * The preamble the file opens with, mirroring pg_dump --format=plain.
 * standard_conforming_strings matters most: it is what makes a backslash in a
 * string literal an ordinary backslash.
 */
export const DUMP_PREAMBLE = Object.freeze([
  "SET statement_timeout = 0",
  "SET lock_timeout = 0",
  "SET idle_in_transaction_session_timeout = 0",
  "SET client_encoding = 'UTF8'",
  "SET standard_conforming_strings = on",
  "SELECT pg_catalog.set_config('search_path', '', false)",
  "SET check_function_bodies = false",
  "SET xmloption = content",
  "SET client_min_messages = warning",
  "SET row_security = off",
]);

/**
 * Rows fetched per page, to start with. Deliberately small: the driver holds
 * a whole page in memory and one scan_history row can carry a multi-megabyte
 * JSONB result. It grows for narrow tables (see nextPageRows), which is where
 * throughput actually matters. These panels are often memory-capped, so this
 * is a hard requirement rather than a nicety.
 */
export const INITIAL_PAGE_ROWS = 25;
export const MIN_PAGE_ROWS = 1;
export const MAX_PAGE_ROWS = 1000;

/** Target bytes per page. The knob that bounds memory on a capped container. */
export const PAGE_BYTE_BUDGET = 4 * 1024 * 1024;

/** Postgres refuses more than 65535 bind parameters in one statement. */
const MAX_BIND_PARAMS = 60000;

/** Accumulated bytes before a restore INSERT batch is flushed. */
export const RESTORE_BATCH_BYTE_BUDGET = 4 * 1024 * 1024;

/** Double-quote an identifier for interpolation into SQL. */
export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Single-quote a string literal. Only the quote is doubled, because the
 * preamble sets standard_conforming_strings = on, under which a backslash in
 * a literal is just a backslash.
 */
export function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** `public."users"`, for a name that came out of the catalog. */
export function qualify(table) {
  return `public.${quoteIdent(table)}`;
}

// ── COPY text format ───────────────────────────────────────────────────────
//
// The whole reason the data goes out as COPY rather than INSERT: its escaping
// surface is tiny and completely specified, where general SQL literal quoting
// is neither. Exactly seven characters are special, NULL is the two-character
// sequence \N, and everything else -- quotes, braces, tabs inside JSON,
// accents, emoji, any UTF-8 -- passes through as itself.
//
// A NUL byte cannot appear here at all: PostgreSQL forbids it in text values,
// and in bytea it is rendered as the four characters `\x00`, never as a raw
// zero byte. So it needs no escape and cannot be produced by any column.

const COPY_ESCAPES = {
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\v": "\\v",
};

/**
 * One field. `null` becomes `\N`; an empty string stays an empty field, and
 * the two are therefore distinguishable, which is the single most important
 * property of this encoding.
 *
 * A single regex pass, not a chain of replaces: a chain would have to escape
 * the backslash first and would then re-escape the backslashes it just
 * introduced. One pass visits each character exactly once.
 */
export function encodeCopyValue(value) {
  if (value === null || value === undefined) return "\\N";
  return String(value).replace(/[\\\b\f\n\r\t\v]/g, (ch) => COPY_ESCAPES[ch]);
}

/** One row: tab-separated encoded fields. */
export function encodeCopyRow(values) {
  return values.map(encodeCopyValue).join("\t");
}

/**
 * Inverse of encodeCopyValue.
 *
 * `\N` is NULL only when it is the WHOLE field, which is why the check is on
 * the field and not on a two-character sequence inside it: a value that
 * literally is the two characters backslash-N was written as `\\N` and comes
 * back as `\N`.
 *
 * Octal and hex backslash escapes are legal COPY input that this writer never
 * emits, so meeting one means the file did not come from here. Throwing is
 * deliberate: decoding it wrongly would put silently corrupted bytes into the
 * database, which is the one outcome a restore must never produce.
 */
export function decodeCopyValue(field) {
  if (field === "\\N") return null;
  if (!field.includes("\\")) return field;
  let out = "";
  for (let i = 0; i < field.length; i++) {
    if (field[i] !== "\\") {
      out += field[i];
      continue;
    }
    const next = field[++i];
    if (next === undefined) {
      throw new Error("COPY data ends with a dangling backslash.");
    }
    if (next === "x" || (next >= "0" && next <= "7")) {
      throw new Error(
        `COPY data contains a \\${next} numeric escape. This dumper never ` +
          "writes one, so this file was not produced by VulnRadar and cannot " +
          "be decoded safely here. Restore it with psql instead.",
      );
    }
    switch (next) {
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "v":
        out += "\v";
        break;
      default:
        // Postgres's own rule for an unrecognised escape: the backslash is
        // dropped and the character stands for itself. That covers `\\`.
        out += next;
    }
  }
  return out;
}

/** One row of COPY text back into an array of values. */
export function decodeCopyRow(line) {
  return line.split("\t").map(decodeCopyValue);
}

// ── Planning and pagination ────────────────────────────────────────────────

/**
 * Which tables the dump writes data for, and in what order.
 *
 * Reuses TRANSIENT_TABLES, META_TABLE and orderTablesForCopy so a table
 * classified one way by `npm run db:create` is classified the same way here.
 *
 * It deliberately does NOT call planTableCopy: that function drops every
 * zero-row table out of the copy set, which is right for a clone ("nothing to
 * lose") and wrong for a backup. Every table gets a COPY block here even when
 * it is empty, exactly as pg_dump emits one, so the file describes the whole
 * database rather than only its populated half.
 *
 * The skipped tables still get their SCHEMA emitted; it is only their rows
 * that are left out, and every one of them is a cache or a one-time token
 * that is meaningless minutes later.
 *
 * @param {object} input
 * @param {string[]} input.tables every base table in the public schema
 * @param {Array<{childTable: string, parentTable: string}>} [input.fkEdges]
 */
export function planDumpTables({ tables, fkEdges = [] }) {
  const skipped = [];
  const included = [];
  for (const table of tables) {
    if (table === META_TABLE) {
      // Kept, unlike in a clone: a backup's whole point is to reproduce the
      // database it came from, and the schema version is part of that.
      included.push(table);
      continue;
    }
    if (table in TRANSIENT_TABLES) {
      skipped.push({ table, reason: TRANSIENT_TABLES[table] });
      continue;
    }
    included.push(table);
  }
  const { order, cycles } = orderTablesForCopy(included, fkEdges);
  skipped.sort((a, b) => a.table.localeCompare(b.table));
  return { order, skipped, cycles };
}

/**
 * Grow or shrink the page so one page stays near PAGE_BYTE_BUDGET. A shrink
 * only takes effect on the NEXT page, which is why the initial size is small
 * rather than optimistic.
 */
export function nextPageRows(currentRows, lastPageBytes) {
  if (lastPageBytes > PAGE_BYTE_BUDGET) {
    return Math.max(MIN_PAGE_ROWS, Math.floor(currentRows / 2));
  }
  if (lastPageBytes * 4 < PAGE_BYTE_BUDGET) {
    return Math.min(MAX_PAGE_ROWS, currentRows * 2);
  }
  return currentRows;
}

/**
 * How many rows one multi-row INSERT can carry without exceeding Postgres's
 * bind-parameter ceiling. Always at least one: a table cannot have more than
 * 1600 columns, so the floor is never actually reached.
 */
export function maxRowsPerInsert(columnCount) {
  if (columnCount <= 0) return 1;
  return Math.max(1, Math.floor(MAX_BIND_PARAMS / columnCount));
}

/**
 * One page of rows from `table`, ordered so keyset pagination is total and
 * stable.
 *
 * Keyset, never OFFSET: OFFSET re-scans and discards every earlier row, so a
 * large table costs O(n^2), and it silently skips rows when the table changes
 * underneath it. The cursor is the previous page's last key.
 *
 * Cursor parameters carry an explicit `::<type>` cast. The value came out of
 * that same column so the cast cannot lose anything, and it settles how
 * Postgres would type a parameter inside a row-wise comparison.
 *
 * With no usable primary key the order is `ctid`, the physical row address:
 * total and unique within one snapshot, which is all the pagination needs,
 * and the whole dump runs in one REPEATABLE READ snapshot. ctid is then
 * selected as an extra trailing column purely to carry the cursor; it is
 * trimmed before the row is written.
 */
export function buildPageQuery({
  table,
  columns,
  keyColumns,
  keyTypes,
  hasCursor,
  limit,
}) {
  const rows = Number(limit);
  if (!Number.isInteger(rows) || rows < 1) {
    throw new Error(`Page limit must be a positive integer, got ${limit}`);
  }
  const byCtid = keyColumns.length === 0;
  const selected = columns.map((c) => `${quoteIdent(c)}::text`);
  if (byCtid) selected.push("ctid::text");

  let where = "";
  if (hasCursor) {
    if (byCtid) {
      where = " WHERE ctid > $1::tid";
    } else if (keyColumns.length === 1) {
      where = ` WHERE ${quoteIdent(keyColumns[0])} > $1::${keyTypes[0]}`;
    } else {
      const lhs = keyColumns.map(quoteIdent).join(", ");
      const rhs = keyColumns
        .map((_, i) => `$${i + 1}::${keyTypes[i]}`)
        .join(", ");
      where = ` WHERE (${lhs}) > (${rhs})`;
    }
  }

  const orderBy = byCtid
    ? "ctid ASC"
    : keyColumns.map((c) => `${quoteIdent(c)} ASC`).join(", ");

  return (
    `SELECT ${selected.join(", ")} FROM ${qualify(table)}` +
    `${where} ORDER BY ${orderBy} LIMIT ${rows}`
  );
}

/**
 * A multi-row INSERT, used by our own restore in place of COPY FROM STDIN.
 *
 * The placeholders carry no cast on purpose. node-postgres sends parameters
 * with an unspecified type OID, so the server resolves each from the INSERT's
 * target column and parses the text with that type's input function, which is
 * exactly what COPY would have done with the same text. A cast here would add
 * a second opinion about the type, and an explicit cast to a length-limited
 * character type truncates silently.
 */
export function buildInsertQuery({ table, columns, rowCount }) {
  if (rowCount < 1) throw new Error("buildInsertQuery needs at least one row");
  const colList = columns.map(quoteIdent).join(", ");
  const tuples = [];
  let param = 0;
  for (let r = 0; r < rowCount; r++) {
    tuples.push(`(${columns.map(() => `$${++param}`).join(", ")})`);
  }
  return `INSERT INTO ${qualify(table)} (${colList}) VALUES ${tuples.join(", ")}`;
}

// ── Catalog introspection ──────────────────────────────────────────────────

/**
 * Objects this dumper does not know how to write out. Their presence makes
 * the dump refuse rather than write a file that is quietly missing part of
 * the database, because a backup that restores incompletely is worse than one
 * that never claimed to exist.
 *
 * None of these exist in VulnRadar's own schema, so this never fires today.
 * It fires the day somebody adds one, which is the point.
 */
export async function findUnsupportedObjects(client) {
  const res = await client.query(`
    SELECT 'materialized view: ' || c.relname AS item
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'm'
    UNION ALL
    SELECT 'partitioned table: ' || c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'p'
    UNION ALL
    SELECT 'foreign table: ' || c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'f'
    UNION ALL
    SELECT 'inherited table: ' || c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'custom type: ' || t.typname
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'r')
    UNION ALL
    SELECT 'row-level security enabled: ' || c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    UNION ALL
    SELECT 'non-public schema: ' || n.nspname
      FROM pg_namespace n
     WHERE n.nspname NOT IN ('public', 'information_schema', 'pg_catalog', 'pg_toast')
       AND n.nspname NOT LIKE 'pg\\_temp%'
       AND n.nspname NOT LIKE 'pg\\_toast_temp%'
    ORDER BY 1
  `);
  return res.rows.map((r) => r.item);
}

/** Extensions to recreate, excluding plpgsql (present in every database). */
export async function getExtensions(client) {
  const res = await client.query(`
    SELECT e.extname, n.nspname
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname <> 'plpgsql'
     ORDER BY e.extname
  `);
  return res.rows.map((r) => ({ name: r.extname, schema: r.nspname }));
}

/**
 * Every column of every base table in `public`, in attribute order.
 *
 * Not scripts/_lib/_lib.schema-introspect.mjs's getColumnsDetailed, and the
 * difference matters twice: that helper lowercases the column name (which
 * would silently mis-address a mixed-case identifier) and it reports
 * information_schema's portable `data_type`, which is the literal string
 * "ARRAY" for any array and "USER-DEFINED" for an enum. Neither can be
 * written into a CREATE TABLE or used as a cast target. format_type() gives
 * the real one (`text[]`, `numeric(10,2)`, `timestamp with time zone`).
 */
export async function getTableColumns(client) {
  const res = await client.query(`
    SELECT c.relname AS table_name,
           a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS pg_type,
           a.attnotnull AS not_null,
           a.attidentity AS identity,
           a.attgenerated AS generated,
           pg_get_expr(d.adbin, d.adrelid) AS default_expr
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum
  `);
  const byTable = {};
  for (const row of res.rows) {
    (byTable[row.table_name] ||= []).push({
      name: row.column_name,
      pgType: row.pg_type,
      notNull: row.not_null,
      identity: row.identity || "",
      generated: row.generated || "",
      defaultExpr: row.default_expr,
    });
  }
  return byTable;
}

/**
 * Sequences, with the column that owns them where there is one.
 *
 * `deptype` distinguishes the two kinds: 'a' is a SERIAL column's sequence,
 * which is a real sequence object plus a DEFAULT and has to be created
 * explicitly; 'i' is an IDENTITY column's, which the column's own GENERATED
 * clause creates, so emitting a CREATE SEQUENCE for it would collide. Both
 * still need a setval.
 */
export async function getSequences(client) {
  const res = await client.query(`
    SELECT c.relname AS name,
           s.seqtypid::regtype::text AS data_type,
           s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle,
           pg_sequence_last_value(c.oid) AS last_value,
           dep.deptype AS dep_type,
           tc.relname AS owner_table,
           oa.attname AS owner_column
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_sequence s ON s.seqrelid = c.oid
      LEFT JOIN pg_depend dep
        ON dep.objid = c.oid
       AND dep.classid = 'pg_class'::regclass
       AND dep.refclassid = 'pg_class'::regclass
       AND dep.deptype IN ('a', 'i')
      LEFT JOIN pg_class tc ON tc.oid = dep.refobjid
      LEFT JOIN pg_attribute oa
        ON oa.attrelid = dep.refobjid AND oa.attnum = dep.refobjsubid
     WHERE n.nspname = 'public' AND c.relkind = 'S'
     ORDER BY c.relname
  `);
  return res.rows.map((r) => ({
    name: r.name,
    dataType: r.data_type,
    // bigint columns come back from pg as strings, which is what we want:
    // a sequence bound near 2^63 must not go through a JS number.
    start: String(r.seqstart),
    increment: String(r.seqincrement),
    min: String(r.seqmin),
    max: String(r.seqmax),
    cache: String(r.seqcache),
    cycle: r.seqcycle,
    lastValue: r.last_value === null ? null : String(r.last_value),
    ownedByIdentity: r.dep_type === "i",
    ownerTable: r.owner_table,
    ownerColumn: r.owner_column,
  }));
}

/** Table constraints, rendered by Postgres itself. */
export async function getConstraints(client) {
  const res = await client.query(`
    SELECT c.relname AS table_name,
           con.conname AS name,
           con.contype AS type,
           pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND con.contype IN ('p', 'u', 'c', 'x', 'f')
     ORDER BY c.relname, con.conname
  `);
  return res.rows.map((r) => ({
    table: r.table_name,
    name: r.name,
    type: r.type,
    def: r.def,
  }));
}

/** Indexes that do not already come with a constraint. */
export async function getIndexes(client) {
  const res = await client.query(`
    SELECT c.relname AS table_name, i.relname AS name,
           pg_get_indexdef(x.indexrelid) AS def
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class c ON c.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = i.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid
       )
     ORDER BY c.relname, i.relname
  `);
  return res.rows.map((r) => ({
    table: r.table_name,
    name: r.name,
    def: r.def,
  }));
}

/** Functions and procedures in public, excluding anything an extension owns. */
export async function getFunctions(client) {
  const res = await client.query(`
    SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass
            AND d.deptype = 'e'
       )
     ORDER BY p.proname, p.oid
  `);
  return res.rows.map((r) => ({ name: r.name, def: r.def }));
}

/** User triggers (tgisinternal excludes the ones foreign keys install). */
export async function getTriggers(client) {
  const res = await client.query(`
    SELECT c.relname AS table_name, t.tgname AS name,
           pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
     ORDER BY c.relname, t.tgname
  `);
  return res.rows.map((r) => ({
    table: r.table_name,
    name: r.name,
    def: r.def,
  }));
}

/** Views in public. */
export async function getViews(client) {
  const res = await client.query(`
    SELECT c.relname AS name, pg_get_viewdef(c.oid, true) AS def
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v'
     ORDER BY c.relname
  `);
  return res.rows.map((r) => ({ name: r.name, def: r.def }));
}

// ── DDL rendering ──────────────────────────────────────────────────────────

/**
 * `CREATE TABLE` for one table: columns, types, NOT NULL, and identity or
 * generated clauses. Ordinary DEFAULTs are deliberately NOT inline; they are
 * emitted later as ALTER TABLE ... SET DEFAULT, after the sequences and
 * functions they may reference exist. That is pg_dump's own ordering and it
 * is what stops a SERIAL column's `nextval('..._id_seq')` default from
 * referring to a sequence that has not been created yet.
 */
export function renderCreateTable(table, columns) {
  if (columns.length === 0) return `CREATE TABLE ${qualify(table)} ();`;
  const lines = columns.map((col) => {
    let line = `    ${quoteIdent(col.name)} ${col.pgType}`;
    if (col.generated === "s") {
      line += ` GENERATED ALWAYS AS (${col.defaultExpr}) STORED`;
    } else if (col.identity === "a") {
      line += " GENERATED ALWAYS AS IDENTITY";
    } else if (col.identity === "d") {
      line += " GENERATED BY DEFAULT AS IDENTITY";
    }
    if (col.notNull) line += " NOT NULL";
    return line;
  });
  return `CREATE TABLE ${qualify(table)} (\n${lines.join(",\n")}\n);`;
}

/**
 * `CREATE SEQUENCE`. MINVALUE and MAXVALUE are always written out rather than
 * compared against the type's defaults to decide between an explicit value
 * and NO MINVALUE: writing both reproduces the same sequence either way and
 * removes a whole class of off-by-one bound bugs.
 */
export function renderCreateSequence(seq) {
  const parts = [
    `CREATE SEQUENCE ${qualify(seq.name)}`,
    `    AS ${seq.dataType}`,
    `    START WITH ${seq.start}`,
    `    INCREMENT BY ${seq.increment}`,
    `    MINVALUE ${seq.min}`,
    `    MAXVALUE ${seq.max}`,
    `    CACHE ${seq.cache}`,
  ];
  if (seq.cycle) parts.push("    CYCLE");
  return `${parts.join("\n")};`;
}

/** `setval`, carrying the sequence's exact position at dump time. */
export function renderSetval(seq) {
  const target = quoteLiteral(`public.${quoteIdent(seq.name)}`);
  return seq.lastValue === null
    ? `SELECT pg_catalog.setval(${target}, ${seq.start}, false);`
    : `SELECT pg_catalog.setval(${target}, ${seq.lastValue}, true);`;
}

/** The `COPY ... FROM stdin;` line psql (and pgAdmin, and DBeaver) act on. */
export function renderCopyHeader(table, columns) {
  const cols = columns.map(quoteIdent).join(", ");
  return `COPY ${qualify(table)} (${cols}) FROM stdin;`;
}

/** A marker line: a SQL comment to every tool, a frame to our own restore. */
export function marker(kind, payload) {
  return payload === undefined
    ? `${MARKER_PREFIX}${kind}`
    : `${MARKER_PREFIX}${kind} ${JSON.stringify(payload)}`;
}

/** Parse a marker line into { kind, payload }, or null if it is not one. */
export function parseMarker(line) {
  if (!line.startsWith(MARKER_PREFIX)) return null;
  const rest = line.slice(MARKER_PREFIX.length);
  const space = rest.indexOf(" ");
  if (space === -1) return { kind: rest, payload: null };
  const kind = rest.slice(0, space);
  try {
    return { kind, payload: JSON.parse(rest.slice(space + 1)) };
  } catch {
    return { kind, payload: null };
  }
}

// ── Dump ───────────────────────────────────────────────────────────────────

/**
 * Async generator producing the whole .sql file, one string per yield.
 *
 * The caller wraps it in Readable.from() so it plugs into the SAME
 * gzip/encrypt/write pipeline the pg_dump path uses; backpressure is then the
 * stream's problem and a slow disk cannot make the dump buffer in memory.
 *
 * The whole dump runs in ONE REPEATABLE READ, READ ONLY transaction. Without
 * it every page would see a different snapshot: a row committed after we
 * paged past its key would be missed, and a child row could be written whose
 * parent was not, which is a restore that fails on a foreign key.
 *
 * @param {object} input
 * @param {{query: Function}} input.client a `pg` Client or PoolClient. Typed by the
 *   only method either function uses, matching _lib.schema-introspect.mjs, so a
 *   test can pass a recorder without reimplementing 30 unrelated members
 * @param {{appVersion?: string}} [input.meta]
 * @param {boolean} [input.allowIncomplete] write the file even when the
 *   database holds objects this dumper cannot represent
 * @param {(message: string) => void} [input.onLog]
 * @param {(message: string) => void} [input.onWarn]
 */
export async function* generateSqlDump({
  client,
  meta = {},
  allowIncomplete = false,
  onLog,
  onWarn,
}) {
  const log = onLog || (() => {});
  const warn = onWarn || (() => {});

  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  try {
    for (const guc of DUMP_SESSION_GUCS) await client.query(guc);
    await assertServerSupported(client);

    const unsupported = await findUnsupportedObjects(client);
    if (unsupported.length > 0) {
      if (!allowIncomplete) {
        throw new Error(
          "This database contains objects the built-in dumper cannot write " +
            `out: ${unsupported.join("; ")}. Refusing to produce a backup ` +
            "that would silently be missing them. Install postgresql-client " +
            "so pg_dump can be used, or re-run with --allow-incomplete if " +
            "you accept losing exactly those objects.",
        );
      }
      warn(
        `Writing an INCOMPLETE dump: ${unsupported.join("; ")} will NOT be ` +
          "in it.",
      );
    }

    const [
      tables,
      columnsByTable,
      pkByTable,
      fkEdges,
      extensions,
      sequences,
      constraints,
      indexes,
      functions,
      triggers,
      views,
      serverVersion,
      schemaVersion,
    ] = await Promise.all([
      getTableNames(client),
      getTableColumns(client),
      getPrimaryKeys(client),
      getForeignKeys(client),
      getExtensions(client),
      getSequences(client),
      getConstraints(client),
      getIndexes(client),
      getFunctions(client),
      getTriggers(client),
      getViews(client),
      client
        .query("SELECT version() AS v")
        .then((r) => r.rows[0].v)
        .catch(() => "unknown"),
      readSchemaVersion(client),
    ]);

    const plan = planDumpTables({ tables, fkEdges });
    if (plan.cycles.length > 0) {
      warn(
        `Foreign-key cycle between ${plan.cycles.join(", ")}. Foreign keys ` +
          "are applied after the data, so the restore still works, but the " +
          "table order in this file is arbitrary for those tables.",
      );
    }

    // ── Header ────────────────────────────────────────────────────────────
    const headerLines = [
      "--",
      "-- VulnRadar database dump",
      "--",
      `-- Format:          ${DUMP_FORMAT} v${DUMP_FORMAT_VERSION}`,
      `-- App version:     ${meta.appVersion ?? "unknown"}`,
      `-- Schema version:  ${schemaVersion ?? "unknown"}`,
      `-- Created at:      ${new Date().toISOString()}`,
      `-- Server:          ${String(serverVersion).replace(/\s+/g, " ").slice(0, 160)}`,
      "--",
      "-- Restore with either of:",
      "--   psql -v ON_ERROR_STOP=1 --single-transaction -f <this file> <database>",
      "--   npm run db:restore -- --file=<this file> --yes",
      "--",
      ...DUMP_LIMITS_NOTICE.map((l) => `-- ${l}`),
      "--",
    ];
    if (plan.skipped.length > 0) {
      headerLines.push(
        "-- Table data deliberately NOT included (transient state, meaningless",
        "-- minutes later; the tables themselves ARE created empty):",
        ...plan.skipped.map((s) => `--   ${s.table}: ${s.reason}`),
        "--",
      );
    }
    if (unsupported.length > 0) {
      headerLines.push(
        "-- WARNING: this dump is INCOMPLETE. The following were present in the",
        "-- source database and are NOT in this file:",
        ...unsupported.map((u) => `--   ${u}`),
        "--",
      );
    }
    yield headerLines.join("\n") + "\n\n";

    yield marker("DUMP", {
      format: DUMP_FORMAT,
      version: DUMP_FORMAT_VERSION,
      appVersion: meta.appVersion ?? null,
      schemaVersion: schemaVersion ?? null,
      createdAt: new Date().toISOString(),
      tables: plan.order,
      skipped: plan.skipped.map((s) => s.table),
      incomplete: unsupported,
    }) + "\n";

    for (const stmt of DUMP_PREAMBLE) {
      yield `${marker("STMT")}\n${stmt};\n`;
    }

    // ── Pre-data: extensions, functions, sequences, tables, defaults ──────
    yield `\n${marker("SECTION", "pre-data")}\n`;

    for (const ext of extensions) {
      yield `${marker("STMT")}\nCREATE EXTENSION IF NOT EXISTS ` +
        `${quoteIdent(ext.name)} WITH SCHEMA ${quoteIdent(ext.schema)};\n`;
    }

    for (const fn of functions) {
      // pg_get_functiondef returns a complete CREATE FUNCTION with its own
      // dollar-quoted body and no trailing semicolon.
      yield `${marker("STMT")}\n${fn.def.replace(/;?\s*$/, "")};\n`;
    }

    for (const seq of sequences) {
      if (seq.ownedByIdentity) continue; // created by the column's own clause
      yield `${marker("STMT")}\n${renderCreateSequence(seq)}\n`;
    }

    for (const table of tables) {
      yield `${marker("STMT")}\n` +
        `${renderCreateTable(table, columnsByTable[table] || [])}\n`;
    }

    for (const seq of sequences) {
      if (seq.ownedByIdentity || !seq.ownerTable) continue;
      yield `${marker("STMT")}\nALTER SEQUENCE ${qualify(seq.name)} OWNED BY ` +
        `${qualify(seq.ownerTable)}.${quoteIdent(seq.ownerColumn)};\n`;
    }

    for (const table of tables) {
      for (const col of columnsByTable[table] || []) {
        if (col.generated === "s" || col.identity || !col.defaultExpr) continue;
        yield `${marker("STMT")}\nALTER TABLE ONLY ${qualify(table)} ` +
          `ALTER COLUMN ${quoteIdent(col.name)} SET DEFAULT ${col.defaultExpr};\n`;
      }
    }

    for (const view of views) {
      yield `${marker("STMT")}\nCREATE VIEW ${qualify(view.name)} AS\n` +
        `${view.def.replace(/;?\s*$/, "")};\n`;
    }

    // ── Data ──────────────────────────────────────────────────────────────
    yield `\n${marker("SECTION", "data")}\n`;

    let totalRows = 0;
    for (const table of plan.order) {
      const columns = columnsByTable[table] || [];
      // A generated column is computed by the server and cannot be inserted
      // into, so it must not appear in the COPY column list.
      const stored = columns.filter((c) => c.generated !== "s");
      const names = stored.map((c) => c.name);
      if (names.length === 0) continue;
      const typeOf = new Map(columns.map((c) => [c.name, c.pgType]));

      // getPrimaryKeys lowercases, so a mixed-case primary key column would
      // not match the real one. Rather than paginate on a column that does
      // not exist, drop to ctid and say so.
      const declaredPk = pkByTable[table] || [];
      const usablePk = declaredPk.every((k) => typeOf.has(k)) ? declaredPk : [];
      if (declaredPk.length > 0 && usablePk.length === 0) {
        warn(
          `${table}: primary key (${declaredPk.join(", ")}) does not match a ` +
            "column name; paginating on ctid instead.",
        );
      }

      yield `${marker("COPY", { table, columns: names })}\n` +
        `${renderCopyHeader(table, names)}\n`;

      const keyTypes = usablePk.map((k) => typeOf.get(k));
      const keyIndexes = usablePk.map((k) => names.indexOf(k));
      let cursor = null;
      let pageRows = INITIAL_PAGE_ROWS;
      let rows = 0;

      for (;;) {
        const text = buildPageQuery({
          table,
          columns: names,
          keyColumns: usablePk,
          keyTypes,
          hasCursor: cursor !== null,
          limit: pageRows,
        });
        const res = await client.query({
          text,
          values: cursor ?? [],
          rowMode: "array",
        });
        if (res.rows.length === 0) break;

        let pageBytes = 0;
        let chunk = "";
        for (const row of res.rows) {
          // Without a primary key the trailing ctid is pagination state, not
          // data, so it is trimmed before the row is written.
          const values = usablePk.length > 0 ? row : row.slice(0, names.length);
          const line = encodeCopyRow(values) + "\n";
          pageBytes += line.length;
          chunk += line;
        }
        yield chunk;
        rows += res.rows.length;

        const last = res.rows[res.rows.length - 1];
        cursor =
          usablePk.length > 0
            ? keyIndexes.map((i) => last[i])
            : [last[names.length]];

        if (res.rows.length < pageRows) break;
        pageRows = nextPageRows(pageRows, pageBytes);
      }

      totalRows += rows;
      yield `\\.\n${marker("COPYEND", { table, rows })}\n`;
      if (rows > 0) log(`${table}: ${rows} row(s)`);
    }

    // ── Post-data: constraints, indexes, foreign keys, triggers ───────────
    yield `\n${marker("SECTION", "post-data")}\n`;

    for (const con of constraints) {
      if (con.type === "f") continue; // foreign keys come last
      yield `${marker("STMT")}\nALTER TABLE ONLY ${qualify(con.table)} ` +
        `ADD CONSTRAINT ${quoteIdent(con.name)} ${con.def};\n`;
    }

    for (const idx of indexes) {
      yield `${marker("STMT")}\n${idx.def.replace(/;?\s*$/, "")};\n`;
    }

    // Last, exactly as pg_dump does it: whatever order the data arrived in,
    // a foreign key added after every row exists cannot be violated by it.
    for (const con of constraints) {
      if (con.type !== "f") continue;
      yield `${marker("STMT")}\nALTER TABLE ONLY ${qualify(con.table)} ` +
        `ADD CONSTRAINT ${quoteIdent(con.name)} ${con.def};\n`;
    }

    for (const trg of triggers) {
      yield `${marker("STMT")}\n${trg.def.replace(/;?\s*$/, "")};\n`;
    }

    // ── Sequence positions ────────────────────────────────────────────────
    // Miss these and the first INSERT after a restore collides on a primary
    // key, which is the single most common way a hand-rolled dump appears to
    // work and then fails a day later.
    yield `\n${marker("SECTION", "sequences")}\n`;
    for (const seq of sequences) {
      yield `${marker("STMT")}\n${renderSetval(seq)}\n`;
    }

    // The final marker is what tells a reader the file is complete. A restore
    // that never sees it refuses the file rather than loading a truncated
    // database and reporting success.
    yield `\n${marker("END", { tables: plan.order.length, rows: totalRows })}\n`;
    yield "--\n-- VulnRadar database dump complete\n--\n";
  } finally {
    // READ ONLY and REPEATABLE READ: there is nothing to commit, and COMMIT
    // would still be wrong if the generator was destroyed part way through.
    await client.query("ROLLBACK").catch(() => {});
  }
}

/**
 * The database's recorded schema version, or null when the meta table is
 * absent or empty.
 *
 * The existence check is `to_regclass`, which returns NULL for a missing
 * relation, rather than a SELECT wrapped in a try/catch. Inside a transaction
 * a failed statement poisons the whole transaction, so catching
 * undefined_table would still leave every later query failing with "current
 * transaction is aborted" -- and this runs inside the dump's snapshot.
 */
export async function readSchemaVersion(client) {
  const exists = await client.query(
    `SELECT to_regclass('public.${META_TABLE}') AS oid`,
  );
  if (!exists.rows[0].oid) return null;
  const res = await client.query(
    `SELECT schema_version FROM public.${quoteIdent(META_TABLE)} WHERE id = 1`,
  );
  return res.rows.length > 0 ? res.rows[0].schema_version : null;
}

/**
 * Refuse a server too old for the catalog views this dumper reads.
 * `pg_sequence` arrived in 10 and `pg_proc.prokind` in 11, and a dump that
 * failed halfway through introspection would be a confusing way to find out.
 */
export async function assertServerSupported(client) {
  const res = await client.query(
    "SELECT current_setting('server_version_num')::int AS num",
  );
  const num = res.rows[0].num;
  if (num < 110000) {
    throw new Error(
      `The built-in dumper needs PostgreSQL 11 or newer (this server reports ` +
        `${num}). Use pg_dump against this server instead.`,
    );
  }
  return num;
}

// ── Restore ────────────────────────────────────────────────────────────────

/**
 * Is this file one of ours, or a pg_dump one?
 *
 * Decided from the CONTENT, not the filename, so a renamed or hand-copied
 * backup is still identified correctly. Only the first few kilobytes are
 * decompressed: the DUMP marker sits just after the comment header.
 */
export function detectBackupFormat(gzPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const source = createReadStream(gzPath);
    const gunzip = createGunzip();
    const chunks = [];
    let total = 0;
    let settled = false;

    const classify = () =>
      Buffer.concat(chunks).toString("utf8").includes(`${MARKER_PREFIX}DUMP`)
        ? "vulnradar-sql"
        : "pg_dump";
    const finish = (value, err) => {
      if (settled) return;
      settled = true;
      // Tearing both halves down mid-stream makes them emit errors nobody is
      // waiting for any more; swallow those so they cannot go unhandled.
      source.on("error", () => {});
      gunzip.on("error", () => {});
      source.destroy();
      gunzip.destroy();
      if (err) rejectPromise(err);
      else resolvePromise(value);
    };

    gunzip.on("data", (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= 8192) finish(classify());
    });
    gunzip.on("end", () => finish(classify()));
    gunzip.on("error", (err) => finish(null, err));
    source.on("error", (err) => finish(null, err));
    source.pipe(gunzip);
  });
}

/** Line-by-line reader over a gzipped dump. Never buffers the whole file. */
export function readDumpLines(gzPath) {
  return createInterface({
    input: createReadStream(gzPath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
}

/**
 * Apply one of our .sql dumps through a `pg` connection, with no psql.
 *
 * Everything runs inside ONE transaction, which is the same guarantee `psql
 * --single-transaction -v ON_ERROR_STOP=1` gives, and it is worth more here
 * because for the hosts this exists for it is their only backup: a failure
 * anywhere leaves the database exactly as it was.
 *
 * COPY blocks are replayed as batched INSERTs rather than as protocol-level
 * COPY, because streaming COPY needs pg-copy-streams and this must run with
 * nothing but the `pg` the app already depends on. The values are the same
 * text COPY would have parsed, handed over as bind parameters, so the type
 * conversion is identical.
 *
 * @param {object} input
 * @param {{query: Function}} input.client a `pg` Client or PoolClient. Typed by the
 *   only method either function uses, matching _lib.schema-introspect.mjs, so a
 *   test can pass a recorder without reimplementing 30 unrelated members
 * @param {AsyncIterable<string>} input.lines
 * @param {(message: string) => void} [input.onLog]
 * @returns {Promise<{statements: number, tables: number, rows: number, header: object|null}>}
 */
export async function restoreSqlDump({ client, lines, onLog }) {
  const log = onLog || (() => {});

  let header = null;
  let statements = 0;
  let tablesLoaded = 0;
  let rowsLoaded = 0;
  let sawEnd = false;

  /** @type {"statement"|"copy-header"|"copy-rows"|null} */
  let mode = null;
  let statementLines = [];
  /** @type {{table: string, columns: string[], insertMax: number}|null} */
  let copy = null;
  let batch = [];
  let batchBytes = 0;
  let copyRows = 0;

  await client.query("BEGIN");
  try {
    const flushStatement = async () => {
      if (statementLines.length === 0) return;
      const text = statementLines.join("\n").trim();
      statementLines = [];
      if (text === "") return;
      await client.query(text);
      statements += 1;
    };
    const flushRows = async () => {
      if (!copy || batch.length === 0) return;
      await client.query(
        buildInsertQuery({
          table: copy.table,
          columns: copy.columns,
          rowCount: batch.length,
        }),
        batch.flat(),
      );
      batch = [];
      batchBytes = 0;
    };

    for await (const line of lines) {
      if (mode === "copy-rows") {
        if (line === "\\.") {
          await flushRows();
          mode = null;
          continue;
        }
        const values = decodeCopyRow(line);
        if (values.length !== copy.columns.length) {
          throw new Error(
            `${copy.table}: a COPY row has ${values.length} field(s) but the ` +
              `block declares ${copy.columns.length} column(s). The file is ` +
              "corrupt.",
          );
        }
        batch.push(values);
        batchBytes += line.length;
        copyRows += 1;
        if (
          batch.length >= copy.insertMax ||
          batchBytes >= RESTORE_BATCH_BYTE_BUDGET
        ) {
          await flushRows();
        }
        continue;
      }

      if (mode === "copy-header") {
        // The `COPY ... FROM stdin;` line itself, which psql acts on and we
        // have already read out of the marker. Skipped, not parsed.
        mode = "copy-rows";
        continue;
      }

      const found = parseMarker(line);
      if (found) {
        await flushStatement();
        if (found.kind === "DUMP") {
          header = found.payload;
          if (!header || header.format !== DUMP_FORMAT) {
            throw new Error("This is not a VulnRadar SQL dump.");
          }
          if (header.version !== DUMP_FORMAT_VERSION) {
            throw new Error(
              `This dump is format version ${header.version}; this version of ` +
                `VulnRadar reads version ${DUMP_FORMAT_VERSION}. Restore it ` +
                "with psql instead.",
            );
          }
          mode = null;
        } else if (found.kind === "STMT") {
          mode = "statement";
        } else if (found.kind === "COPY") {
          copy = {
            table: found.payload.table,
            columns: found.payload.columns,
            insertMax: maxRowsPerInsert(found.payload.columns.length),
          };
          copyRows = 0;
          mode = "copy-header";
        } else if (found.kind === "COPYEND") {
          await flushRows();
          if (found.payload.rows !== copyRows) {
            throw new Error(
              `${found.payload.table}: the dump declares ` +
                `${found.payload.rows} row(s) but ${copyRows} were read. The ` +
                "file is truncated or corrupt.",
            );
          }
          if (copyRows > 0) {
            log(`${found.payload.table}: ${copyRows} row(s) restored`);
          }
          rowsLoaded += copyRows;
          tablesLoaded += 1;
          copy = null;
          mode = null;
        } else if (found.kind === "END") {
          if (found.payload && found.payload.rows !== rowsLoaded) {
            throw new Error(
              `The dump declares ${found.payload.rows} row(s) in total but ` +
                `${rowsLoaded} were read. The file is truncated or corrupt.`,
            );
          }
          sawEnd = true;
          break;
        } else {
          mode = null;
        }
        continue;
      }

      if (mode === "statement") {
        statementLines.push(line);
        continue;
      }

      // Outside a framed statement only blank lines and SQL comments are
      // expected. Anything else means the file was edited or is not ours, and
      // guessing at it is exactly how a restore corrupts a database.
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("--")) continue;
      throw new Error(
        `Unexpected SQL outside a marked statement: ${trimmed.slice(0, 80)}. ` +
          "This file was not produced by VulnRadar (or was edited); restore " +
          "it with psql instead.",
      );
    }

    await flushStatement();

    if (!header) {
      throw new Error("This file has no VulnRadar dump marker.");
    }
    if (!sawEnd) {
      throw new Error(
        "The dump has no end marker, so it was truncated (an interrupted " +
          "backup, or a partial copy). Nothing was applied.",
      );
    }

    await client.query("COMMIT");
    // The file's preamble ran `set_config('search_path', '', false)` and a
    // row of SETs at SESSION scope, exactly as pg_dump writes them, and a
    // COMMIT makes those stick on this connection. RESET ALL rather than
    // RESET search_path because the connection goes back to a pool: the next
    // borrower must not inherit statement_timeout = 0 either. The immediate
    // need is search_path, without which repairAllSequences (which resolves
    // sequences by bare name) would find nothing.
    await client.query("RESET ALL").catch(() => {});
    return { statements, tables: tablesLoaded, rows: rowsLoaded, header };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}
