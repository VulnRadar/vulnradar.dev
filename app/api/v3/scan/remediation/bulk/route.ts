import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { z } from "zod";
import { readJsonObject } from "@/lib/api/api-utils";
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

  const parsedBody = await readJsonObject(req);
  if (!parsedBody.ok) return parsedBody.response;

  const result = BulkSchema.safeParse(parsedBody.data);
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

  // Deduplicate on the same key the unique index uses. The selection UI can
  // hand the same (findingId, findingUrl) pair twice when one finding appears
  // on two pages of the same scan, and a single INSERT ... ON CONFLICT cannot
  // touch the same row twice ("cannot affect row a second time"). The old
  // per-item fan-out papered over this by racing the duplicates against each
  // other instead.
  const seen = new Set<string>();
  const uniqueItems = items.filter((it) => {
    const key = `${it.findingId}\u0000${it.findingUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const findingIds = uniqueItems.map((it) => it.findingId);
  const findingUrls = uniqueItems.map((it) => it.findingUrl);

  try {
    // One statement, not up to 200 unbatched pool.query calls fanned out
    // through Promise.all with no transaction. Postgres runs a single
    // statement atomically, so the "Couldn't apply. Try again." the UI shows
    // on failure is now true: either every selected finding changed or none
    // did. The old fan-out could leave half the selection updated, and a
    // retry then re-applied to findings that had already taken.
    if (status === "open") {
      await pool.query(
        `DELETE FROM finding_remediation
          WHERE user_id = $1
            AND (finding_id, finding_url) IN (
              SELECT * FROM unnest($2::text[], $3::text[])
            )`,
        [userId, findingIds, findingUrls],
      );
      return NextResponse.json({ ok: true, count: uniqueItems.length, status });
    }

    await pool.query(
      `INSERT INTO finding_remediation
         (user_id, finding_id, finding_url, status, note, assignee, due_at)
       SELECT $1, f.finding_id, f.finding_url, $4::text, NULL, $5::text, $6::timestamptz
       FROM unnest($2::text[], $3::text[]) AS f(finding_id, finding_url)
       ON CONFLICT (user_id, finding_id, finding_url)
       DO UPDATE SET
         status = EXCLUDED.status,
         assignee = CASE WHEN $7::boolean THEN EXCLUDED.assignee ELSE finding_remediation.assignee END,
         due_at = CASE WHEN $8::boolean THEN EXCLUDED.due_at ELSE finding_remediation.due_at END,
         updated_at = NOW()`,
      [
        userId,
        findingIds,
        findingUrls,
        status,
        assignee,
        dueAt,
        setAssignee,
        setDue,
      ],
    );

    return NextResponse.json({ ok: true, count: uniqueItems.length, status });
  } catch (err: unknown) {
    const migrated = tableMissingResponse(err);
    if (migrated) return migrated;
    console.error("[scan/remediation/bulk] POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
