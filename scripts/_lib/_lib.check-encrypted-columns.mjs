/**
 * VulnRadar — Encrypted-column decrypt-failure detection.
 *
 * Covers every column in ENCRYPTED_COLUMNS (see
 * _lib.encrypted-columns.mjs for how that list was built and why
 * users.totp_secret is deliberately excluded -- that one is already
 * owned by scripts/db-diagnose-2fa.mjs / scripts/db-repair-2fa.mjs).
 *
 * For each row with a non-null value in an encrypted column:
 *   1. Decrypt fails outright -> repair-eligible per the column's
 *      registered repairKind.
 *   2. Decrypts without error, but (for api_keys.key_encrypted only,
 *      where a key_locator gives us something independent to check
 *      against) the recomputed locator doesn't match the stored one ->
 *      same repair, same reasoning as (1): the plaintext isn't real.
 *
 * If API_KEY_ENCRYPTION_KEY isn't configured for this run, every column
 * is skipped with a needs-human "could not check" finding rather than
 * silently reporting nothing -- mirrors the 2FA tool's
 * ENCRYPTION_NOT_CONFIGURED category exactly.
 */
import { ENCRYPTED_COLUMNS } from "./_lib.encrypted-columns.mjs";
import {
  getEncryptionKey,
  decryptApiKeyMirror,
} from "./_lib.2fa-crypto-mirror.mjs";
import { computeApiKeyLocatorMirror } from "./_lib.api-key-locator-mirror.mjs";

function sqlIdLiteral(id) {
  // Primary keys in this schema are always SERIAL/BIGSERIAL integers or
  // UUIDs -- never attacker-controlled -- but escape defensively anyway
  // rather than assume a quote can never appear.
  return typeof id === "number"
    ? String(id)
    : `'${String(id).replace(/'/g, "''")}'`;
}

function buildRepair(col, badIds, pk) {
  const idList = badIds.map(sqlIdLiteral).join(",");
  if (col.repairKind === "clear_column") {
    return {
      sql: `UPDATE "${col.table}" SET "${col.column}" = NULL WHERE "${pk}" IN (${idList})`,
      params: [],
      description: `Clear ${col.table}.${col.column} for ${badIds.length} row(s) that cannot be decrypted.`,
    };
  }
  if (col.repairKind === "revoke_and_clear_api_key") {
    return {
      sql: `UPDATE "${col.table}" SET "${col.column}" = NULL, revoked_at = COALESCE(revoked_at, NOW()) WHERE "${pk}" IN (${idList})`,
      params: [],
      description: `Clear ${col.table}.${col.column} and mark revoked for ${badIds.length} key(s) that already cannot authenticate (see file header).`,
    };
  }
  if (col.repairKind === "delete_row") {
    return {
      sql: `DELETE FROM "${col.table}" WHERE "${pk}" IN (${idList})`,
      params: [],
      description: `Delete ${badIds.length} ${col.table} row(s) with an undecryptable token (equivalent to the user reconnecting).`,
    };
  }
  return undefined;
}

/**
 * @param {{query: Function}} pool
 * @param {{tables: Set<string>, columnsDetailed: object, primaryKeys: object}} ctx
 * @returns {Promise<{findings: import('./_lib.corruption-orchestrator.mjs').Finding[], meta: object}>}
 */
export async function diagnose(pool, ctx) {
  const { tables, columnsDetailed, primaryKeys } = ctx;
  const findings = [];
  const key = getEncryptionKey();

  // Group by table so "delete_row" columns (access_token/refresh_token
  // pair) produce ONE finding per table, not two overlapping deletes.
  const byTable = new Map();
  for (const col of ENCRYPTED_COLUMNS) {
    if (!byTable.has(col.table)) byTable.set(col.table, []);
    byTable.get(col.table).push(col);
  }

  for (const [table, cols] of byTable) {
    if (!tables.has(table)) continue;
    const presentCols = cols.filter((c) =>
      columnsDetailed[table]?.some((dc) => dc.name === c.column),
    );
    if (presentCols.length === 0) continue;

    if (!key) {
      findings.push({
        category: "encrypted_column",
        severity: "needs-human",
        table,
        column: presentCols.map((c) => c.column).join(", "),
        description:
          "API_KEY_ENCRYPTION_KEY is not configured for this run -- could not check whether these columns decrypt.",
        count: 0,
        examples: [],
      });
      continue;
    }

    const pk = (primaryKeys[table] || ["id"])[0];
    const selectCols = [pk, ...presentCols.map((c) => c.column)]
      .map((c) => `"${c}"`)
      .join(", ");
    const whereCols = presentCols
      .map((c) => `"${c.column}" IS NOT NULL`)
      .join(" OR ");
    const rows = await pool.query(
      `SELECT ${selectCols} FROM "${table}" WHERE ${whereCols}`,
    );

    const deleteRowIds = new Set();
    for (const col of presentCols) {
      const badIds = [];
      for (const row of rows.rows) {
        const raw = row[col.column];
        if (raw === null || raw === undefined) continue;
        let decrypted;
        try {
          decrypted = decryptApiKeyMirror(raw, key);
        } catch {
          badIds.push(row[pk]);
          continue;
        }
        if (col.locatorColumn && row[col.locatorColumn]) {
          const computed = computeApiKeyLocatorMirror(decrypted, key);
          if (computed !== row[col.locatorColumn]) badIds.push(row[pk]);
        }
      }
      if (badIds.length === 0) continue;

      if (col.repairKind === "delete_row") {
        for (const id of badIds) deleteRowIds.add(id);
        continue; // reported once for the whole table below
      }

      findings.push({
        category: "encrypted_column",
        severity: "auto-fixable",
        table,
        column: col.column,
        description: `${badIds.length} row(s) in ${table}.${col.column} do not decrypt to a usable value with the configured API_KEY_ENCRYPTION_KEY (see _lib.encrypted-columns.mjs for why "${col.repairKind}" is the safe repair).`,
        count: badIds.length,
        examples: badIds.slice(0, 5).map((id) => ({ pk: id })),
        repair: buildRepair(col, badIds, pk),
      });
    }

    if (deleteRowIds.size > 0) {
      const ids = [...deleteRowIds];
      const pairedCol = presentCols.find((c) => c.repairKind === "delete_row");
      findings.push({
        category: "encrypted_column",
        severity: "auto-fixable",
        table,
        column: presentCols.map((c) => c.column).join("/"),
        description: `${ids.length} row(s) in ${table} have an undecryptable access_token or refresh_token. Both are read together (lib/discord/discord-utils.ts), so the connection is already unusable; safe repair matches the existing self-service "disconnect" action.`,
        count: ids.length,
        examples: ids.slice(0, 5).map((id) => ({ pk: id })),
        repair: buildRepair(pairedCol ?? presentCols[0], ids, pk),
      });
    }
  }

  return { findings, meta: { encryptionConfigured: Boolean(key) } };
}
