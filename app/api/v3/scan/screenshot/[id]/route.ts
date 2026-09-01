import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveScanRow, scanNumericId } from "@/lib/history/resolve-scan";
import { getScanResourceAccess } from "@/lib/teams/scan-teams";
import { readScanScreenshot } from "@/lib/scanner/page-screenshot";

/**
 * GET /api/v3/scan/screenshot/[id]
 *
 * Serves the opt-in page screenshot bytes for one scan (see
 * lib/scanner/page-screenshot.ts). `[id]` is the scan's opaque public_id
 * (or a legacy numeric id), resolved the same way every other history
 * subroute resolves it.
 *
 * Authorization mirrors who may already SEE the scan's findings: a public
 * scan's screenshot is served to anyone (this backs the owner dashboard, the
 * History reopen, and any public surface), and a private scan's screenshot
 * only to its owner or a co-member of the team it's assigned to. The shared
 * public-link surface has its own token-scoped route
 * (app/api/v3/shared/[token]/screenshot) so a private-but-shared scan's
 * screenshot loads there too, exactly where its findings already do.
 *
 * A missing scan, a missing screenshot, and an unauthorized request all
 * return 404 -- anti-enumeration, same as the other per-scan routes: a
 * stranger can never use a 403-vs-404 split to learn a scan id is real.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const scan = await resolveScanRow(id);
  if (!scan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await getSession();

  // The anonymous branch is deliberate (a public scan's screenshot backs the
  // public /host/[hostname] report), but it must not be reachable by walking
  // an id space. resolveScanRow still accepts a legacy numeric primary key
  // alongside the opaque public_id, and those ids are sequential 1..N, so
  // without this a caller with no identity at all could enumerate every
  // public scan's screenshot by counting. A signed-in caller keeps the legacy
  // id (their own old links still resolve); a stranger has to present the
  // non-guessable public_id, exactly as they would to see the findings.
  if (!session && scanNumericId(id) !== null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let authorized = scan.is_public === true;
  if (!authorized) {
    if (session) {
      const access = await getScanResourceAccess(session.userId, scan);
      authorized = access.canRead;
    }
  }
  if (!authorized) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const shot = await readScanScreenshot(scan.id);
  if (!shot) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(shot.data, {
    headers: {
      "Content-Type": shot.contentType,
      // The image never changes for a given scan id, so it's safe to cache.
      // Kept private: a public scan's screenshot could turn private later
      // (the owner toggles visibility), and a shared CDN copy must not
      // outlive that.
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
