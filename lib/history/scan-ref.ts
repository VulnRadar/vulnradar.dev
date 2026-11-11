import pool from "@/lib/database/db";
import { isPublicScanId, parseIdParam } from "@/lib/api/path-id";

/**
 * A scan named by a client: the 32 character public id, or the legacy numeric
 * id. Either spelling is accepted wherever a client hands a scan back to us,
 * because the numeric id is what POST /scan used to return and the public id is
 * what History lists, and a client holding one must not have to ask for the
 * other first.
 */
export interface ScanRef {
  /** The id as the client spelled it; matched against scan_history.public_id. */
  raw: string;
  /** The primary key it reads as, or null for a public id. */
  numericId: number | null;
}

/**
 * Null for anything that cannot name a scan, so a caller answers 404 or 400
 * without a query. A bare number is accepted because JSON clients send the
 * legacy id as one.
 */
export function parseScanRef(raw: unknown): ScanRef | null {
  const text = typeof raw === "number" ? String(raw) : raw;
  if (typeof text !== "string") return null;
  if (isPublicScanId(text)) return { raw: text, numericId: null };
  const numericId = parseIdParam(text);
  return numericId === null ? null : { raw: text, numericId };
}

/**
 * The caller's own scan, or null when it is missing or somebody else's (the
 * same answer for both, so ids cannot be probed).
 *
 * Ownership is in the predicate and the projection is two columns, rather than
 * resolveScanRow's SELECT * followed by a user_id comparison: a scan row carries
 * JSONB columns holding every finding, and a guessable numeric id would make
 * the server detoast somebody else's before deciding to refuse.
 */
export async function findOwnedScan(
  ref: ScanRef,
  userId: number,
): Promise<{ id: number; url: string } | null> {
  const result = await pool.query<{ id: number; url: string }>(
    `SELECT id, url FROM scan_history
     WHERE (public_id = $1 OR ($2::bigint IS NOT NULL AND id = $2))
       AND user_id = $3
     LIMIT 1`,
    [ref.raw, ref.numericId, userId],
  );
  return result.rows[0] ?? null;
}
