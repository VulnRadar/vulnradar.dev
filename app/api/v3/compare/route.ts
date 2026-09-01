import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { withErrorHandling } from "@/lib/api/api-utils";
import { diffFindingsByKey } from "@/lib/scanner/finding-diff";
import { scanNumericId } from "@/lib/history/resolve-scan";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const scanAId = request.nextUrl.searchParams.get("a");
  const scanBId = request.nextUrl.searchParams.get("b");

  if (!scanAId || !scanBId) {
    return NextResponse.json(
      { error: "Both scan IDs (a and b) are required" },
      { status: 400 },
    );
  }

  // The ids reaching this route are scan_history.public_id: the history list
  // this page is populated from projects `sh.public_id AS id`
  // (app/api/v3/history/route.ts). Matching them against the SERIAL primary
  // key meant a public_id starting with a digit was silently coerced to a
  // different scan of the caller's own (Postgres casts '7a3f...' no further
  // than 7 only after the client's parseInt in getQueryParamInt, and the
  // picker path passed the raw hex straight through, erroring with 22P02).
  // Every other history subroute already resolves both shapes through
  // lib/history/resolve-scan.ts; this one was the last that did not.
  // The user_id gate is unchanged, so this was never a cross-tenant read.
  const result = await pool.query(
    `SELECT id, public_id, url, summary, findings, findings_count, duration, scanned_at, source
     FROM scan_history
     WHERE (public_id = $1 OR ($3::bigint IS NOT NULL AND id = $3)
         OR public_id = $2 OR ($4::bigint IS NOT NULL AND id = $4))
       AND user_id = $5
     ORDER BY scanned_at ASC`,
    [
      scanAId,
      scanBId,
      scanNumericId(scanAId),
      scanNumericId(scanBId),
      session.userId,
    ],
  );

  if (result.rows.length === 1) {
    // One row can mean two different things. Usually the second scan simply
    // is not the caller's, which stays a 404 below. But two DISTINCT params
    // can also address the same row, one by legacy numeric id and one by
    // that row's public_id, and telling the user "not found" for a scan that
    // was found would be a lie.
    const row = result.rows[0];
    const addresses = (param: string) =>
      param === row.public_id || scanNumericId(param) === Number(row.id);
    if (addresses(scanAId) && addresses(scanBId)) {
      return NextResponse.json(
        { error: "Pick two different scans to compare" },
        { status: 400 },
      );
    }
  }

  if (result.rows.length !== 2) {
    return NextResponse.json(
      { error: "One or both scans not found" },
      { status: 404 },
    );
  }

  const [scanA, scanB] = result.rows;

  // Compute diff: which findings are new, removed, or still present
  const rawA =
    typeof scanA.findings === "string"
      ? JSON.parse(scanA.findings)
      : scanA.findings;
  const rawB =
    typeof scanB.findings === "string"
      ? JSON.parse(scanB.findings)
      : scanB.findings;
  const findingsA: { title: string; severity: string }[] = (rawA || []).map(
    (f: { title: string; severity: string }) => ({
      title: f.title,
      severity: f.severity,
    }),
  );
  const findingsB: { title: string; severity: string }[] = (rawB || []).map(
    (f: { title: string; severity: string }) => ({
      title: f.title,
      severity: f.severity,
    }),
  );

  // Keyed by title: this route only ever has {title, severity} once a
  // stored scan's findings are stripped down for the response (see the
  // .map() above), not the full Vulnerability with its stable `id`. See
  // lib/scanner/finding-diff.ts for why the regression-alert check (which
  // does have `id`) keys on that instead.
  const { added, removed, unchanged } = diffFindingsByKey(
    findingsA,
    findingsB,
    (f) => f.title,
  );

  return NextResponse.json({
    scanA: {
      id: scanA.id,
      url: scanA.url,
      summary: scanA.summary,
      findings_count: scanA.findings_count,
      scanned_at: scanA.scanned_at,
      source: scanA.source,
    },
    scanB: {
      id: scanB.id,
      url: scanB.url,
      summary: scanB.summary,
      findings_count: scanB.findings_count,
      scanned_at: scanB.scanned_at,
      source: scanB.source,
    },
    diff: {
      added,
      removed,
      unchanged,
      summary: {
        added: added.length,
        removed: removed.length,
        unchanged: unchanged.length,
      },
    },
  });
});
