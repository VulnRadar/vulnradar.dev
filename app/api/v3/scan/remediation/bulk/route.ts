import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { z } from "zod";
import {
  REMEDIATION_STATUSES,
  normalizeDueAt,
} from "@/lib/scanner/remediation";

/**
 * Apply one remediation change to many findings at once (the bulk bar in the
 * results list). Same per-user, per-finding model as the single route
 * (app/api/v3/scan/remediation/route.ts): each item is keyed on
 * (user_id, finding_id, finding_url).
 *
 * Semantics that matter: status is always applied. assignee and dueAt are
 * applied ONLY when present in the request (absent = "leave what's there"),
 * so a bulk "mark fixed" doesn't wipe assignees/dates someone set per finding.
 * note is never touched by bulk. status "open" clears each selected row, the
 * same as the single route.
 */
const BulkSchema = z.object({
  items: z
    .array(
      z.object({
        findingId: z.string().min(1).max(200),
        findingUrl: z.string().url().max(2048),
      }),
    )
    .min(1)
    .max(200),
  status: z.enum(REMEDIATION_STATUSES),
  assignee: z.string().max(120).nullish(),
  dueAt: z.string().max(40).nullish(),
});

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

  const result = BulkSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid request", details: result.error.flatten() },
      { status: 400 },
    );
  }

  const { items, status } = result.data;
  // Presence (not value) decides whether the column is touched, so an absent
  // field preserves the existing per-finding value on the conflict path.
  const setAssignee = result.data.assignee !== undefined;
  const setDue = result.data.dueAt !== undefined;
  const assignee = result.data.assignee ?? null;
  const dueAt = normalizeDueAt(result.data.dueAt);
  const userId = session.userId;

  try {
    if (status === "open") {
      await Promise.all(
        items.map((it) =>
          pool.query(
            `DELETE FROM finding_remediation
              WHERE user_id = $1 AND finding_id = $2 AND finding_url = $3`,
            [userId, it.findingId, it.findingUrl],
          ),
        ),
      );
      return NextResponse.json({ ok: true, count: items.length, status });
    }

    await Promise.all(
      items.map((it) =>
        pool.query(
          `INSERT INTO finding_remediation
             (user_id, finding_id, finding_url, status, note, assignee, due_at)
           VALUES ($1, $2, $3, $4, NULL, $5, $6)
           ON CONFLICT (user_id, finding_id, finding_url)
           DO UPDATE SET
             status = EXCLUDED.status,
             assignee = CASE WHEN $7::boolean THEN EXCLUDED.assignee ELSE finding_remediation.assignee END,
             due_at = CASE WHEN $8::boolean THEN EXCLUDED.due_at ELSE finding_remediation.due_at END,
             updated_at = NOW()`,
          [
            userId,
            it.findingId,
            it.findingUrl,
            status,
            assignee,
            dueAt,
            setAssignee,
            setDue,
          ],
        ),
      ),
    );

    return NextResponse.json({ ok: true, count: items.length, status });
  } catch (err: unknown) {
    const migrated = tableMissingResponse(err);
    if (migrated) return migrated;
    console.error("[scan/remediation/bulk] POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
