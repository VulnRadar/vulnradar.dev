import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  resolveOwnedDomain,
  readDomainBlock,
  blockDomain,
  unblockDomain,
} from "@/lib/domains/owner-control";

export const runtime = "nodejs";

/** Longest reason a domain owner may attach to their own block. */
const MAX_REASON_LENGTH = 200;

/**
 * GET /api/v3/domains/[id]/block
 *
 * Whether this verified domain is currently blocked from being scanned, and
 * whether this caller can lift it. A staff block is reported as a block that
 * is not liftable rather than hidden, so the owner is told the truth instead
 * of being shown a control that would do nothing.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await resolveRequest(params);
  if ("response" in gate) return gate.response;

  const block = await readDomainBlock(gate.domain, gate.userId);
  return NextResponse.json({ domain: gate.domain, block });
}

/**
 * POST /api/v3/domains/[id]/block
 *
 * Stop anyone scanning this domain or any host beneath it. Same mechanism and
 * same enforcement path as an admin blocklist entry (a 'url' access_rules row,
 * refused by checkAccessRules before any scan starts), because it is the same
 * statement: do not scan this.
 *
 * This is a real opt-out, not a preference. Verifying the domain is what earns
 * it: a DNS TXT record at the apex is the same proof every mainstream system
 * accepts for "I speak for this zone".
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await resolveRequest(params);
  if ("response" in gate) return gate.response;

  const rl = await checkRateLimit({
    key: `domain-block:${gate.userId}`,
    ...RATE_LIMITS.scan,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many changes at once. Please wait and try again." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, MAX_REASON_LENGTH)
      : `Scanning was switched off by the verified owner of ${gate.domain}.`;

  const block = await blockDomain(gate.domain, gate.userId, reason);
  return NextResponse.json({ domain: gate.domain, block });
}

/**
 * DELETE /api/v3/domains/[id]/block
 *
 * Lift a block this account created. A staff block is not lifted here at any
 * level of domain ownership: it exists because someone decided this target
 * should not be scanned from this deployment, and proving you own the domain
 * is not an answer to that. The 409 says so rather than reporting a silent
 * success that changes nothing.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await resolveRequest(params);
  if ("response" in gate) return gate.response;

  const lifted = await unblockDomain(gate.domain, gate.userId);
  if (!lifted) {
    const block = await readDomainBlock(gate.domain, gate.userId);
    if (block) {
      return NextResponse.json(
        {
          error:
            "This block was put in place by staff, so it cannot be lifted here. Contact support if you believe it is a mistake.",
          block,
        },
        { status: 409 },
      );
    }
  }
  return NextResponse.json({ domain: gate.domain, block: null });
}

/**
 * Session plus verified-domain ownership, or the response to return instead.
 *
 * A domain the caller does not own answers 404, not 403, matching the rest of
 * /api/v3/domains: there is no read-only variant of any of these actions, so a
 * non-owner learns nothing about whether the id exists.
 */
async function resolveRequest(
  params: Promise<{ id: string }>,
): Promise<{ userId: number; domain: string } | { response: NextResponse }> {
  const session = await getSession();
  if (!session) {
    return {
      response: NextResponse.json(
        { error: ERROR_MESSAGES.UNAUTHORIZED },
        { status: 401 },
      ),
    };
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return {
      response: NextResponse.json(
        { error: "Invalid domain id" },
        { status: 400 },
      ),
    };
  }

  const owned = await resolveOwnedDomain(id, session.userId);
  if (!owned) {
    return {
      response: NextResponse.json(
        { error: "Domain not found" },
        { status: 404 },
      ),
    };
  }

  return { userId: session.userId, domain: owned.domain };
}
