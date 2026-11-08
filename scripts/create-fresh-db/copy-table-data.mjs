/**
 * VulnRadar - The row copy behind `npm run db:create`.
 *
 * Lives apart from create-fresh-db.mjs because that file runs main() on import,
 * and this is the part that needs testing against a real database.
 */

import pg from "pg";
import { success, warn } from "../_lib/_lib.output.mjs";

// Hard-coded defaults for v1 -> v2 columns that are NOT NULL but missing in source.
const COLUMN_DEFAULTS = {
  scan_history: {
    summary: "'{}'::jsonb",
    findings: "'[]'::jsonb",
    findings_count: "0",
    duration: "0",
    source: "'web'",
  },
};

// v1 -> v2 column rename hints (old -> new).
const COLUMN_RENAMES = {
  scan_history: {
    results: "findings",
    scan_results: "findings",
    result: "findings",
  },
};

const JSON_TYPES = new Set(["json", "jsonb"]);
const JSON_TYPE_OIDS = new Set([114, 3802]);

/**
 * Read json and jsonb as the text Postgres stored instead of parsing it.
 *
 * Parsed, a value is at the mercy of how node-pg sends it back: a JavaScript
 * array goes out as a Postgres array literal, so `[]` landed as `{}` and a
 * non-empty array failed its INSERT. It would also lose what JavaScript cannot
 * hold (a JSON `null` looks like SQL NULL, and a 64-bit id loses precision).
 * The text goes straight back into a parameter, and is already valid JSON.
 */
const RAW_JSON_TYPES = {
  getTypeParser(oid, format) {
    return JSON_TYPE_OIDS.has(oid)
      ? (value) => value
      : pg.types.getTypeParser(oid, format);
  },
};

function readColumns(pool, table) {
  return pool
    .query(
      `SELECT column_name, is_nullable, data_type, column_default, is_generated
       FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = 'public'
       ORDER BY ordinal_position`,
      [table],
    )
    .then((res) => res.rows);
}

/** Source column name -> target column name, applying the v1 renames. */
function mapColumns(table, sourceCols, targetCols) {
  const renames = COLUMN_RENAMES[table] || {};
  const mapping = new Map();
  for (const old of sourceCols) {
    if (targetCols.has(old)) mapping.set(old, old);
    else if (renames[old] && targetCols.has(renames[old]))
      mapping.set(old, renames[old]);
  }
  return mapping;
}

export async function copyTableData(originalPool, newPool, table, rowCount) {
  const sourceColumns = await readColumns(originalPool, table);
  const sourceTypes = new Map(
    sourceColumns.map((r) => [r.column_name, r.data_type]),
  );

  // A generated column cannot be written, and writing one fails the whole row,
  // so it is not a target at all. It recomputes from the columns that are
  // copied. scan_history.share_token_hash and host_badges.badge_token_hash are
  // why a 3.x database could not be cloned: every row failed, and then every
  // row referencing those failed its foreign key.
  const targetColumns = (await readColumns(newPool, table)).filter(
    (r) => r.is_generated !== "ALWAYS",
  );
  const targetInfo = new Map(targetColumns.map((r) => [r.column_name, r]));
  const targetCols = new Set(targetInfo.keys());

  const mapping = mapColumns(
    table,
    sourceColumns.map((r) => r.column_name),
    targetCols,
  );
  const targetNames = [...mapping.values()];

  // Find NOT NULL columns in target that aren't covered by mapping or defaults.
  const defaults = COLUMN_DEFAULTS[table] || {};
  const extraCols = [];
  const extraVals = [];
  for (const [name, targetColumnInfo] of targetInfo) {
    if (mapping.has(name)) continue;
    if (defaults[name] !== undefined) {
      extraCols.push(name);
      extraVals.push(defaults[name]);
    } else if (
      targetColumnInfo.is_nullable === "NO" &&
      !targetColumnInfo.column_default
    ) {
      warn(
        `  ${table}.${name} is NOT NULL with no default — skipping data copy.`,
      );
      return false;
    }
  }

  // Read all rows from source
  const rows = await originalPool.query({
    text: `SELECT * FROM "${table}"`,
    types: RAW_JSON_TYPES,
  });
  if (rows.rows.length === 0) return true;

  // Build INSERT
  const allCols = [...targetNames, ...extraCols];
  const placeholders = allCols.map((_, i) => `$${i + 1}`).join(", ");
  const colList = allCols.map((c) => `"${c}"`).join(", ");

  let inserted = 0;
  let skipped = 0;
  for (const row of rows.rows) {
    const values = [
      ...targetNames.map((t) => {
        const sourceName = mappingReverseGet(mapping, t);
        const v = row[sourceName];
        if (v == null) return null;
        if (
          !JSON_TYPES.has(targetInfo.get(t).data_type) ||
          JSON_TYPES.has(sourceTypes.get(sourceName))
        ) {
          return v;
        }
        // Into json from anything else: text from a v1 column, or a JS value
        // such as an array, which node-pg would otherwise send as an array
        // literal. If it cannot be serialized (malformed text, say), it
        // becomes NULL with a warning.
        try {
          return JSON.stringify(typeof v === "string" ? JSON.parse(v) : v);
        } catch (err) {
          warn(`  Invalid JSON in ${table}.${t}: ${err.message.slice(0, 80)}`);
          return null;
        }
      }),
      ...extraVals,
    ];
    try {
      // ON CONFLICT DO NOTHING handles conflicts on ANY unique constraint
      // (PK, name, etc.) by silently skipping. The count below reflects
      // actual inserts, not attempts, so the user sees the real result.
      await newPool.query(
        `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})
         ON CONFLICT DO NOTHING`,
        values,
      );
      inserted++;
    } catch (err) {
      // FK violation: source has orphaned references (e.g. user_badges
      // pointing at a badge_id that no longer exists). Log the row and skip.
      skipped++;
      const msg = err.message || "";
      if (msg.includes("foreign key")) {
        const fkMatch = msg.match(/"([^"]+)"/g);
        const fkHint = fkMatch ? ` (${fkMatch.join(", ")})` : "";
        warn(
          `  Skipped ${table} row (FK violation${fkHint}): ${JSON.stringify(row).slice(0, 120)}`,
        );
      } else {
        warn(`  Row insert failed in ${table}: ${msg}`);
      }
    }
  }
  if (skipped > 0) {
    success(
      `  ${table}: ${inserted}/${rowCount} rows copied (${skipped} skipped due to source data issues)`,
    );
  } else if (inserted < rowCount) {
    success(
      `  ${table}: ${inserted}/${rowCount} rows copied (${rowCount - inserted} skipped — target already has rows with conflicting keys)`,
    );
  } else {
    success(`  ${table}: ${inserted}/${rowCount} rows copied`);
  }
  return true;
}

function mappingReverseGet(mapping, targetName) {
  for (const [src, tgt] of mapping) {
    if (tgt === targetName) return src;
  }
  return targetName;
}

/** json_type -> rows, ignoring SQL NULLs, for one column. */
async function jsonTypeCounts(pool, table, column, dataType) {
  const fn = dataType === "jsonb" ? "jsonb_typeof" : "json_typeof";
  const res = await pool.query(
    `SELECT ${fn}("${column}") AS json_type, COUNT(*)::int AS n
     FROM "${table}" WHERE "${column}" IS NOT NULL GROUP BY 1`,
  );
  return new Map(res.rows.map((r) => [r.json_type, r.n]));
}

/**
 * JSON columns that lost values of some type. A count check cannot see an array
 * that arrived as an object. Fewer of a type is the failure; more is fine,
 * because a reused target may already hold rows of its own.
 */
async function jsonTypeShortfalls(originalPool, newPool, table) {
  const sourceColumns = await readColumns(originalPool, table);
  const targetColumns = await readColumns(newPool, table);
  const targetTypes = new Map(
    targetColumns.map((r) => [r.column_name, r.data_type]),
  );
  const mapping = mapColumns(
    table,
    sourceColumns.map((r) => r.column_name),
    new Set(targetTypes.keys()),
  );

  const shortfalls = [];
  for (const { column_name: source, data_type: sourceType } of sourceColumns) {
    const target = mapping.get(source);
    if (
      !target ||
      !JSON_TYPES.has(sourceType) ||
      !JSON_TYPES.has(targetTypes.get(target))
    ) {
      continue;
    }
    const before = await jsonTypeCounts(
      originalPool,
      table,
      source,
      sourceType,
    );
    const after = await jsonTypeCounts(
      newPool,
      table,
      target,
      targetTypes.get(target),
    );
    for (const [type, expected] of before) {
      const got = after.get(type) ?? 0;
      if (got < expected) {
        shortfalls.push({
          table: `${table}.${target} (${type})`,
          expected,
          got,
        });
      }
    }
  }
  return shortfalls;
}

/**
 * Compare row counts and JSON value types after the copy and shout about
 * anything that lost data without saying so. copyTableData already reports
 * per-table skips, but only this check can catch a table that was silently
 * short or a value that silently changed shape.
 *
 * Returns the list of shortfalls so the caller can set the exit code.
 */
export async function verifyCopiedCounts(originalPool, newPool, copied) {
  const shortfalls = [];
  for (const { table, count } of copied) {
    try {
      const res = await newPool.query(
        `SELECT COUNT(*)::int AS n FROM "${table}"`,
      );
      const got = res.rows[0].n;
      if (got < count) shortfalls.push({ table, expected: count, got });
      shortfalls.push(
        ...(await jsonTypeShortfalls(originalPool, newPool, table)),
      );
    } catch (err) {
      shortfalls.push({ table, expected: count, got: `error: ${err.message}` });
    }
  }
  return shortfalls;
}
