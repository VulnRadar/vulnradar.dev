import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { scanPorts } from "@/lib/scanner/port-scan";
import { isUrlOwnedByUser } from "@/lib/domains/scope";
import {
  resolveOwnedScan,
  mergeResultMeta,
  scanHostname,
} from "@/lib/history/refresh-scan";

export const runtime = "nodejs";
// scanPorts is internally bounded (12s wall-clock deadline) but the whole
// route needs headroom above that for auth + the ownership lookup.
export const maxDuration = 30;

/**
 * POST /api/v3/history/[id]/ports
 *
 * Owner-only: re-run the curated port sweep for this scan's host and store the
 * fresh result into result_meta.portScan, returning it so the "Open ports"
 * panel updates in place. Enforces the SAME verified-domain ownership gate the
 * scan-time sweep uses (lib/domains/scope.ts) -- port scanning from a shared
 * server against a domain the caller doesn't control is abuse, so an
 * unverified domain gets the same 403 (DOMAIN_NOT_VERIFIED). scanPorts is
 * best-effort, never throws, and refuses any internal/SSRF target as defence
 * in depth.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const owned = await resolveOwnedScan(id);
  if (!owned.ok) return owned.response;
  const { scan, userId } = owned;

  const rl = await checkRateLimit({
    key: `refresh-ports:${userId}`,
    ...RATE_LIMITS.scan,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Please wait before refreshing again." },
      { status: 429 },
    );
  }

  // Verified-domain ownership: identical gate to the scan-time port sweep in
  // app/api/v3/scan/route.ts. Refresh must not become a way to sweep a domain
  // the caller never proved ownership of.
  if (!(await isUrlOwnedByUser(scan.url, userId))) {
    return NextResponse.json(
      {
        error:
          "Port scanning requires a verified domain. Verify ownership of this domain (or its parent) in Profile > Domains before refreshing the port sweep.",
        statusCode: "DOMAIN_NOT_VERIFIED",
      },
      { status: 403 },
    );
  }

  const hostname = scanHostname(scan.url);
  if (!hostname) {
    return NextResponse.json(
      { error: "This scan's target has no resolvable hostname." },
      { status: 400 },
    );
  }

  const portScan = await scanPorts(hostname, AbortSignal.timeout(20_000));
  if (!portScan) {
    return NextResponse.json(
      {
        error:
          "The port sweep could not run against this host (it may be unresolvable or resolve to an internal address).",
      },
      { status: 422 },
    );
  }

  await mergeResultMeta(scan.id, userId, { portScan });
  return NextResponse.json({ portScan });
}
