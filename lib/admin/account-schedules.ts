import pool from "@/lib/database/db";
import {
  computeNextRunAt,
  isScheduleFrequency,
} from "@/lib/scanner/schedule-timing";

/**
 * What disabling and re-enabling an account does to its scheduled scans.
 *
 * Disabling ended the sessions and left the schedules running, so an account
 * disabled for abuse kept scanning its targets, emailing results and firing
 * webhooks on the cadence it had set. The disable action now pauses every
 * active schedule, and enable resumes exactly those.
 *
 * "Exactly those" needs a mark, because a schedule the owner paused looks the
 * same as one the disable paused (active = false) and must stay paused. The
 * mark is next_run_at = NULL. Nothing else writes it: creating a schedule
 * stores a due time, the owner's own pause keeps the one it had (the resume
 * path in app/api/v3/schedules/route.ts recomputes it), and the worker only
 * ever writes a time. A NULL is also never due, so the worker's claim cannot
 * pick a paused row up in between. A dedicated column would say this more
 * plainly; until one exists, these two functions are the only place that
 * reads or writes the mark.
 *
 * One edge fails safe: a schedule the worker had already claimed when the
 * account was disabled gets a fresh next_run_at when that run finishes, so
 * enable leaves it paused and the owner resumes it by hand.
 */

/** Pause every active schedule the account owns. Returns how many. */
export async function suspendAccountSchedules(userId: number): Promise<number> {
  const result = await pool.query(
    `UPDATE scheduled_scans
        SET active = false, next_run_at = NULL
      WHERE user_id = $1 AND active = true`,
    [userId],
  );
  return result.rowCount ?? 0;
}

interface PausedSchedule {
  id: number;
  frequency: string;
  preferred_hour_utc: number;
  preferred_day_of_week: number;
  preferred_day_of_month: number;
}

/**
 * Resume the schedules suspendAccountSchedules paused. Each gets its next due
 * time computed from its own cadence, the way the owner's resume does: the
 * time it had before the disable is gone, and "now" would scan every one of
 * them on the worker's next tick.
 */
export async function resumeAccountSchedules(userId: number): Promise<number> {
  const paused = await pool.query<PausedSchedule>(
    `SELECT id, frequency, preferred_hour_utc, preferred_day_of_week, preferred_day_of_month
       FROM scheduled_scans
      WHERE user_id = $1 AND active = false AND next_run_at IS NULL`,
    [userId],
  );
  if (paused.rows.length === 0) return 0;

  const ids = paused.rows.map((r) => r.id);
  // The column has no CHECK, and computeNextRunAt throws on a cadence it does
  // not know. Enable has already cleared disabled_at by the time this runs,
  // so one legacy value would leave the account enabled, its schedules
  // paused and no audit row. Same fallback the worker applies.
  const due = paused.rows.map((r) =>
    computeNextRunAt(r.id, {
      frequency: isScheduleFrequency(r.frequency) ? r.frequency : "weekly",
      preferredHourUtc: r.preferred_hour_utc,
      preferredDayOfWeek: r.preferred_day_of_week,
      preferredDayOfMonth: r.preferred_day_of_month,
    }).toISOString(),
  );
  // The mark is re-checked here as well as in the read, so a row that
  // changed in between is left as it is now rather than as it was then.
  const resumed = await pool.query(
    `UPDATE scheduled_scans AS s
        SET active = true, next_run_at = v.next_run_at
       FROM unnest($2::int[], $3::timestamptz[]) AS v(id, next_run_at)
      WHERE s.id = v.id
        AND s.user_id = $1
        AND s.active = false
        AND s.next_run_at IS NULL`,
    [userId, ids, due],
  );
  return resumed.rowCount ?? 0;
}
