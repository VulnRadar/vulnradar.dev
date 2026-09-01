import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import crypto from "crypto";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { resolveSharePubliclyListed } from "@/lib/scanner/share-privacy";
import { resolveScanRow } from "@/lib/history/resolve-scan";
import { getScanResourceAccess } from "@/lib/teams/scan-teams";

/** Share links may expire in 7, 30, or 90 days, or never (the default,
 *  unchanged from before this field existed). */
const ALLOWED_EXPIRY_DAYS = new Set([7, 30, 90]);

/** Resolve the request body's `expiresInDays` into an ISO expiry timestamp.
 *  Returns `undefined` when the field is absent entirely -- distinct from
 *  `null`, which means "explicitly never expires" -- so a caller that omits
 *  it (e.g. the existing one-click "Share this scan" action) leaves
 *  whatever expiry is already stored untouched instead of silently
 *  resetting it. Throws a plain string message for an invalid value; the
 *  caller turns that into a 400. */
function resolveExpiresAt(
  body: Record<string, unknown>,
): string | null | undefined {
  if (!("expiresInDays" in body)) return undefined;
  const raw = body.expiresInDays;
  if (raw === null || raw === "never") return null;
  const days = Number(raw);
  if (!ALLOWED_EXPIRY_DAYS.has(days)) {
    throw new Error("expiresInDays must be 7, 30, 90, or null");
  }
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function POST(
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

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  let expiresAt: string | null | undefined;
  try {
    expiresAt = resolveExpiresAt(body ?? {});
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid expiresInDays" },
      { status: 400 },
    );
  }

  // Optional per-share override for the Public Scans directory listing,
  // resolved below (only for a genuinely new share) via
  // resolveSharePubliclyListed. `undefined` when the field is absent --
  // the existing one-click "Share this scan" action doesn't send it, so it
  // falls through to the account default, same as expiresInDays' handling
  // above.
  const requestedPubliclyListed =
    body && typeof body === "object" && "publiclyListed" in body
      ? (body as Record<string, unknown>).publiclyListed
      : undefined;
  if (
    requestedPubliclyListed !== undefined &&
    typeof requestedPubliclyListed !== "boolean"
  ) {
    return NextResponse.json(
      { error: "publiclyListed must be a boolean" },
      { status: 400 },
    );
  }

  // Get the scan (by opaque public_id, or a legacy numeric id).
  const scan = await resolveScanRow(id);

  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  // Publishing a share link is a write/management action, scoped to the teams
  // the scan is actually shared with. For a private personal scan (no teams)
  // only the owner may share it -- getScanResourceAccess returns
  // canWrite:false for a non-owner. The prior "any shared team where caller is
  // owner/admin" check let a team admin publish a teammate's private personal
  // scan to the internet.
  if (scan.user_id !== session.userId) {
    const access = await getScanResourceAccess(session.userId, scan);
    if (!access.canWrite) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }
  }

  const isExpired = Boolean(
    scan.share_expires_at && new Date(scan.share_expires_at) <= new Date(),
  );

  // If already has a live (non-expired) share token, keep it -- only the
  // expiry may need updating, and only when the caller actually asked to
  // change it.
  if (scan.share_token && !isExpired) {
    // publiclyListed used to be validated at the top of this handler and then
    // silently dropped here, applied only when creating a genuinely new share.
    // Apply it, so a caller that sends it on an existing live share gets what
    // it asked for instead of a success response reporting the old value.
    //
    // Only an explicit boolean counts. An omitted field must NOT be re-resolved
    // through the account default the way a brand-new share is below: that
    // would clobber a per-share choice the owner made through
    // PUT .../share/publicly-listed just by pressing Share again.
    const nextPubliclyListed =
      typeof requestedPubliclyListed === "boolean"
        ? requestedPubliclyListed
        : scan.share_publicly_listed;
    // expiresAt: undefined means "not sent, leave it alone"; null means
    // "explicitly never expires" and must actually be written. Two statements
    // rather than one COALESCE, which would swallow the explicit null.
    if (expiresAt !== undefined) {
      await pool.query(
        "UPDATE scan_history SET share_expires_at = $1 WHERE id = $2",
        [expiresAt, scan.id],
      );
    }
    if (nextPubliclyListed !== scan.share_publicly_listed) {
      await pool.query(
        "UPDATE scan_history SET share_publicly_listed = $1 WHERE id = $2",
        [nextPubliclyListed, scan.id],
      );
    }
    return NextResponse.json({
      token: scan.share_token,
      expiresAt:
        expiresAt !== undefined ? expiresAt : (scan.share_expires_at ?? null),
      publiclyListed: nextPubliclyListed,
    });
  }

  // Generate a new share token: either there wasn't one yet, or the
  // previous one expired -- a lapsed link should not keep coming back from
  // "Share", it should be replaced with a fresh one.
  const token = crypto.randomBytes(32).toString("hex");
  const finalExpiresAt = expiresAt !== undefined ? expiresAt : null;

  // Public Scans directory: decided exactly once, right here, for a
  // genuinely new share -- see lib/scanner/share-privacy.ts's own comment
  // on why this resolves against the SCAN OWNER's account default (scan.
  // user_id), not necessarily the session user issuing this request.
  const publiclyListed = await resolveSharePubliclyListed(
    scan.user_id,
    typeof requestedPubliclyListed === "boolean"
      ? requestedPubliclyListed
      : undefined,
  );

  await pool.query(
    "UPDATE scan_history SET share_token = $1, share_expires_at = $2, share_publicly_listed = $3 WHERE id = $4",
    [token, finalExpiresAt, publiclyListed, scan.id],
  );

  return NextResponse.json({
    token,
    expiresAt: finalExpiresAt,
    publiclyListed,
  });
}

// DELETE to revoke sharing
export async function DELETE(
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

  const { id } = await params;

  // Get the scan to check ownership (by opaque public_id, or a legacy id).
  const scan = await resolveScanRow(id);

  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  // Revoking a share link is a write action, scoped to the teams the scan is
  // shared with (owner-only for a personal scan). See the POST handler above.
  if (scan.user_id !== session.userId) {
    const access = await getScanResourceAccess(session.userId, scan);
    if (!access.canWrite) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }
  }

  await pool.query("UPDATE scan_history SET share_token = NULL WHERE id = $1", [
    scan.id,
  ]);

  return NextResponse.json({ success: true });
}
