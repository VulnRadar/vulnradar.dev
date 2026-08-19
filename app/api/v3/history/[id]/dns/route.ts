import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  resolveDnsRecords,
  hasAnyDnsRecords,
  readDnsRecords,
  recordDnsRecords,
} from "@/lib/scanner/dns-records";
import {
  resolveOwnedScan,
  requireRefreshPlan,
  mergeResultMeta,
  scanHostname,
} from "@/lib/history/refresh-scan";

export const runtime = "nodejs";

/**
 * POST /api/v3/history/[id]/dns
 *
 * Owner-only: re-resolve the full structured DNS record set for this scan's
 * host and store it back into result_meta.dnsRecords, returning the fresh
 * records so the DNS panel updates in place. Cheap (node:dns only, no fetch),
 * best-effort, and bounded by resolveDnsRecords' own per-query timeouts.
 *
 * Premium-gated (requireRefreshPlan), matching the subdomain panel's refresh
 * control: on the hosted SaaS a re-fetch is a paid feature, but a self-hosted
 * deployment (BILLING_ENABLED=false) allows it for everyone.
 *
 * A short per-host TTL cache (readDnsRecords/recordDnsRecords, the same side
 * channel checkDNSSecurity fills at scan time) means repeat refreshes of the
 * same host within the window reuse the last capture instead of re-resolving.
 *
 * A resolve that comes back completely empty (every query timed out) is NOT
 * written, so a transient failure can never wipe the records the panel already
 * shows.
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
    key: `refresh-dns:${userId}`,
    ...RATE_LIMITS.scan,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Please wait before refreshing again." },
      { status: 429 },
    );
  }

  const hostname = scanHostname(scan.url);
  if (!hostname) {
    return NextResponse.json(
      { error: "This scan's target has no resolvable hostname." },
      { status: 400 },
    );
  }

  // Reuse a fresh capture for this host if the short TTL cache still has one;
  // otherwise re-resolve and record it for the next refresh within the window.
  let dnsRecords = readDnsRecords(hostname);
  if (!dnsRecords) {
    dnsRecords = await resolveDnsRecords(hostname);
    if (!hasAnyDnsRecords(dnsRecords)) {
      return NextResponse.json(
        { error: "No DNS records resolved for this host right now." },
        { status: 404 },
      );
    }
    recordDnsRecords(hostname, dnsRecords);
  }

  await mergeResultMeta(scan.id, userId, { dnsRecords });
  return NextResponse.json({ dnsRecords });
}
