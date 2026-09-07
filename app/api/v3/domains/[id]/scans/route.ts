import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  resolveOwnedDomain,
  listDomainScans,
  applyDomainScanAction,
  type DomainScanAction,
} from "@/lib/domains/owner-control";

export const runtime = "nodejs";

/**
 * GET /api/v3/domains/[id]/scans
 *
 * Every publicly reachable scan of a domain this caller has verified, from any
 * account. See lib/domains/owner-control.ts for why the list is scoped to
 * public and shared rows only: those are the ones a stranger can already read,
 * and a private scan someone else ran is their own record, not exposure of
 * this domain.
 *
 * A domain the caller does not own answers 404 rather than 403. There is no
 * read-only variant of this, so a non-owner learns nothing about whether the
 * id exists, matching PATCH /api/v3/domains/[id] above it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid domain id" }, { status: 400 });
  }

  const owned = await resolveOwnedDomain(id, session.userId);
  if (!owned) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  const limit = await getSetting("HISTORY_LIST_MAX_ROWS");
  const scans = await listDomainScans(owned.domain, session.userId, limit);

  return NextResponse.json({ domain: owned.domain, scans });
}

const VALID_ACTIONS: DomainScanAction[] = ["unpublish", "revoke-shares"];

/**
 * PATCH /api/v3/domains/[id]/scans
 *
 * Withdraw public exposure of scans of a verified domain: `unpublish` takes
 * them off /public-scans and /host, `revoke-shares` kills their unlisted share
 * links. Body: `{ action, publicIds? }`, where omitting publicIds applies to
 * every covered scan.
 *
 * It never deletes anything. The report stays in its own owner's private
 * history; what a domain owner controls is whether it is published, not
 * whether another account may keep its own record. See the module header in
 * lib/domains/owner-control.ts.
 *
 * Rate limited on the scan bucket: it is a bulk write across other accounts'
 * rows, so it is held to the same per-user ceiling a scan is.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid domain id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    publicIds?: unknown;
  };

  const action = body.action as DomainScanAction;
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  // Absent means "every covered scan". An explicitly EMPTY array is a client
  // that meant to name scans and named none, and applying that to all of them
  // would be the worst possible reading of it.
  let publicIds: string[] | null = null;
  if (body.publicIds !== undefined) {
    if (!Array.isArray(body.publicIds)) {
      return NextResponse.json(
        { error: "publicIds must be an array of scan ids" },
        { status: 400 },
      );
    }
    publicIds = body.publicIds.filter(
      (v): v is string => typeof v === "string",
    );
    if (publicIds.length === 0) {
      return NextResponse.json({ affected: 0 });
    }
  }

  const owned = await resolveOwnedDomain(id, session.userId);
  if (!owned) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  const rl = await checkRateLimit({
    key: `domain-scan-action:${session.userId}`,
    ...RATE_LIMITS.scan,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many changes at once. Please wait and try again." },
      { status: 429 },
    );
  }

  const result = await applyDomainScanAction(owned.domain, action, publicIds);
  return NextResponse.json(result);
}
