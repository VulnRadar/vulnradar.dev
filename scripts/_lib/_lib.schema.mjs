/**
 * VulnRadar — Schema introspection helpers.
 *
 * Parses the live database schema (information_schema) AND the expected
 * schema from instrumentation.ts. Used by both migrate.mjs and
 * create-fresh-db.mjs to drive diffs and previews.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./_lib.env.mjs";

// ── Live schema from information_schema ────────────────────────────────────
export async function getActualSchema(pool) {
  const res = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const tables = {};
  for (const row of res.rows) {
    const t = row.table_name;
    if (!tables[t]) tables[t] = [];
    tables[t].push(row.column_name.toLowerCase());
  }
  return tables;
}

export async function getExistingTables(pool) {
  const res = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  return res.rows.map((r) => r.table_name);
}

export async function getTableCounts(pool, tables) {
  const counts = {};
  for (const t of tables) {
    try {
      const res = await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      counts[t] = res.rows[0].n;
    } catch {
      counts[t] = 0;
    }
  }
  return counts;
}

export async function getDatabaseSummary(pool) {
  const tables = await getExistingTables(pool);
  const counts = await getTableCounts(pool, tables);
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  return { tables, counts, totalRows };
}

// ── Expected schema (parsed from instrumentation.ts) ───────────────────────
export function parseExpectedSchema() {
  const filePath = resolve(ROOT, "instrumentation.ts");
  const content = readFileSync(filePath, "utf-8");

  const tables = {};
  const SQL_TYPES =
    /^(SERIAL|BIGSERIAL|INTEGER|INT|SMALLINT|VARCHAR|TEXT|BOOLEAN|BOOL|TIMESTAMP|TIMESTAMPTZ|JSONB|JSON|BIGINT|UUID|REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL|DATE|TIME|BYTEA|INET|CIDR|MACADDR)\b/i;
  const SKIP_KEYWORDS =
    /^(UNIQUE|PRIMARY\s+KEY|FOREIGN\s+KEY|CHECK|CONSTRAINT)/i;

  let currentTable = null;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    const tableMatch = line.match(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i,
    );
    if (tableMatch) {
      currentTable = tableMatch[1];
      if (!tables[currentTable]) tables[currentTable] = new Set();

      const afterParen = line.split("(").slice(1).join("(").trim();
      if (afterParen) {
        const colToken = afterParen.replace(/,\s*$/, "").trim();
        const parts = colToken.split(/\s+/);
        if (parts.length >= 2 && SQL_TYPES.test(parts[1])) {
          tables[currentTable].add(parts[0].replace(/"/g, "").toLowerCase());
        }
      }
      continue;
    }

    if (currentTable && /^\);?\s*$/.test(line)) {
      currentTable = null;
      continue;
    }

    if (currentTable) {
      const cleaned = line
        .replace(/,\s*$/, "")
        .replace(/\)\s*;?\s*$/, "")
        .trim();
      if (!cleaned || SKIP_KEYWORDS.test(cleaned) || cleaned.startsWith("--"))
        continue;

      const parts = cleaned.split(/\s+/);
      if (parts.length >= 2) {
        const colName = parts[0].replace(/"/g, "");
        const colType = parts[1];
        if (/^\w+$/.test(colName) && SQL_TYPES.test(colType)) {
          tables[currentTable].add(colName.toLowerCase());
        }
      }
    }

    const alterMatch = line.match(
      /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)\s+/i,
    );
    if (alterMatch) {
      const tbl = alterMatch[1];
      const col = alterMatch[2].replace(/"/g, "").toLowerCase();
      if (!tables[tbl]) tables[tbl] = new Set();
      tables[tbl].add(col);
    }
  }

  const result = {};
  for (const [table, cols] of Object.entries(tables)) {
    result[table] = [...cols].sort();
  }
  return result;
}
