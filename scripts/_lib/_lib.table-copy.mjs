/**
 * VulnRadar - Which tables a database clone copies, and in what order.
 *
 * Why this exists
 * ---------------
 * `npm run db:create` (scripts/create-fresh-db/create-fresh-db.mjs) is the
 * documented way to move to a different database, production included. Its
 * data copy used to be driven by a hand-maintained 30-entry list called
 * MIGRATE_TABLES. Both the copy loop and the "here is what will happen"
 * plan iterated that list, so a table that existed in the source AND in
 * the target but was not written down was never copied, never listed in
 * the plan, and never reported afterwards. 33 of the 63 app tables were in
 * that position (AUDIT-013 migrate-02), including system_settings,
 * access_rules, webhooks, host_badges and support_tickets: an operator who
 * cloned and cut over silently lost every admin-configured runtime
 * setting, the whole IP allow/deny list, every outbound webhook, every
 * embedded badge token (so live third-party <img> embeds start 404ing) and
 * every open support ticket, with no signal before or after.
 *
 * So the copy set is DERIVED: everything the source and the target both
 * have. The only hand-written list left is TRANSIENT_TABLES below, and
 * skipping one of those is announced rather than assumed. Anything that is
 * neither copied nor explicitly classified is a bug in this module, and
 * planTableCopy reports it as `unaccounted` rather than dropping it.
 *
 * The ordering and planning functions are pure so they can be tested
 * without a database (tests/scripts/_lib/table-copy.test.ts).
 */

/**
 * Tables deliberately NOT copied, with the reason shown to the operator.
 *
 * Every entry has to be genuinely transient: short-lived state that is
 * either meaningless in a new database or actively harmful to carry over.
 * If you are tempted to add a table here because copying it is awkward,
 * the answer is to make the copy work.
 */
export const TRANSIENT_TABLES = Object.freeze({
  rate_limits:
    "short-lived rate-limit counters, rebuilt within one window; copying them would carry stale blocks across the cutover",
  email_2fa_codes: "one-time 2FA codes, all expired within minutes",
  password_reset_tokens:
    "one-time reset tokens; copying them extends the lifetime of a credential that should be short-lived",
  email_verification_tokens: "one-time verification tokens, same reasoning",
  subdomain_cache: "discovery cache with a 4 hour TTL, refills on demand",
  cve_kev_cache: "KEV feed cache, refetched on demand",
});

/**
 * The migrator's own bookkeeping row is written explicitly by the caller
 * (Step 4 of create-fresh-db), at the schema version the NEW database was
 * built at. Copying the source's row would stamp the wrong version.
 */
export const META_TABLE = "vulnradar_schema_meta";

/**
 * Order tables so a parent is always inserted before its children.
 *
 * `fkEdges` is whatever getForeignKeys() returns: objects carrying
 * `childTable` and `parentTable`. Self-references (a table whose column
 * points at its own primary key, e.g. a threaded reply) are ignored: they
 * constrain row order inside one table, not table order, and treating them
 * as edges would make every such table look like a cycle.
 *
 * Deterministic by construction: ties are broken alphabetically, so two
 * runs against the same schema produce the same order and a diff of the
 * plan output is meaningful.
 *
 * Returns { order, cycles }. A genuine cycle (two tables that reference
 * each other) cannot be satisfied by any ordering, so those tables are
 * appended alphabetically and named in `cycles` for the caller to warn
 * about: the copy still runs and the FK failures, if any, are reported
 * per row.
 */
export function orderTablesForCopy(tables, fkEdges = []) {
  const present = new Set(tables);
  /** parent -> children */
  const children = new Map();
  const indegree = new Map();
  for (const table of present) {
    children.set(table, new Set());
    indegree.set(table, 0);
  }

  for (const edge of fkEdges) {
    const child = edge.childTable;
    const parent = edge.parentTable;
    if (child === parent) continue;
    if (!present.has(child) || !present.has(parent)) continue;
    if (children.get(parent).has(child)) continue;
    children.get(parent).add(child);
    indegree.set(child, indegree.get(child) + 1);
  }

  const ready = [...present].filter((t) => indegree.get(t) === 0).sort();
  const order = [];
  while (ready.length > 0) {
    const table = ready.shift();
    order.push(table);
    const unlocked = [];
    for (const child of children.get(table)) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) unlocked.push(child);
    }
    // Re-sort rather than push-and-sort-later: keeps the whole traversal
    // alphabetical at every level instead of only within each batch.
    for (const child of unlocked) ready.push(child);
    ready.sort();
  }

  const cycles = [...present].filter((t) => !order.includes(t)).sort();
  return { order: [...order, ...cycles], cycles };
}

/**
 * Decide what a clone copies, what it deliberately skips, and what it
 * cannot copy at all.
 *
 * @param {object} input
 * @param {string[]} input.sourceTables  tables that exist in the source DB
 * @param {string[]} input.targetTables  tables that exist in the new DB
 * @param {Record<string, number>} input.counts  source row count per table
 * @param {Array<{childTable: string, parentTable: string}>} [input.fkEdges]
 *   foreign keys read from the TARGET database (that is where the inserts
 *   land, so its constraints are the ones that decide order)
 * @returns {{
 *   copy: Array<{ table: string, count: number }>,
 *   transient: Array<{ table: string, count: number, reason: string }>,
 *   missingInTarget: Array<{ table: string, count: number }>,
 *   empty: string[],
 *   unaccounted: string[],
 *   cycles: string[],
 * }}
 */
export function planTableCopy({
  sourceTables,
  targetTables,
  counts = {},
  fkEdges = [],
}) {
  const target = new Set(targetTables);
  const countOf = (t) => counts[t] ?? 0;

  const copyable = [];
  const transient = [];
  const missingInTarget = [];
  const empty = [];

  for (const table of sourceTables) {
    if (table === META_TABLE) continue;
    const count = countOf(table);
    if (count === 0) {
      // Nothing to lose, so it does not need to be classified or
      // explained. Listed so a caller can show it if it wants to.
      empty.push(table);
      continue;
    }
    if (table in TRANSIENT_TABLES) {
      transient.push({ table, count, reason: TRANSIENT_TABLES[table] });
      continue;
    }
    if (!target.has(table)) {
      missingInTarget.push({ table, count });
      continue;
    }
    copyable.push(table);
  }

  const { order, cycles } = orderTablesForCopy(copyable, fkEdges);
  const copy = order.map((table) => ({ table, count: countOf(table) }));

  // Derived, not asserted by hand: every source table holding rows has to
  // end up in exactly one bucket. This is the check the old hardcoded list
  // had no way to perform, and it is what makes an omission loud instead
  // of invisible.
  const classified = new Set([
    ...copy.map((c) => c.table),
    ...transient.map((t) => t.table),
    ...missingInTarget.map((t) => t.table),
    ...empty,
  ]);
  const unaccounted = sourceTables
    .filter((t) => t !== META_TABLE && !classified.has(t))
    .sort();

  transient.sort((a, b) => a.table.localeCompare(b.table));
  missingInTarget.sort((a, b) => a.table.localeCompare(b.table));
  empty.sort();

  return { copy, transient, missingInTarget, empty, unaccounted, cycles };
}
