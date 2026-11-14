import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { z } from "zod";
import { recomputeScanScore } from "@/lib/scanner/recompute-scan-score";
import { findOwnedScan, parseScanRef } from "@/lib/history/scan-ref";
import { checkRateLimit } from "@/lib/rate-limiting/rate-limit";
import { burstLimitedResponse } from "@/lib/api/rate-limit-response";
import { TOO_MANY_ATTEMPTS } from "@/lib/api/retry-in";

const FeedbackSchema = z.object({
  findingId: z.string().min(1).max(200),
  findingUrl: z.string().url().max(2048),
  // The scan the verdict came from, spelled either way a client holds it: the
  // 32 character public id History lists, or the legacy numeric id. Required:
  // a verdict is only evidence about a check when it is about a finding that
  // check really produced on one of the caller's scans, and without the scan
  // there is nothing to check the finding id against.
  scanHistoryId: z
    .union([z.number(), z.string().max(64)])
    .refine((id) => parseScanRef(id) !== null, "Not a scan id"),
  verdict: z.enum(["false_positive", "confirmed", "not_applicable"]),
  notes: z.string().max(1000).optional(),
});

/**
 * Per user, generous for a person working down a findings list and far short
 * of what a script needs to move a check's accuracy figure. One-off numbers
 * rather than an admin setting: nobody has a reason to tune it.
 */
const FEEDBACK_RATE_LIMIT = { maxAttempts: 60, windowSeconds: 60 } as const;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // rate-limit: every verdict feeds lib/scanner/check-accuracy.ts, which
  // discounts that check's confidence on every customer's scans.
  const rl = await checkRateLimit({
    key: `scan-feedback:${session.userId}`,
    ...FEEDBACK_RATE_LIMIT,
  });
  if (!rl.allowed) {
    return burstLimitedResponse(
      rl,
      TOO_MANY_ATTEMPTS("verdicts", rl.retryAfterSeconds),
    );
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

  const { findingId, findingUrl, verdict, notes } = result.data;
  // The schema's refine already proved this parses.
  const scanRef = parseScanRef(result.data.scanHistoryId)!;

  try {
    // The scan must be the caller's own: it is what the verdict is recorded
    // against and what recomputeScanScore rewrites (and, for a verified owner
    // of the host, the host_reputation cascade). Without this, any
    // authenticated user could attach feedback to (and force a recompute
    // cascade against) any scan in the system just by guessing its small
    // sequential id (AUDIT-010#security-02).
    const owned = await findOwnedScan(scanRef, session.userId);
    if (!owned) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }
    const scanHistoryId = owned.id;

    // And the finding must be one that scan actually reported. The accuracy
    // table reads every verdict as a statement about the check named in the
    // id, so a made-up id is a made-up statement about a real check.
    const present = await pool.query(
      `SELECT 1 AS present FROM scan_history
        WHERE id = $1
          AND findings @> jsonb_build_array(jsonb_build_object('id', $2::text))
        LIMIT 1`,
      [scanHistoryId, findingId],
    );
    if (present.rows.length === 0) {
      return NextResponse.json(
        { error: "That finding is not in this scan." },
        { status: 400 },
      );
    }

    const row = await pool.query(
      // source = 'human' on the update too: a person clicking the verdict
      // the AI verifier filled in makes the row theirs, and source is what
      // every reader that hides a finding goes by (lib/scanner/feedback-source.ts).
      `INSERT INTO scan_finding_feedback
         (user_id, scan_history_id, finding_id, finding_url, verdict, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'human')
       ON CONFLICT (user_id, finding_id, finding_url)
       DO UPDATE SET verdict = $5, notes = $6, source = 'human', created_at = NOW()
       RETURNING id, verdict, created_at`,
      [
        session.userId,
        scanHistoryId,
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
    // saved successfully either way. The caller's id goes with it: the
    // recompute only rewrites the caller's own row, and touches the public
    // host_reputation row only if the caller has verified the host's domain.
    recomputeScanScore(scanHistoryId, session.userId).catch(() => {});

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
      `SELECT finding_id, verdict, notes, source, created_at
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
