import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { z } from "zod";
import { REMEDIATION_STATUSES } from "@/lib/scanner/remediation";

/**
 * Per-finding remediation status (the owner's own "what have I done about
 * it" tracking), keyed on (user_id, finding_id, finding_url) so it survives
 * across rescans of the same target -- finding_id is the stable
 * `<checkId>--<hash>` id from generateId (lib/scanner/_helpers.ts). Distinct
 * from app/api/v3/scan/feedback/route.ts, which records an accuracy verdict
 * that feeds the global confidence model; this never touches that.
 *
 * Auth/validation mirror the feedback route: session-gated, zod-validated,
 * status checked against the allow-list. Only route handlers are exported
 * from this file (the shared status constants/types live in
 * lib/scanner/remediation.ts) so `next build` stays happy.
 */

const SetSchema = z.object({
  findingId: z.string().min(1).max(200),
  findingUrl: z.string().url().max(2048),
  status: z.enum(REMEDIATION_STATUSES),
  note: z.string().max(2000).optional(),
  assignee: z.string().max(120).optional(),
});

/** Shared "table not migrated yet" -> 503, matching the feedback route. */
function tableMissingResponse(err: unknown): NextResponse | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("finding_remediation")) {
    return NextResponse.json(
      {
        error:
          "Remediation table not yet migrated. Run: node scripts/migrate/migrate.mjs up",
      },
      { status: 503 },
    );
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = SetSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid request", details: result.error.flatten() },
      { status: 400 },
    );
  }

  const { findingId, findingUrl, status, note, assignee } = result.data;

  try {
    // `open` is the implicit default (absence of a row), so setting it just
    // clears any stored status rather than persisting a redundant row. This
    // keeps the invariant "a row exists only for a non-default status" and
    // matches the DELETE handler below.
    if (status === "open") {
      await pool.query(
        `DELETE FROM finding_remediation
          WHERE user_id = $1 AND finding_id = $2 AND finding_url = $3`,
        [session.userId, findingId, findingUrl],
      );
      return NextResponse.json({ ok: true, status: "open" });
    }

    const row = await pool.query(
      `INSERT INTO finding_remediation
         (user_id, finding_id, finding_url, status, note, assignee)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, finding_id, finding_url)
       DO UPDATE SET status = $4, note = $5, assignee = $6, updated_at = NOW()
       RETURNING status, note, assignee, updated_at`,
      [
        session.userId,
        findingId,
        findingUrl,
        status,
        note ?? null,
        assignee ?? null,
      ],
    );

    return NextResponse.json({ ok: true, remediation: row.rows[0] });
  } catch (err: unknown) {
    const migrated = tableMissingResponse(err);
    if (migrated) return migrated;
    console.error("[scan/remediation] POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const findingUrl = url.searchParams.get("url");
  const findingId = url.searchParams.get("findingId");
  if (!findingUrl || !findingId) {
    return NextResponse.json(
      { error: "url and findingId are required" },
      { status: 400 },
    );
  }

  try {
    await pool.query(
      `DELETE FROM finding_remediation
        WHERE user_id = $1 AND finding_id = $2 AND finding_url = $3`,
      [session.userId, findingId, findingUrl],
    );
    return NextResponse.json({ ok: true, status: "open" });
  } catch (err: unknown) {
    const migrated = tableMissingResponse(err);
    if (migrated) return migrated;
    console.error("[scan/remediation] DELETE error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const findingUrl = url.searchParams.get("url");
  const findingId = url.searchParams.get("findingId");

  try {
    const rows = await pool.query(
      `SELECT finding_id, status, note, assignee, updated_at
         FROM finding_remediation
        WHERE user_id = $1
          AND ($2::text IS NULL OR finding_url = $2)
          AND ($3::text IS NULL OR finding_id = $3)
        ORDER BY updated_at DESC
        LIMIT 500`,
      [session.userId, findingUrl, findingId],
    );
    return NextResponse.json({ remediation: rows.rows });
  } catch (err: unknown) {
    const migrated = tableMissingResponse(err);
    if (migrated) return migrated;
    console.error("[scan/remediation] GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
