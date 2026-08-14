import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import { detectWebhookType } from "@/lib/webhooks/detect-type";
import {
  getTeamResourceAccess,
  getAssignableTeamIds,
} from "@/lib/auth/team-resource-access";

/**
 * PATCH /api/v3/webhooks/[id] — edit or pause/resume a webhook.
 *
 * Distinct from the existing PATCH /api/v3/webhooks (body: { id }), which
 * sends a one-off test payload and is left untouched. This is the actual
 * "update the resource" route: at minimum { active: boolean } to pause or
 * resume delivery, plus optionally { url, name, type, teamId } for a full
 * edit.
 *
 * Ownership is no longer a single UPDATE ... WHERE id = $n AND user_id =
 * $n statement -- a webhook can now be team-assigned, so write access is
 * decided by getTeamResourceAccess (see lib/auth/team-resource-access.ts)
 * against a SELECT'd user_id/team_id first. The 404-vs-403 split is
 * preserved deliberately: a caller with no read access at all (not the
 * owner, not a co-member of an assigned team) gets 404, same as before --
 * a read-only (viewer-role) co-member gets 403, since they legitimately
 * know the resource exists.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid webhook id" }, { status: 400 });
  }

  const body = await request
    .json()
    .catch(() => ({}) as Record<string, unknown>);
  const {
    active,
    url,
    name,
    type: userType,
    teamId,
  } = body as {
    active?: unknown;
    url?: unknown;
    name?: unknown;
    type?: unknown;
    teamId?: unknown;
  };

  const hasActive = active !== undefined;
  const hasUrl = url !== undefined;
  const hasName = name !== undefined;
  const hasType = userType !== undefined;
  const hasTeamId = teamId !== undefined;

  if (!hasActive && !hasUrl && !hasName && !hasType && !hasTeamId) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (hasTeamId && teamId !== null && !Number.isInteger(teamId)) {
    return NextResponse.json(
      { error: "teamId must be a number or null" },
      { status: 400 },
    );
  }
  if (hasActive && typeof active !== "boolean") {
    return NextResponse.json(
      { error: "active must be a boolean" },
      { status: 400 },
    );
  }
  if (hasName && (typeof name !== "string" || !name.trim())) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }
  if (hasType && typeof userType !== "string") {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  let validatedUrl: string | undefined;
  let resolvedType: string | undefined;

  if (hasUrl) {
    if (typeof url !== "string") {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
    // ssrf: same rules as creation (app/api/v3/webhooks/route.ts) --
    // HTTPS-only, then the canonical private-IP / private-hostname guard.
    if (parsedUrl.protocol !== "https:") {
      return NextResponse.json(
        { error: "Webhook URL must be a public HTTPS endpoint." },
        { status: 400 },
      );
    }
    const scanSafety = await validateScanTarget(parsedUrl.href);
    if (!scanSafety.safe) {
      return NextResponse.json(
        {
          error:
            scanSafety.reason || "Webhook URL blocked for security reasons.",
        },
        { status: 400 },
      );
    }
    validatedUrl = parsedUrl.href;
    // Re-detect type when the URL changes, same as creation, unless the
    // caller explicitly pinned a non-"auto" type in the same request.
    resolvedType =
      hasType && userType !== "auto"
        ? (userType as string)
        : detectWebhookType(url);
  } else if (hasType && userType !== "auto") {
    resolvedType = userType as string;
  }

  const existingRes = await pool.query<{
    user_id: number;
    team_id: number | null;
  }>("SELECT user_id, team_id FROM webhooks WHERE id = $1", [id]);
  const webhook = existingRes.rows[0];
  if (!webhook) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }
  const access = await getTeamResourceAccess(
    session.userId,
    webhook.user_id,
    webhook.team_id,
  );
  if (!access.canRead) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }
  if (!access.canWrite) {
    return NextResponse.json(
      { error: "You don't have permission to edit this webhook." },
      { status: 403 },
    );
  }

  let teamIdUpdate: number | null | undefined;
  if (hasTeamId) {
    // Only the webhook's own creator may change which team it's assigned
    // to -- a team member with write access can edit/pause it, but
    // re-homing it to a different team is an ownership-level decision.
    if (webhook.user_id !== session.userId) {
      return NextResponse.json(
        { error: "Only this webhook's owner can change its team." },
        { status: 403 },
      );
    }
    if (teamId === null) {
      teamIdUpdate = null;
    } else {
      const assignable = await getAssignableTeamIds(session.userId);
      if (!assignable.includes(teamId as number)) {
        return NextResponse.json(
          { error: "You cannot assign this webhook to that team." },
          { status: 400 },
        );
      }
      teamIdUpdate = teamId as number;
    }
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (hasActive) {
    setClauses.push(`active = $${values.length + 1}`);
    values.push(active);
  }
  if (validatedUrl !== undefined) {
    setClauses.push(`url = $${values.length + 1}`);
    values.push(validatedUrl);
  }
  if (hasName) {
    setClauses.push(`name = $${values.length + 1}`);
    values.push((name as string).slice(0, 100));
  }
  if (resolvedType !== undefined) {
    setClauses.push(`type = $${values.length + 1}`);
    values.push(resolvedType);
  }
  if (hasTeamId) {
    setClauses.push(`team_id = $${values.length + 1}`);
    values.push(teamIdUpdate);
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  values.push(id);

  // Access was already verified above via getTeamResourceAccess, so this
  // UPDATE only needs to match on id -- unlike the old owner-only version,
  // a team member with write access legitimately isn't the row's user_id.
  const result = await pool.query(
    `UPDATE webhooks SET ${setClauses.join(", ")}
     WHERE id = $${values.length}
     RETURNING id, url, name, type, active, team_id, created_at`,
    values,
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}
