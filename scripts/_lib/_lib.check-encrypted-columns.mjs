/**
 * VulnRadar — Encrypted-column decrypt-failure detection.
 *
 * Covers every column in ENCRYPTED_COLUMNS (see
 * _lib.encrypted-columns.mjs for how that list was built and why
 * users.totp_secret is deliberately excluded -- that one is already
 * owned by scripts/maintenance/db-diagnose-2fa.mjs / scripts/maintenance/db-repair-2fa.mjs).
 *
 * For each row with a non-null value in an encrypted column:
 *   1. Neither API_KEY_ENCRYPTION_KEY nor PREVIOUS_API_KEY_ENCRYPTION_KEY
 *      opens it -> repair-eligible per the column's registered repairKind.
 *   2. A key opens it, but (for api_keys.key_encrypted only, where a
 *      key_locator gives us something independent to check against) the
 *      recomputed locator matches under neither key -> same repair, same
 *      reasoning as (1): the plaintext isn't real.
 *   3. Only the previous key opens it -> reported as still on the previous
 *      key and never repaired. That is a healthy row in the middle of the
 *      documented rotation (lib/auth/crypto.ts); treating it as corrupt is
 *      how a rotation used to end in revoked keys and deleted connections.
 *
 * If PREVIOUS_API_KEY_ENCRYPTION_KEY is set but malformed, a failed decrypt
 * proves nothing, so the columns are reported as unchecked instead.
 *
 * If API_KEY_ENCRYPTION_KEY isn't configured for this run, every column
 * is skipped with a needs-human "could not check" finding rather than
 * silently reporting nothing -- mirrors the 2FA tool's
 * ENCRYPTION_NOT_CONFIGURED category exactly.
 */
import { ENCRYPTED_COLUMNS } from "./_lib.encrypted-columns.mjs";
import {
  getKnownKeys,
  isPreviousKeyUnusable,
  openWithKnownKeys,
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

/**
 * The stored locator was computed with whichever key was current when the row
 * was last written, which need not be the key that opens its ciphertext today.
 */
function locatorMatchesAnyKey(plaintext, stored, keys) {
  return [keys.current, keys.previous].some(
    (key) => key && computeApiKeyLocatorMirror(plaintext, key) === stored,
  );
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
  const keys = getKnownKeys();
  const previousUnusable = isPreviousKeyUnusable();
  let stillOnPreviousKey = 0;

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

    if (keys.current && previousUnusable) {
      findings.push({
        category: "encrypted_column",
        severity: "needs-human",
        table,
        column: presentCols.map((c) => c.column).join(", "),
        description:
          "PREVIOUS_API_KEY_ENCRYPTION_KEY is set but is not a 64-character hex string, so a value that does not open with the current key may still be healthy. Fix or remove it, then re-run.",
        count: 0,
        examples: [],
      });
      continue;
    }

    if (!keys.current) {
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
      const onPreviousIds = [];
      for (const row of rows.rows) {
        const raw = row[col.column];
        if (raw === null || raw === undefined) continue;
        const locator = col.locatorColumn && row[col.locatorColumn];
        const { status } = openWithKnownKeys(
          raw,
          keys,
          (plaintext) =>
            !locator || locatorMatchesAnyKey(plaintext, locator, keys),
        );
        if (status === "previous") onPreviousIds.push(row[pk]);
        else if (status !== "current") badIds.push(row[pk]);
      }

      if (onPreviousIds.length > 0) {
        stillOnPreviousKey += onPreviousIds.length;
        findings.push({
          category: "encrypted_column_on_previous_key",
          severity: "needs-human",
          table,
          column: col.column,
          description: `${onPreviousIds.length} row(s) in ${table}.${col.column} are still encrypted under PREVIOUS_API_KEY_ENCRYPTION_KEY. They work, and keep working only while that variable stays set: nothing to repair, but do not remove it yet.`,
          count: onPreviousIds.length,
          examples: onPreviousIds.slice(0, 5).map((id) => ({ pk: id })),
        });
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
        description: `${badIds.length} row(s) in ${table}.${col.column} do not decrypt to a usable value with API_KEY_ENCRYPTION_KEY or PREVIOUS_API_KEY_ENCRYPTION_KEY (see _lib.encrypted-columns.mjs for why "${col.repairKind}" is the safe repair).`,
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

  return {
    findings,
    meta: { encryptionConfigured: Boolean(keys.current), stillOnPreviousKey },
  };
}
