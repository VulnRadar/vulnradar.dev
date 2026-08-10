import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import { detectWebhookType } from "@/lib/webhooks/detect-type";

/**
 * PATCH /api/v3/webhooks/[id] — edit or pause/resume a webhook.
 *
 * Distinct from the existing PATCH /api/v3/webhooks (body: { id }), which
 * sends a one-off test payload and is left untouched. This is the actual
 * "update the resource" route: at minimum { active: boolean } to pause or
 * resume delivery, plus optionally { url, name, type } for a full edit.
 * Every other per-resource route in this codebase (e.g.
 * app/api/v3/history/[id]/route.ts) verifies ownership in the same
 * UPDATE ... WHERE id = $n AND user_id = $n statement rather than a
 * separate SELECT-then-UPDATE, so a webhook ID belonging to another user
 * can never be edited: the WHERE clause simply matches no row and this
 * returns 404, not 403 (doesn't confirm the ID exists to a caller who
 * doesn't own it).
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
  } = body as {
    active?: unknown;
    url?: unknown;
    name?: unknown;
    type?: unknown;
  };

  const hasActive = active !== undefined;
  const hasUrl = url !== undefined;
  const hasName = name !== undefined;
  const hasType = userType !== undefined;

  if (!hasActive && !hasUrl && !hasName && !hasType) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
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

  if (setClauses.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  values.push(id, session.userId);

  const result = await pool.query(
    `UPDATE webhooks SET ${setClauses.join(", ")}
     WHERE id = $${values.length - 1} AND user_id = $${values.length}
     RETURNING id, url, name, type, active, created_at`,
    values,
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}
