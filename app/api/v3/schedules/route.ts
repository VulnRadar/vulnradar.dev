import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { scheduleCreatedEmail, scheduleDeletedEmail } from "@/lib/email/email";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import { getClientIp } from "@/lib/api/request-utils";
import {
  getUserPlanLimits,
  withinPlanLimit,
  planLimitMessage,
  userMeetsScheduleFrequency,
} from "@/lib/billing/plan-limits";
import {
  FREQUENCIES,
  isScheduleFrequency,
  computeNextRunAt,
  type ScheduleFrequency,
} from "@/lib/scanner/schedule-timing";

const SCHEDULE_COLUMNS =
  "id, url, frequency, active, last_run_at, next_run_at, created_at, " +
  "preferred_hour_utc, preferred_day_of_week, preferred_day_of_month";

/** Clamp a request-supplied field to its valid range, falling back to a
 *  sensible default derived from `now` when omitted or out of range —
 *  same "the current moment" default a plain `NOW() + interval` used to
 *  produce implicitly, now made explicit so it survives into next_run_at
 *  recomputation on every later run (see schedule-timing.ts). */
function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const result = await pool.query(
    `SELECT ${SCHEDULE_COLUMNS} FROM scheduled_scans WHERE user_id = $1 ORDER BY created_at DESC`,
    [session.userId],
  );
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const body = await request.json();
  const {
    url,
    frequency,
    preferredHourUtc,
    preferredDayOfWeek,
    preferredDayOfMonth,
  } = body ?? {};
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  // api: cap URL length on scheduled scans to prevent DoS / log abuse.
  // Shares the single MAX_URL_LENGTH setting every other scan-submission
  // route (scan, crawl, discover) already resolves live, so an admin edit
  // applies here too instead of this route quietly keeping its own copy.
  const maxScheduleUrlLength = await getSetting("MAX_URL_LENGTH");
  if (url.length > maxScheduleUrlLength) {
    return NextResponse.json(
      { error: `URL exceeds maximum length of ${maxScheduleUrlLength}` },
      { status: 400 },
    );
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // ssrf: validate the URL is a public HTTP(S) target before storing
  // it. The scheduled scan worker will fetch this URL — we must not
  // allow private/loopback/link-local/metadata targets.
  const targetCheck = await validateScanTarget(url);
  if (!targetCheck.safe) {
    return NextResponse.json(
      { error: targetCheck.reason || "URL blocked" },
      { status: 400 },
    );
  }

  const freq: ScheduleFrequency = isScheduleFrequency(frequency)
    ? frequency
    : "weekly";
  const freqDef = FREQUENCIES[freq];

  const now = new Date();
  const hourUtc = clampInt(preferredHourUtc, 0, 23, now.getUTCHours());
  const dayOfWeekUtc = clampInt(preferredDayOfWeek, 0, 6, now.getUTCDay());
  const dayOfMonthUtc = clampInt(
    preferredDayOfMonth,
    1,
    28,
    Math.min(now.getUTCDate(), 28),
  );

  const countRes = await pool.query(
    "SELECT COUNT(*)::int as count FROM scheduled_scans WHERE user_id = $1",
    [session.userId],
  );
  const planLimits = await getUserPlanLimits(session.userId);
  if (
    planLimits &&
    !withinPlanLimit(countRes.rows[0].count, planLimits.scheduledScans)
  ) {
    return NextResponse.json(
      { error: planLimitMessage("Scheduled scans", planLimits.scheduledScans) },
      { status: 400 },
    );
  }

  // Sub-day cadences (hourly, 6hourly) are additionally gated by plan tier
  // -- see FREQUENCIES' minPlan in schedule-timing.ts. Checked here (create
  // time) and again by the worker at run time, since a plan can be
  // downgraded after a schedule already exists.
  if (!(await userMeetsScheduleFrequency(session.userId, freqDef.minPlan))) {
    return NextResponse.json(
      {
        error: `${freqDef.label} scans require a higher plan. Upgrade to unlock this frequency.`,
      },
      { status: 400 },
    );
  }

  // Insert first so the DB-assigned id exists (jitter is derived from the
  // schedule's own id, see computeNextRunAt), then compute the real
  // next_run_at and apply it in a second write. next_run_at starts at NOW()
  // as a placeholder so the row is never left with a NULL value between the
  // two statements.
  const insertRes = await pool.query<{ id: number }>(
    `INSERT INTO scheduled_scans
       (user_id, url, frequency, preferred_hour_utc, preferred_day_of_week, preferred_day_of_month, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id`,
    [session.userId, url, freq, hourUtc, dayOfWeekUtc, dayOfMonthUtc],
  );
  const scheduleId = insertRes.rows[0].id;

  const nextRunAt = computeNextRunAt(
    scheduleId,
    {
      frequency: freq,
      preferredHourUtc: hourUtc,
      preferredDayOfWeek: dayOfWeekUtc,
      preferredDayOfMonth: dayOfMonthUtc,
    },
    now,
  );

  const updateRes = await pool.query(
    `UPDATE scheduled_scans SET next_run_at = $1 WHERE id = $2
     RETURNING ${SCHEDULE_COLUMNS}`,
    [nextRunAt.toISOString(), scheduleId],
  );

  // Send notification email
  // audit-log: trusted client IP only.
  const ip = (await getClientIp()) || "Unknown";
  const userAgent = request.headers.get("user-agent") || "Unknown";
  const emailContent = scheduleCreatedEmail(url, freq, {
    ipAddress: ip,
    userAgent,
  });

  sendNotificationEmail({
    userId: session.userId,
    userEmail: session.email,
    type: "schedules",
    emailContent,
  }).catch((err) =>
    console.error("Failed to send schedule created notification:", err),
  );

  return NextResponse.json(updateRes.rows[0], { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { id } = await request.json();

  // Get schedule details before deleting for the email
  const scheduleResult = await pool.query(
    "SELECT url FROM scheduled_scans WHERE id = $1 AND user_id = $2",
    [id, session.userId],
  );

  await pool.query(
    "DELETE FROM scheduled_scans WHERE id = $1 AND user_id = $2",
    [id, session.userId],
  );

  // Send notification email if schedule was found
  if (scheduleResult.rows.length > 0) {
    // audit-log: trusted client IP only.
    const ip = (await getClientIp()) || "Unknown";
    const userAgent = request.headers.get("user-agent") || "Unknown";
    const emailContent = scheduleDeletedEmail(scheduleResult.rows[0].url, {
      ipAddress: ip,
      userAgent,
    });

    sendNotificationEmail({
      userId: session.userId,
      userEmail: session.email,
      type: "schedules",
      emailContent,
    }).catch((err) =>
      console.error("Failed to send schedule deleted notification:", err),
    );
  }

  return NextResponse.json({ success: true });
}
