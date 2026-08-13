import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { z } from "zod";
import { recomputeScanScore } from "@/lib/scanner/recompute-scan-score";

const FeedbackSchema = z.object({
  findingId: z.string().min(1).max(200),
  findingUrl: z.string().url().max(2048),
  scanHistoryId: z.number().int().positive().optional(),
  verdict: z.enum(["false_positive", "confirmed", "not_applicable"]),
  notes: z.string().max(1000).optional(),
});

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

  const result = FeedbackSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid request", details: result.error.flatten() },
      { status: 400 },
    );
  }

  const { findingId, findingUrl, scanHistoryId, verdict, notes } = result.data;

  try {
    const row = await pool.query(
      `INSERT INTO scan_finding_feedback
         (user_id, scan_history_id, finding_id, finding_url, verdict, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, finding_id, finding_url)
       DO UPDATE SET verdict = $5, notes = $6, created_at = NOW()
       RETURNING id, verdict, created_at`,
      [
        session.userId,
        scanHistoryId ?? null,
        findingId,
        findingUrl,
        verdict,
        notes ?? null,
      ],
    );

    // Marking (or un-marking) a finding false_positive changes what should
    // count toward this scan's severity breakdown and danger score, not
    // just the raw verdict record -- recompute both now rather than
    // leaving the displayed risk stale until the next real scan. Fire and
    // forget: recomputeScanScore never throws, and its own success/failure
    // shouldn't gate this response, since the feedback itself already
    // saved successfully either way.
    if (scanHistoryId) {
      recomputeScanScore(scanHistoryId).catch(() => {});
    }

    return NextResponse.json({ ok: true, feedback: row.rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Table not yet created — return a helpful error instead of 500
    if (msg.includes("scan_finding_feedback")) {
      return NextResponse.json(
        {
          error:
            "Feedback table not yet migrated. Run: node scripts/migrate/migrate.mjs up",
        },
        { status: 503 },
      );
    }
    console.error("[scan/feedback] DB error:", err);
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
      `SELECT finding_id, verdict, notes, created_at
         FROM scan_finding_feedback
        WHERE user_id = $1
          AND ($2::text IS NULL OR finding_url = $2)
          AND ($3::text IS NULL OR finding_id = $3)
        ORDER BY created_at DESC
        LIMIT 100`,
      [session.userId, findingUrl, findingId],
    );
    return NextResponse.json({ feedback: rows.rows });
  } catch (err) {
    console.error("[scan/feedback] GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
