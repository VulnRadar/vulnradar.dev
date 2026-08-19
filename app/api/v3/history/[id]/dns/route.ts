import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { resolveDnsRecords, hasAnyDnsRecords } from "@/lib/scanner/dns-records";
import {
  resolveOwnedScan,
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
 * best-effort, and bounded by resolveDnsRecords' own per-query timeouts. This
 * mirrors the subdomain panel's refresh control but needs no premium gate --
 * a DNS resolve costs nothing on a shared host the way a browser session or a
 * port sweep does.
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

  const dnsRecords = await resolveDnsRecords(hostname);
  if (!hasAnyDnsRecords(dnsRecords)) {
    return NextResponse.json(
      { error: "No DNS records resolved for this host right now." },
      { status: 404 },
    );
  }

  await mergeResultMeta(scan.id, userId, { dnsRecords });
  return NextResponse.json({ dnsRecords });
}
