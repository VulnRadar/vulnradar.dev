/**
 * Shared timing logic for scheduled scans (`scheduled_scans` table).
 *
 * Pure, DB-free, and safe to import from a client component: frequency
 * metadata (interval length + the minimum plan tier a frequency requires),
 * deterministic per-schedule jitter, and `computeNextRunAt`, the single
 * place that turns a schedule's frequency + time-of-day preferences into a
 * concrete "run at" instant.
 *
 * Used by both `app/api/v3/schedules/route.ts` (computing the first
 * `next_run_at` at creation) and `lib/scanner/scheduled-scans-worker.ts`
 * (recomputing it after every run), so the two can never compute a
 * schedule's next occurrence differently. Plan-tier *enforcement* (does
 * this user's actual plan clear the bar, accounting for BILLING_ENABLED and
 * staff) lives in `lib/billing/plan-limits.ts`'s `userMeetsScheduleFrequency`
 * instead of here — this module only describes what each frequency means.
 */

import type { PlanId } from "@/lib/billing/catalog";

export type ScheduleFrequency =
  "hourly" | "6hourly" | "daily" | "weekly" | "monthly";

export interface FrequencyDef {
  /** Cadence, expressed in hours, between two consecutive runs. */
  hours: number;
  label: string;
  /**
   * Minimum plan tier required to use this frequency, in addition to the
   * base "can schedule at all" gate (`PlanLimits.scheduledScans`).
   * Undefined means no extra gate beyond that.
   */
  minPlan?: PlanId;
}

// Sub-day cadences are gated: hourly is the most resource-intensive option
// (up to 24x the scan volume of daily) and is reserved for the top tier;
// 6-hourly is a smaller step up and available from Pro. Daily/weekly/monthly
// carry no extra gate beyond the existing scheduledScans plan limit (which
// already restricts scheduling to Pro/Elite — see catalog.ts).
export const FREQUENCIES: Record<ScheduleFrequency, FrequencyDef> = {
  hourly: { hours: 1, label: "Hourly", minPlan: "elite_supporter" },
  "6hourly": { hours: 6, label: "Every 6 hours", minPlan: "pro_supporter" },
  daily: { hours: 24, label: "Daily" },
  weekly: { hours: 24 * 7, label: "Weekly" },
  monthly: { hours: 24 * 30, label: "Monthly" },
};

export const SCHEDULE_FREQUENCIES = Object.keys(
  FREQUENCIES,
) as ScheduleFrequency[];

export function isScheduleFrequency(
  value: unknown,
): value is ScheduleFrequency {
  return typeof value === "string" && value in FREQUENCIES;
}

// ─────────────────────────────────────────────────────────────────────────
// Deterministic per-schedule jitter
// ─────────────────────────────────────────────────────────────────────────

/**
 * FNV-1a-style 32-bit hash over the schedule id's decimal string.
 * Deterministic across processes/platforms/runs: the same id always
 * produces the same hash, which is the entire point (jitter must be stable
 * so the same schedule doesn't hop between polling ticks run to run).
 */
function hashScheduleId(id: number): number {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Jitter cap in minutes for a given cadence: up to 25% of the interval,
 * floored at 0 and capped at 59 so even a monthly schedule never drifts by
 * hours. An hourly (60 min) schedule caps at 15 minutes; 6-hourly (360 min)
 * and anything slower caps at the full 59.
 */
export function jitterCapMinutes(intervalHours: number): number {
  const intervalMinutes = intervalHours * 60;
  return Math.max(0, Math.min(59, Math.floor(intervalMinutes / 4)));
}

/**
 * Deterministic 0..capMinutes (inclusive) minute offset derived from the
 * schedule's own id. The same schedule always gets the same offset, so two
 * schedules that would otherwise land on the exact same clean slot (e.g.
 * every "daily, no explicit hour" schedule created with the same default)
 * spread out across the polling window instead of firing in the same tick.
 */
export function jitterMinutesForSchedule(
  scheduleId: number,
  capMinutes: number,
): number {
  if (capMinutes <= 0) return 0;
  return hashScheduleId(scheduleId) % (capMinutes + 1);
}

// ─────────────────────────────────────────────────────────────────────────
// next_run_at computation
// ─────────────────────────────────────────────────────────────────────────

export interface ScheduleTimingPrefs {
  frequency: ScheduleFrequency;
  /** 0-23, UTC. Anchor hour for hourly/6hourly/daily/weekly/monthly alike. */
  preferredHourUtc: number;
  /** 0-6 (Sunday=0), UTC. Only consulted when frequency === "weekly". */
  preferredDayOfWeek: number;
  /** 1-28, UTC. Only consulted when frequency === "monthly". Capped at 28
   *  so every month has that day, no February edge case. */
  preferredDayOfMonth: number;
}

/**
 * The next UTC instant a schedule should run, strictly after `now`.
 *
 * hourly/6hourly/daily all reduce to "the next time-of-day slot at or after
 * now whose hour is `preferredHourUtc` plus a whole multiple of the
 * interval" — for hourly (1h interval) every hour satisfies that trivially,
 * so it naturally becomes "the next top of the hour" regardless of
 * `preferredHourUtc`. weekly/monthly additionally require the day to match.
 * Deterministic per-schedule jitter (see `jitterMinutesForSchedule`) is
 * added on top of whichever slot is found.
 */
export function computeNextRunAt(
  scheduleId: number,
  prefs: ScheduleTimingPrefs,
  now: Date = new Date(),
): Date {
  const def = FREQUENCIES[prefs.frequency];
  const hour = ((prefs.preferredHourUtc % 24) + 24) % 24;

  const candidate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour,
      0,
      0,
      0,
    ),
  );

  if (prefs.frequency === "weekly") {
    const targetDow = ((prefs.preferredDayOfWeek % 7) + 7) % 7;
    // Bounded: a matching weekday occurs at least once every 7 days.
    while (
      candidate.getTime() <= now.getTime() ||
      candidate.getUTCDay() !== targetDow
    ) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
  } else if (prefs.frequency === "monthly") {
    const targetDom = Math.min(
      28,
      Math.max(1, Math.trunc(prefs.preferredDayOfMonth) || 1),
    );
    // Bounded: capped at day 28, which exists in every month.
    while (
      candidate.getTime() <= now.getTime() ||
      candidate.getUTCDate() !== targetDom
    ) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
  } else {
    // hourly / 6hourly / daily.
    while (candidate.getTime() <= now.getTime()) {
      candidate.setUTCHours(candidate.getUTCHours() + def.hours);
    }
  }

  const jitter = jitterMinutesForSchedule(
    scheduleId,
    jitterCapMinutes(def.hours),
  );
  candidate.setUTCMinutes(candidate.getUTCMinutes() + jitter);
  return candidate;
}
