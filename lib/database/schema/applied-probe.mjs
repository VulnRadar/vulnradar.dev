/**
 * Reading a schema step's effect back out of the catalog, so a boot against a
 * database that already has it takes no lock on the tables it names.
 *
 * Why IF NOT EXISTS was not enough (bug-db-3)
 * ------------------------------------------
 * `ALTER TABLE users ADD COLUMN IF NOT EXISTS x` checks for the column only
 * after it holds an ACCESS EXCLUSIVE lock on users, and
 * `CREATE INDEX IF NOT EXISTS` checks for the index only after it holds a
 * SHARE lock on its table. A statement that turns out to have nothing to do
 * still queues for that lock, and every query on the table queues behind it.
 * Every boot sent close to two hundred of those, so a restart during a
 * pg_dump or a long report sat behind that transaction while the live app's
 * reads and writes on users, sessions and scan_history sat behind the
 * restart.
 *
 * The catalog can answer "is this already here" without touching the table
 * at all: to_regclass and pg_attribute take no lock on the relation they
 * describe. So for each step this derives one SELECT that is true exactly
 * when every DDL statement in the step would be a no-op, and the runner skips
 * the DDL when it is. Statements that only take row locks (the idempotent
 * UPDATE and INSERT backfills some steps carry) still run every boot.
 *
 * Only shapes whose effect can be read back exactly are recognised. Anything
 * else (a drop-and-re-add, a DO block, a SET DEFAULT) makes the step
 * "unprobed", and tests/lib/database/schema/applied-probe.test.ts fails on an
 * unprobed step that has no explicit guard, so a new statement shape cannot
 * quietly bring the steady-state lock back.
 */

/**
 * Split a query text into statements on semicolons outside quotes, dollar
 * quotes and comments. Comments are dropped, which is all the classifier
 * needs; the runner still sends the step's original text when it runs it.
 *
 * @param {string} sql
 * @returns {string[]}
 */
export function splitSqlStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const end = sql.indexOf(ch, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? sql.length : end + tag[0].length;
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
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      buf += " ";
      continue;
    }
    if (ch === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Split on commas outside parentheses, brackets and quotes. */
function splitTopLevel(text) {
  const parts = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end + 1;
      buf += text.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/** A SQL string literal. Every name here comes from this schema's own source. */
export function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const NAME = String.raw`"?([A-Za-z_][A-Za-z0-9_]*)"?`;

/** The relation's oid, or NULL, without taking a lock on it. */
const regclass = (name) => `to_regclass(${sqlLiteral(`public.${name}`)})`;

export const relationExists = (name) => `${regclass(name)} IS NOT NULL`;
export const relationAbsent = (name) => `${regclass(name)} IS NULL`;

const attribute = (table, column, extra = "") =>
  `SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = ${regclass(table)} AND attname = ${sqlLiteral(column)} AND attnum > 0 AND NOT attisdropped${extra}`;

export const columnExists = (table, column) =>
  `EXISTS (${attribute(table, column)})`;
export const columnAbsent = (table, column) =>
  `NOT EXISTS (${attribute(table, column)})`;
export const columnNullable = (table, column) =>
  `EXISTS (${attribute(table, column, " AND NOT attnotnull")})`;
export const columnNotNull = (table, column) =>
  `EXISTS (${attribute(table, column, " AND attnotnull")})`;

export const constraintAbsent = (table, name) =>
  `NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = ${regclass(table)} AND conname = ${sqlLiteral(name)})`;

export const statisticsExists = (name) =>
  `EXISTS (SELECT 1 FROM pg_catalog.pg_statistic_ext s JOIN pg_catalog.pg_namespace n ON n.oid = s.stxnamespace WHERE n.nspname = 'public' AND s.stxname = ${sqlLiteral(name)})`;

/** A column that is NOT NULL and has a default, whatever the default is. */
export const columnNotNullWithDefault = (table, column) =>
  `EXISTS (${attribute(table, column, " AND attnotnull AND atthasdef")})`;

const constraintRow = (table, name, extra) =>
  `EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = ${regclass(table)} AND c.conname = ${sqlLiteral(name)}${extra})`;

/** A UNIQUE constraint of this name on exactly these columns, in order. */
export const uniqueConstraintOn = (table, name, columns) =>
  constraintRow(
    table,
    name,
    ` AND c.contype = 'u' AND c.conkey = ARRAY(SELECT a.attnum FROM unnest(ARRAY[${columns.map(sqlLiteral).join(", ")}]::text[]) WITH ORDINALITY AS w(col, ord) JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attname = w.col ORDER BY w.ord)::int2[]`,
  );

/**
 * A foreign key of this name whose ON DELETE rule is the given one
 * (pg_constraint.confdeltype: 'a' no action, 'r' restrict, 'c' cascade,
 * 'n' set null, 'd' set default).
 */
export const foreignKeyWithDeleteRule = (table, name, rule) =>
  constraintRow(
    table,
    name,
    ` AND c.contype = 'f' AND c.confdeltype = ${sqlLiteral(rule)}`,
  );

/**
 * The quoted values a value-set CHECK expression allows, in source order:
 * `role IN ('user', 'admin')` gives ['user', 'admin'].
 */
export function checkValues(expr) {
  return [...String(expr).matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/**
 * A CHECK constraint of this name that allows exactly the values `expr`
 * lists. Compared as a set of quoted values read out of
 * pg_get_constraintdef, because PostgreSQL stores `x IN ('a', 'b')` as
 * `((x)::text = ANY ((ARRAY['a'::character varying, ...` and the text itself
 * can never equal what the schema wrote. Set containment both ways rather
 * than a sorted comparison, so the database's collation cannot reorder the
 * two sides differently.
 */
export function checkConstraintAllows(table, name, expr) {
  const values = `ARRAY[${checkValues(expr).map(sqlLiteral).join(", ")}]::text[]`;
  const stored = `ARRAY(SELECT m[1] FROM regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), ${sqlLiteral("'([^']*)'")}, 'g') AS m)`;
  return constraintRow(
    table,
    name,
    ` AND c.contype = 'c' AND ${stored} @> ${values} AND ${stored} <@ ${values}`,
  );
}

/**
 * One SELECT that is true when every condition holds: the form both the
 * derived probes and the hand-written "already applied" guards take, so a
 * test can compare the two.
 *
 * @param {string[]} conditions
 */
export function appliedSql(conditions) {
  const unique = [...new Set(conditions)];
  return `SELECT (${unique.join(")\n   AND (")}) AS applied`;
}

/** The catalog test for one ALTER TABLE sub-command, or null if unknown. */
function alterAction(table, action) {
  let m = new RegExp(
    String.raw`^ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+${NAME}`,
    "i",
  ).exec(action);
  if (m) return columnExists(table, m[1]);
  m = new RegExp(String.raw`^DROP\s+COLUMN\s+IF\s+EXISTS\s+${NAME}$`, "i").exec(
    action,
  );
  if (m) return columnAbsent(table, m[1]);
  m = new RegExp(
    String.raw`^DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+${NAME}$`,
    "i",
  ).exec(action);
  if (m) return constraintAbsent(table, m[1]);
  m = new RegExp(
    String.raw`^ALTER\s+COLUMN\s+${NAME}\s+DROP\s+NOT\s+NULL$`,
    "i",
  ).exec(action);
  if (m) return columnNullable(table, m[1]);
  m = new RegExp(
    String.raw`^ALTER\s+COLUMN\s+${NAME}\s+SET\s+NOT\s+NULL$`,
    "i",
  ).exec(action);
  if (m) return columnNotNull(table, m[1]);
  return null;
}

/**
 * What one statement is, for the purpose of skipping it.
 *
 *   { conditions: [...] }  DDL whose effect the catalog shows; it is a no-op
 *                          when every condition holds
 *   { always: true }       takes row locks at most, so it is cheap to rerun
 *                          and runs every boot (the idempotent backfills)
 *   null                   not recognised: the step cannot be probed
 *
 * @param {string} statement
 */
export function classifyStatement(statement) {
  const s = statement.replace(/\s+/g, " ").trim();
  let m = new RegExp(
    String.raw`^CREATE TABLE IF NOT EXISTS ${NAME}\s*\(`,
    "i",
  ).exec(s);
  if (m) return { conditions: [relationExists(m[1])] };
  m = new RegExp(
    String.raw`^CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?IF NOT EXISTS ${NAME} ON `,
    "i",
  ).exec(s);
  if (m) return { conditions: [relationExists(m[1])] };
  m = new RegExp(
    String.raw`^DROP (?:INDEX|TABLE) (?:CONCURRENTLY )?IF EXISTS ${NAME}(?: CASCADE)?$`,
    "i",
  ).exec(s);
  if (m) return { conditions: [relationAbsent(m[1])] };
  m = new RegExp(
    String.raw`^CREATE STATISTICS IF NOT EXISTS ${NAME} `,
    "i",
  ).exec(s);
  if (m) return { conditions: [statisticsExists(m[1])] };
  m = new RegExp(String.raw`^ALTER TABLE (?:ONLY )?${NAME} (.+)$`, "i").exec(s);
  if (m) {
    const table = m[1];
    const conditions = [relationExists(table)];
    for (const action of splitTopLevel(m[2])) {
      const condition = alterAction(table, action);
      if (!condition) return null;
      conditions.push(condition);
    }
    return { conditions };
  }
  if (/^(UPDATE|INSERT|DELETE)\b/i.test(s)) return { always: true };
  if (/^CREATE OR REPLACE FUNCTION\b/i.test(s)) return { always: true };
  return null;
}

/** Every query text a step executes (mirrors stepQueries in ./index.mjs). */
function queriesOf(step) {
  if (!step.sql) return [];
  return Array.isArray(step.sql) ? step.sql : [step.sql];
}

/**
 * How a step avoids a steady-state lock:
 *
 *   "guarded"    an explicit guard decides (drop-and-re-add steps, the FK
 *                and CHECK migrations, the module-owned DDL)
 *   "concurrent" its own CREATE INDEX CONCURRENTLY step
 *   "probed"     the derived catalog probe below decides
 *   "always"     takes row locks only, runs every boot
 *   "unprobed"   none of the above: it would lock its table on every boot
 *
 * @param {import("./index.mjs").SchemaStep} step
 */
export function lockPlan(step) {
  if (step.guard) return "guarded";
  if (step.concurrentIndex) return "concurrent";
  if (step.moduleSource) return "unprobed";
  const probe = stepProbe(step);
  if (probe) return "probed";
  const classified = queriesOf(step)
    .flatMap(splitSqlStatements)
    .map(classifyStatement);
  return classified.length > 0 && classified.every((c) => c?.always)
    ? "always"
    : "unprobed";
}

const probeCache = new WeakMap();

/**
 * The derived probe for a step: `sql` returns one row whose `applied` column
 * is true when every DDL statement in the step is already in place, and
 * `rest` is what still has to run then (its row-lock-only statements, in
 * order). null when the step has no DDL or carries a statement the classifier
 * does not know.
 *
 * @param {import("./index.mjs").SchemaStep} step
 * @returns {{ sql: string, rest: string[] } | null}
 */
export function stepProbe(step) {
  if (probeCache.has(step)) return probeCache.get(step);
  let probe = null;
  if (!step.guard && !step.moduleSource && !step.concurrentIndex) {
    const conditions = [];
    const rest = [];
    let known = true;
    for (const statement of queriesOf(step).flatMap(splitSqlStatements)) {
      const classified = classifyStatement(statement);
      if (!classified) {
        known = false;
        break;
      }
      if (classified.always) rest.push(statement);
      else conditions.push(...classified.conditions);
    }
    if (known && conditions.length > 0) {
      probe = { sql: appliedSql(conditions), rest };
    }
  }
  probeCache.set(step, probe);
  return probe;
}

/**
 * A step that builds one index with CREATE INDEX CONCURRENTLY, for a table
 * large enough that a plain build (a SHARE lock, so no writes, for as long as
 * the build takes) would stall the live app. The runner skips it while the
 * index is valid; see runConcurrentIndex in ./index.mjs.
 *
 * Always "warn": a missing index makes reads slower, never wrong, and an
 * interrupted build is retried on the next boot.
 *
 * @param {{ id: string, name: string, on: string, unique?: boolean }} spec
 *   `on` is everything after ON: the table, the column list and any WHERE.
 * @returns {import("./index.mjs").SchemaStep}
 */
export function concurrentIndexStep({ id, name, on, unique = false }) {
  return {
    id,
    onError: "warn",
    warning: `Failed to create ${name} (the next boot tries again)`,
    concurrentIndex: name,
    sql: `CREATE ${unique ? "UNIQUE " : ""}INDEX CONCURRENTLY IF NOT EXISTS ${name}\n          ON ${on}`,
  };
}

/**
 * The state of one index, for the CREATE INDEX CONCURRENTLY steps: 'valid',
 * 'invalid' (a build that was interrupted and left its catalog entry behind)
 * or no row at all.
 */
export const INDEX_STATE_SQL = `SELECT CASE WHEN i.indisvalid THEN 'valid' ELSE 'invalid' END AS state
  FROM pg_catalog.pg_index i
 WHERE i.indexrelid = to_regclass('public.' || $1::text)`;
