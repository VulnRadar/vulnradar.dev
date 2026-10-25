import pool from "@/lib/database/db";
import { scanNumericId } from "@/lib/history/resolve-scan";
import type {
  AdminScanDetail,
  AdminScanFinding,
} from "@/components/admin/types";

/**
 * One scan as staff see it, for the scan inspector.
 *
 * GET /api/v3/history/[id] serves the owner and teammates and answers 404 to
 * everyone else, staff included, so a support request about "my scan failed"
 * or "this finding is wrong" could not be looked at without database access.
 * The queue's failure list and the user panel's Recent Scans were both dead
 * ends for the same reason. This is the read those pages link to.
 */

/**
 * Findings returned. A scan can carry a few thousand, and the inspector is for
 * working out what happened, not for reading a report: the owner's own
 * results page is where the full set lives.
 */
export const SCAN_DETAIL_FINDINGS_CAP = 100;

/** Evidence is the one free-text field that can be large (a response body). */
const EVIDENCE_EXCERPT_CHARS = 300;

/** Public ids are opaque tokens; anything else cannot match one. */
const PUBLIC_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

interface ScanDetailRow {
  id: number;
  public_id: string | null;
  user_id: number;
  url: string;
  status: string;
  failure_kind: string | null;
  error_message: string | null;
  source: string | null;
  scan_type: string | null;
  started_at: string | Date | null;
  scanned_at: string | Date | null;
  duration: number | null;
  findings_count: number | null;
  summary: Record<string, number> | null;
  current_category: string | null;
  categories_completed: number | null;
  categories_total: number | null;
  authenticated: boolean | null;
  is_public: boolean | null;
  findings: unknown;
  result_meta: Record<string, unknown> | null;
  user_email: string | null;
  user_name: string | null;
}

function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function compactFinding(raw: unknown): AdminScanFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  const evidence = text(f.evidence);
  return {
    id: text(f.id) ?? "",
    title: text(f.title) ?? "(untitled finding)",
    severity: text(f.severity) ?? "info",
    category: text(f.category) ?? "",
    confidence: typeof f.confidence === "number" ? f.confidence : null,
    cwe: text(f.cwe),
    evidence:
      evidence && evidence.length > EVIDENCE_EXCERPT_CHARS
        ? `${evidence.slice(0, EVIDENCE_EXCERPT_CHARS)}...`
        : evidence,
  };
}

/**
 * Look a scan up by public_id or by its numeric id, the same two shapes
 * resolveScanRow accepts, and shape it for the inspector. Null when nothing
 * matches.
 *
 * `includeUser` is whether the caller may see who owns the scan beyond their
 * numeric id. The ops role holds VIEW_ALL_SCANS but deliberately not
 * VIEW_USERS, so it gets `#id` and no address.
 *
 * `partialFindings` is stripped from result_meta in SQL: it is the running
 * scan's progress list, it is written as a whole-array on every flush, and a
 * poll of a finished scan clears it anyway.
 */
export async function getAdminScanDetail(
  idParam: string,
  options: { includeUser: boolean },
): Promise<AdminScanDetail | null> {
  const numericId = scanNumericId(idParam);
  if (numericId === null && !PUBLIC_ID_SHAPE.test(idParam)) return null;

  const result = await pool.query<ScanDetailRow>(
    `SELECT sh.id, sh.public_id, sh.user_id, sh.url, sh.status, sh.failure_kind,
            sh.error_message, sh.source, sh.scan_type, sh.started_at,
            sh.scanned_at, sh.duration, sh.findings_count, sh.summary,
            sh.current_category, sh.categories_completed, sh.categories_total,
            sh.authenticated, sh.is_public, sh.findings,
            (sh.result_meta - 'partialFindings') AS result_meta,
            u.email AS user_email, u.name AS user_name
       FROM scan_history sh
       LEFT JOIN users u ON u.id = sh.user_id
      WHERE sh.public_id = $1 OR ($2::bigint IS NOT NULL AND sh.id = $2)
      LIMIT 1`,
    [idParam, numericId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const allFindings = Array.isArray(row.findings) ? row.findings : [];
  const findings = allFindings
    .slice(0, SCAN_DETAIL_FINDINGS_CAP)
    .map(compactFinding)
    .filter((f): f is AdminScanFinding => f !== null);

  const inFlight = row.status === "pending" || row.status === "running";

  return {
    id: row.id,
    publicId: row.public_id,
    url: row.url,
    status: row.status,
    failureKind: row.failure_kind,
    errorMessage: row.error_message,
    source: row.source ?? "web",
    scanType: row.scan_type ?? "web",
    startedAt: iso(row.started_at),
    scannedAt: iso(row.scanned_at),
    durationMs: Number(row.duration ?? 0),
    progress: inFlight
      ? {
          currentCategory: row.current_category,
          completed: Number(row.categories_completed ?? 0),
          total: Number(row.categories_total ?? 0),
        }
      : null,
    findingsCount: Number(row.findings_count ?? 0),
    summary: row.summary,
    authenticated: row.authenticated === true,
    isPublic: row.is_public,
    resultMeta: row.result_meta,
    findings,
    findingsTruncated: allFindings.length > SCAN_DETAIL_FINDINGS_CAP,
    user: {
      id: row.user_id,
      email: options.includeUser ? row.user_email : null,
      name: options.includeUser ? row.user_name : null,
    },
  };
}
