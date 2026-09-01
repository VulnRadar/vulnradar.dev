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
import {
  getTeamResourceAccess,
  getAssignableTeamIds,
} from "@/lib/auth/team-resource-access";

const SCHEDULE_COLUMNS =
  "id, url, frequency, active, last_run_at, next_run_at, created_at, team_id, " +
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
    `SELECT ${SCHEDULE_COLUMNS} FROM scheduled_scans
     WHERE user_id = $1 OR team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
     ORDER BY created_at DESC`,
    [session.userId],
  );
  // Named-key envelope, matching every other collection endpoint
  // ({ shares }, { teams }, { tickets }, ...). This used to return the bare
  // array, which is the one shape that can never gain a sibling field: no
  // total, no truncation flag, no pagination, without breaking every caller.
  // app/profile/page.tsx already reads either shape.
  return NextResponse.json({ schedules: result.rows });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  if (!(await getSetting("FEATURE_SCHEDULED_SCANS"))) {
    return NextResponse.json(
      { error: "Scheduled scans are disabled on this deployment." },
      { status: 403 },
    );
  }

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
  //
  // The plan cap is re-checked INSIDE the INSERT, not just by the count
  // above. The count-then-insert on its own is check-then-act: two requests
  // that both read the same count before either inserts both pass the gate
  // and the account ends up over its plan's scheduledScans cap. The guarded
  // form is the same shape lib/rate-limiting/daily-limits.ts uses to close
  // this race for the scan counter. `null` for the limit means unlimited
  // (billing off, or the plan's own -1), and the WHERE then always holds.
  const scheduleCap =
    planLimits && planLimits.scheduledScans !== -1
      ? planLimits.scheduledScans
      : null;
  const insertRes = await pool.query<{ id: number }>(
    `INSERT INTO scheduled_scans
       (user_id, url, frequency, preferred_hour_utc, preferred_day_of_week, preferred_day_of_month, next_run_at)
     SELECT $1, $2, $3, $4, $5, $6, NOW()
     WHERE $7::int IS NULL
        OR (SELECT COUNT(*) FROM scheduled_scans WHERE user_id = $1) < $7::int
     RETURNING id`,
    [
      session.userId,
      url,
      freq,
      hourUtc,
      dayOfWeekUtc,
      dayOfMonthUtc,
      scheduleCap,
    ],
  );
  if (insertRes.rows.length === 0) {
    // The guard refused: another request took the last slot between the
    // count above and this statement.
    return NextResponse.json(
      {
        error: planLimitMessage(
          "Scheduled scans",
          planLimits?.scheduledScans ?? 0,
        ),
      },
      { status: 400 },
    );
  }
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

/** Pause/resume a schedule, and/or assign or clear the team it's shared
 *  with. `active` alone is scoped to whatever the caller's access level
 *  grants (owner, or a team co-member with a manage_scans-granting role --
 *  see lib/auth/team-resource-access.ts); reassigning `teamId` itself is
 *  narrower, restricted to the schedule's actual owner, since handing a
 *  resource to a different team is more sensitive than toggling it. The
 *  worker (scheduled-scans-worker.ts) flips `active` to false itself when a
 *  target starts failing validateScanTarget -- until now the only way for
 *  the owner to recover from that was delete + recreate. */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const body = await request.json();
  const { id, active, teamId } = body ?? {};

  if (typeof id !== "number" && typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const hasActive = active !== undefined;
  const hasTeamId = teamId !== undefined;
  if (!hasActive && !hasTeamId) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (hasActive && typeof active !== "boolean") {
    return NextResponse.json(
      { error: "active must be a boolean" },
      { status: 400 },
    );
  }
  if (hasTeamId && teamId !== null && typeof teamId !== "number") {
    return NextResponse.json(
      { error: "teamId must be a number or null" },
      { status: 400 },
    );
  }

  const currentRes = await pool.query<{
    user_id: number;
    team_id: number | null;
  }>("SELECT user_id, team_id FROM scheduled_scans WHERE id = $1", [id]);
  const schedule = currentRes.rows[0];
  if (!schedule) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  const access = await getTeamResourceAccess(
    session.userId,
    schedule.user_id,
    schedule.team_id,
  );
  // Not found for a caller with zero relationship to this schedule (not
  // the owner, not a co-member of its team, if any) -- same anti-
  // enumeration reasoning as every other per-resource route in this
  // codebase: a stranger must not learn this id exists at all.
  if (!access.canRead) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }
  if (!access.canWrite) {
    return NextResponse.json(
      { error: "You don't have permission to update this schedule." },
      { status: 403 },
    );
  }

  if (hasTeamId) {
    if (session.userId !== schedule.user_id) {
      return NextResponse.json(
        { error: "Only the schedule's owner can change its team." },
        { status: 403 },
      );
    }
    if (teamId !== null) {
      const assignable = await getAssignableTeamIds(session.userId);
      if (!assignable.includes(teamId)) {
        return NextResponse.json(
          { error: "You cannot assign this schedule to that team." },
          { status: 400 },
        );
      }
    }
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (hasActive) {
    setClauses.push(`active = $${values.length + 1}`);
    values.push(active);
  }
  if (hasTeamId) {
    setClauses.push(`team_id = $${values.length + 1}`);
    values.push(teamId);
  }
  values.push(id);

  const result = await pool.query(
    `UPDATE scheduled_scans SET ${setClauses.join(", ")} WHERE id = $${values.length}
     RETURNING ${SCHEDULE_COLUMNS}`,
    values,
  );

  return NextResponse.json(result.rows[0]);
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { id } = await request.json();

  // Get schedule details before deleting for the email, and for the
  // team-access check below.
  const scheduleResult = await pool.query<{
    url: string;
    user_id: number;
    team_id: number | null;
  }>("SELECT url, user_id, team_id FROM scheduled_scans WHERE id = $1", [id]);
  const schedule = scheduleResult.rows[0];

  if (schedule) {
    const access = await getTeamResourceAccess(
      session.userId,
      schedule.user_id,
      schedule.team_id,
    );
    // No read access at all (not the owner, not a co-member of its team):
    // treat exactly like "doesn't exist" below, a stranger must not learn
    // this id belongs to someone else.
    if (!access.canRead) {
      return NextResponse.json({ success: true });
    }
    if (!access.canWrite) {
      return NextResponse.json(
        { error: "You don't have permission to delete this schedule." },
        { status: 403 },
      );
    }
  }

  await pool.query("DELETE FROM scheduled_scans WHERE id = $1", [id]);

  // Send notification email if schedule was found
  if (schedule) {
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
