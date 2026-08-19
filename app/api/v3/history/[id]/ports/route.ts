import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { scanPorts, readPortScan, recordPortScan } from "@/lib/scanner/port-scan";
import { isUrlOwnedByUser } from "@/lib/domains/scope";
import {
  resolveOwnedScan,
  requireRefreshPlan,
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
 *
 * Premium-gated (requireRefreshPlan), matching the subdomain panel's refresh
 * control: on the hosted SaaS a re-run is a paid feature, but a self-hosted
 * deployment (BILLING_ENABLED=false) allows it for everyone. A short per-host
 * TTL cache (readPortScan/recordPortScan) means repeat refreshes of the same
 * host within the window reuse the last sweep instead of re-scanning.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const owned = await resolveOwnedScan(id);
  if (!owned.ok) return owned.response;
  const { scan, userId } = owned;

  const gate = await requireRefreshPlan(userId);
  if (!gate.ok) return gate.response;

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

  // Reuse a fresh sweep for this host if the short TTL cache still has one;
  // otherwise re-run the sweep and record it for the next refresh in the window.
  let portScan = readPortScan(hostname);
  if (!portScan) {
    const fresh = await scanPorts(hostname, AbortSignal.timeout(20_000));
    if (!fresh) {
      return NextResponse.json(
        {
          error:
            "The port sweep could not run against this host (it may be unresolvable or resolve to an internal address).",
        },
        { status: 422 },
      );
    }
    recordPortScan(hostname, fresh);
    portScan = fresh;
  }

  await mergeResultMeta(scan.id, userId, { portScan });
  return NextResponse.json({ portScan });
}
