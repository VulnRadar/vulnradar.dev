/**
 * The per-page scan_history rows a crawl saves beside its tracker row.
 *
 * Split out of execute-crawl-scan.ts so the one statement that matters here can
 * be run against a real database (tests/integration/crawl-page-rows.test.ts):
 * the guard below is an EXISTS inside the INSERT, and a faked pool answers that
 * statement the same whether the guard works or not.
 */

import pool from "@/lib/database/db";

/** One crawled page that was actually read and checked. */
export interface CrawlPageRow {
  url: string;
  summary: Record<string, number>;
  findings: unknown[];
  findingsCount: number;
  duration: number;
  responseHeaders: Record<string, string>;
  resultMeta: Record<string, unknown>;
}

/** What every page row of one crawl shares: whose it is and who can see it. */
export interface CrawlPageRowOwner {
  userId: number;
  scannedAt: string;
  source: "api" | "web";
  notes: string;
  /**
   * scan_history.is_public defaults to TRUE, so a row that omits it publishes
   * the page on the unauthenticated /host/[hostname] surfaces. The crawl
   * resolves privacy once and hands it to every page.
   */
  isPublic: boolean;
  authenticated: boolean;
  teamId: number | null;
}

/**
 * Column and cast, in INSERT order. The casts are not decoration: the values
 * arrive through a VALUES list in a SELECT, where an untyped parameter is
 * resolved as text and then refused by the integer, jsonb and timestamptz
 * columns. A bare multi-row INSERT ... VALUES infers them from the target.
 */
const COLUMNS = [
  ["user_id", "integer"],
  ["url", "text"],
  ["summary", "jsonb"],
  ["findings", "jsonb"],
  ["findings_count", "integer"],
  ["duration", "integer"],
  ["scanned_at", "timestamptz"],
  ["source", "text"],
  ["response_headers", "jsonb"],
  ["notes", "text"],
  ["is_public", "boolean"],
  ["authenticated", "boolean"],
  ["team_id", "integer"],
  ["result_meta", "jsonb"],
] as const;

/**
 * Save the pages of a crawl as their own history entries, but only while the
 * crawl's tracker row is still `pending` or `running`.
 *
 * The check is inside the statement because anything outside it leaves a
 * window. The rows used to be written unconditionally, after the page loop,
 * and only then did finalizeScanSuccess apply its own status guard. A cancel
 * or the watchdog landing between the two (the enrichment passes in between
 * take seconds on a big crawl) left the tracker `failed` with up to 250 page
 * rows in History as completed scans, for a crawl the owner was told had
 * been cancelled. With the EXISTS, a tracker that already went terminal
 * inserts nothing and the result is an empty map.
 *
 * One multi-row INSERT, not one per page: it used to be a sequential loop, so
 * an Elite crawl paid up to 250 serialized round trips at the very tail of a
 * scan the owner is already waiting on. Ids come back keyed by url rather than
 * by position because RETURNING order is not something Postgres promises.
 * ref: AUDIT-012#perf-26
 */
export async function insertCrawlPageRows(
  trackerScanId: number,
  owner: CrawlPageRowOwner,
  rows: readonly CrawlPageRow[],
): Promise<Record<string, number>> {
  if (rows.length === 0) return {};

  const params: unknown[] = [trackerScanId];
  const tuples = rows.map((row) => {
    const base = params.length;
    params.push(
      owner.userId,
      row.url,
      JSON.stringify(row.summary),
      JSON.stringify(row.findings),
      row.findingsCount,
      row.duration,
      owner.scannedAt,
      owner.source,
      JSON.stringify(row.responseHeaders),
      owner.notes,
      owner.isPublic,
      owner.authenticated,
      owner.teamId,
      JSON.stringify(row.resultMeta),
    );
    return `(${COLUMNS.map(([, type], i) => `$${base + i + 1}::${type}`).join(", ")})`;
  });

  const { rows: inserted } = await pool.query<{ id: number; url: string }>(
    `INSERT INTO scan_history (${COLUMNS.map(([name]) => name).join(", ")})
     SELECT v.* FROM (VALUES ${tuples.join(", ")}) AS v
     WHERE EXISTS (
       SELECT 1 FROM scan_history
       WHERE id = $1 AND status IN ('pending', 'running')
     )
     RETURNING id, url`,
    params,
  );

  const ids: Record<string, number> = {};
  for (const row of inserted) ids[row.url] = row.id;
  return ids;
}
