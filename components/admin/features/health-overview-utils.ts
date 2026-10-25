// ADMIN HEALTH OVERVIEW: PURE VERDICT LOGIC
//
// AUDIT-014 qols-02: the panel's landing view was two StatBar rows of
// headcount aggregates (total users, total scans, 2FA enabled, ...). Every
// one of them is a plain COUNT that cannot indicate a fault, so there was no
// screen anywhere that answered "is anything wrong right now". The signals
// that CAN go red existed, but each was one nav click away and none was
// summarised: a backup that stopped running three weeks ago showed as a date
// the operator had to reason about, a queue that was backed up was only
// visible while the Scanner Queue tab was mounted.
//
// GET /api/v3/admin/health returns raw numbers only, exactly the way
// /api/v3/admin/queue-status does. The thresholds and the worst-first
// ordering live here, in a plain .ts file with no DOM and no React, for the
// same reason queue-status-utils.ts does: this project's Vitest runs in a
// bare node environment and esbuild cannot strip JSX out of a .tsx under
// this repo's "jsx": "preserve" tsconfig, so decision logic in a .tsx is
// logic that never gets a test.

import { formatRelativeTime } from "@/components/admin/utils";
import {
  STALE_PENDING_MS,
  STALE_RUNNING_MS,
  formatAgeMs,
} from "./queue-status-utils";

export type HealthState = "ok" | "warn" | "crit" | "unknown";

/** One background worker as GET /api/v3/admin/health reports it. */
export interface WorkerHealth {
  event: string;
  label: string;
  /** How often it ticks, so "silent for N intervals" can be judged. */
  intervalMs: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  /** When it last recorded anything, success or failure. Null: never. */
  updatedAt: string | null;
}

/**
 * A run of scans where a quarter of them failed inside the engine is a broken
 * scanner. Below MIN_SCAN_VOLUME_FOR_RATE the ratio is noise (one failure
 * out of three scans is 33% and means nothing), so the rate only escalates
 * to red once there is enough volume for it to mean something.
 *
 * "Failed" here means ENGINE failures only (lib/scanner/failure-kinds.ts's
 * ENGINE_FAILURE_KINDS, plus a legacy row with no kind). A user pressing
 * Cancel, a quota refusing a bulk batch and a target that was simply down all
 * end `failed` too, and counting them made a busy day look like an outage.
 * They are reported on the row, separately, and never feed the rate.
 */
export const FAILED_SCAN_RATE_CRIT = 0.25;
export const MIN_SCAN_VOLUME_FOR_RATE = 20;

/**
 * A worker that has failed this many ticks in a row is down, not unlucky. It
 * is the same threshold lib/admin/failure-escalation.ts pages on, so the
 * panel goes red at the moment the webhook would have fired.
 */
export const WORKER_FAILURE_CRIT = 3;

/**
 * A worker that has not recorded anything for this many of its own intervals
 * has stopped ticking. Three rather than two so a restart, a slow tick or a
 * single skipped pass does not flash amber.
 */
export const WORKER_STALE_INTERVALS = 3;

/**
 * Overdue schedules are already 30 minutes late by the time they are counted
 * (the route's cutoff). One this far behind is not a slow queue: the
 * scheduled-scans worker has not been running schedules for hours.
 */
export const OVERDUE_SCHEDULE_CRIT_MS = 6 * 60 * 60 * 1000;

/** Same shape of judgement for outbound mail: any failure is worth a look,
 *  a quarter of the last day's sends failing is a broken transport. */
export const FAILED_EMAIL_RATE_CRIT = 0.25;
export const MIN_EMAIL_VOLUME_FOR_RATE = 20;

/**
 * console.error is captured into system_error_logs (see
 * lib/database/error-log-capture.ts). A steady trickle is normal on a live
 * service; a burst is not. Amber on anything in the last hour so it is
 * visible, red once the hour's volume can no longer be read by hand.
 */
export const ERROR_LOG_HOURLY_CRIT = 25;

/**
 * Backups: red once the newest file is older than two scheduled intervals,
 * which is the first point at which "the timer is dead" is a better
 * explanation than "we are between runs". This is the row that would have
 * surfaced AUDIT-012#obs-02, a scheduled backup failing on every run while
 * still reporting success.
 */
export const BACKUP_STALE_INTERVALS_WARN = 1;
export const BACKUP_STALE_INTERVALS_CRIT = 2;

export interface HealthMetrics {
  /**
   * Each key is absent when the caller's role does not hold the permission
   * that owns it (so an ops account never sees support-ticket counts), and
   * null when the underlying query failed. Absent renders no row at all;
   * null renders an "unknown" row, because a health check that cannot answer
   * is not the same as one that answered "fine".
   */
  scanQueue?: {
    pending: number;
    running: number;
    oldestPendingAgeMs: number | null;
    oldestRunningAgeMs: number | null;
    completedLast24h: number;
    /** ENGINE failures only. The three counts below are the rest. */
    failedLast24h: number;
    /** Cancelled by the owner or by staff. */
    cancelledLast24h: number;
    /** Refused by a limit, or part of a batch that stopped before it ran. */
    refusedLast24h: number;
    /** The target was unreachable, timed out, failed TLS, redirected away or was blocked. */
    targetFailedLast24h: number;
  } | null;
  workers?: {
    /** False on a serverless host, where no worker ever ticks. */
    workersRun: boolean;
    rows: WorkerHealth[];
  } | null;
  overdueSchedules?: {
    workersRun: boolean;
    count: number;
    oldestOverdueMs: number | null;
  } | null;
  backup?: {
    lastBackupAt: string | null;
    scheduledEnabled: boolean;
    intervalMs: number;
  } | null;
  errorLogs?: { lastHour: number } | null;
  email?: { failedLast24h: number; totalLast24h: number } | null;
  securityAlerts?: { unresolved: number; unresolvedSevere: number } | null;
  supportTickets?: { awaitingStaff: number; open: number } | null;
  staffInvites?: { pending: number; expired: number } | null;
  generatedAt: string;
}

export interface HealthRow {
  key: string;
  label: string;
  /** The number itself, or a short duration. Rendered on its own. */
  value: string;
  /** One line saying what the number means and what to do about it. */
  detail: string;
  state: HealthState;
  /** Admin tab this row drills into, so a red row is one click from its owner. */
  tab: string;
}

const STATE_RANK: Record<HealthState, number> = {
  crit: 0,
  warn: 1,
  unknown: 2,
  ok: 3,
};

export function worseState(a: HealthState, b: HealthState): HealthState {
  return STATE_RANK[a] <= STATE_RANK[b] ? a : b;
}

/** Worst state across the list, for the coloured dot on the nav item. */
export function worstHealthState(rows: HealthRow[]): HealthState {
  return rows.reduce<HealthState>(
    (worst, row) => worseState(worst, row.state),
    "ok",
  );
}

function ageOf(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Date.now() - t);
}

function pluralScans(n: number): string {
  return n === 1 ? "scan" : "scans";
}

function scanQueueRow(m: NonNullable<HealthMetrics["scanQueue"]>): HealthRow {
  // Same verdict computeBackedUp makes on the Scanner Queue tab, split into
  // two levels: a stuck 'running' row is a scan that will never finish, a
  // slow 'pending' row is a backlog that may still drain on its own.
  const runningStuck =
    m.running > 0 && (m.oldestRunningAgeMs ?? 0) > STALE_RUNNING_MS;
  const pendingStale =
    m.pending > 0 && (m.oldestPendingAgeMs ?? 0) > STALE_PENDING_MS;
  const state: HealthState = runningStuck
    ? "crit"
    : pendingStale
      ? "warn"
      : "ok";
  const oldest = runningStuck
    ? formatAgeMs(m.oldestRunningAgeMs)
    : formatAgeMs(m.oldestPendingAgeMs);
  return {
    key: "scan-queue",
    label: "Scanner queue",
    value: `${m.pending} pending, ${m.running} running`,
    detail: runningStuck
      ? `A running scan has been going for ${oldest}, past every configured scan timeout. It is stuck, not slow.`
      : pendingStale
        ? `The oldest queued scan has been waiting ${oldest}. A healthy queue starts a scan within seconds.`
        : "Nothing is waiting longer than it should.",
    state,
    tab: "queue-status",
  };
}

/**
 * The failed scans that are not the engine's doing, as a trailing sentence on
 * the failed-scans row. Said out loud rather than dropped: an operator who
 * sees "0 failed" beside a queue full of red rows needs to know where those
 * went.
 */
function notCountedSentence(
  m: NonNullable<HealthMetrics["scanQueue"]>,
): string {
  const parts: string[] = [];
  if (m.cancelledLast24h > 0) parts.push(`${m.cancelledLast24h} cancelled`);
  if (m.refusedLast24h > 0) {
    parts.push(`${m.refusedLast24h} refused by a limit or never run`);
  }
  if (m.targetFailedLast24h > 0) {
    parts.push(`${m.targetFailedLast24h} stopped at the target`);
  }
  return parts.length > 0 ? ` Not counted: ${parts.join(", ")}.` : "";
}

function failedScansRow(m: NonNullable<HealthMetrics["scanQueue"]>): HealthRow {
  // The denominator is what the engine either finished or broke on. A cancel,
  // a refusal and a down target are in neither, so they cannot dilute the
  // rate any more than they can inflate it.
  const total = m.completedLast24h + m.failedLast24h;
  const rate = total > 0 ? m.failedLast24h / total : 0;
  const state: HealthState =
    m.failedLast24h === 0
      ? "ok"
      : total >= MIN_SCAN_VOLUME_FOR_RATE && rate >= FAILED_SCAN_RATE_CRIT
        ? "crit"
        : "warn";
  const headline =
    m.failedLast24h === 0
      ? total === 0
        ? "No scan finished or broke in the last day."
        : `All ${m.completedLast24h} ${pluralScans(m.completedLast24h)} the engine ran in the last day finished.`
      : `${m.failedLast24h} of ${total} ${pluralScans(total)} in the last day failed inside the engine (${Math.round(rate * 100)}%).`;
  return {
    key: "failed-scans",
    label: "Engine failures (24h)",
    value: String(m.failedLast24h),
    detail: `${headline}${notCountedSentence(m)}`,
    state,
    tab: "queue-status",
  };
}

export interface WorkerVerdict {
  state: HealthState;
  /** One sentence naming the problem, or null for a worker with nothing wrong. */
  problem: string | null;
}

function endWithPeriod(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * One worker's verdict. Red at WORKER_FAILURE_CRIT failures in a row, amber
 * once it has been silent for WORKER_STALE_INTERVALS of its own intervals.
 *
 * A worker with no row at all has never recorded a tick on this database. That
 * is the normal state of a fresh install and of a serverless host, so it is
 * not judged: a stalled timer is a worker that DID tick and then stopped. A
 * worker that cannot arm at all is logged at boot, which the error-log row
 * already catches.
 */
export function workerVerdict(w: WorkerHealth): WorkerVerdict {
  if (w.consecutiveFailures >= WORKER_FAILURE_CRIT) {
    const reason = w.lastError ? `: ${endWithPeriod(w.lastError)}` : ".";
    return {
      state: "crit",
      problem: `${w.label} has failed ${w.consecutiveFailures} times in a row${reason}`,
    };
  }
  const silentFor = ageOf(w.updatedAt);
  if (
    silentFor !== null &&
    w.intervalMs > 0 &&
    silentFor > w.intervalMs * WORKER_STALE_INTERVALS
  ) {
    return {
      state: "warn",
      problem: `${w.label} last reported ${formatAgeMs(silentFor)} ago and should tick about every ${formatAgeMs(w.intervalMs)}.`,
    };
  }
  return { state: "ok", problem: null };
}

function workersRow(m: NonNullable<HealthMetrics["workers"]>): HealthRow {
  if (!m.workersRun) {
    return {
      key: "workers",
      label: "Background workers",
      value: "not applicable",
      detail:
        "This host is serverless, so its processes do not live long enough for a worker to tick. Scheduled scans, digests and automatic backups need a long-running host.",
      state: "ok",
      tab: "error-logs",
    };
  }
  const verdicts = m.rows.map((w) => ({ w, v: workerVerdict(w) }));
  const crit = verdicts.filter((x) => x.v.state === "crit");
  const warn = verdicts.filter((x) => x.v.state === "warn");
  const reporting = m.rows.filter((w) => w.updatedAt !== null).length;
  const state: HealthState =
    crit.length > 0 ? "crit" : warn.length > 0 ? "warn" : "ok";
  if (state !== "ok") {
    const problems = [...crit, ...warn].map((x) => x.v.problem);
    return {
      key: "workers",
      label: "Background workers",
      value: `${problems.length} of ${m.rows.length} need attention`,
      detail: problems.join(" "),
      state,
      tab: "error-logs",
    };
  }
  const silent = m.rows.filter((w) => w.updatedAt === null);
  return {
    key: "workers",
    label: "Background workers",
    value: `${reporting} of ${m.rows.length} reporting`,
    detail:
      silent.length === 0
        ? "Every worker has ticked inside its expected interval."
        : `${silent.map((w) => w.label).join(", ")} ${silent.length === 1 ? "has" : "have"} not recorded a tick yet. That is normal on a new install; the slower workers take hours to tick.`,
    state,
    tab: "error-logs",
  };
}

function overdueSchedulesRow(
  m: NonNullable<HealthMetrics["overdueSchedules"]>,
): HealthRow {
  if (!m.workersRun) {
    return {
      key: "overdue-schedules",
      label: "Overdue schedules",
      value: "not applicable",
      detail:
        "This host is serverless, so the scheduled-scans worker never runs and schedules are not executed here.",
      state: "ok",
      tab: "queue-status",
    };
  }
  const state: HealthState =
    m.count === 0
      ? "ok"
      : (m.oldestOverdueMs ?? 0) >= OVERDUE_SCHEDULE_CRIT_MS
        ? "crit"
        : "warn";
  return {
    key: "overdue-schedules",
    label: "Overdue schedules",
    value: String(m.count),
    detail:
      m.count === 0
        ? "Every active schedule is running on time."
        : `${m.count} active ${m.count === 1 ? "schedule was" : "schedules were"} due more than 30 minutes ago and ${m.count === 1 ? "has" : "have"} not run${m.oldestOverdueMs !== null ? `; the oldest is ${formatAgeMs(m.oldestOverdueMs)} late` : ""}. The scheduled-scans worker is down or failing, or scanning is paused.`,
    state,
    tab: "queue-status",
  };
}

function backupRow(m: NonNullable<HealthMetrics["backup"]>): HealthRow {
  const ageMs = ageOf(m.lastBackupAt);
  if (ageMs === null) {
    return {
      key: "backup",
      label: "Last backup",
      value: "never",
      detail: m.scheduledEnabled
        ? "Scheduled backups are on but nothing has been written to the backup directory."
        : "No backup file exists yet. Scheduled backups are off on this deployment.",
      state: m.scheduledEnabled ? "crit" : "warn",
      tab: "backup",
    };
  }
  const age = formatAgeMs(ageMs);
  if (!m.scheduledEnabled) {
    // Nothing is promising a cadence, so an old file is a fact rather than a
    // fault. Printed as an age instead of a raw date so the operator is not
    // doing the staleness arithmetic themselves, which is the specific thing
    // the Backups tab made them do.
    return {
      key: "backup",
      label: "Last backup",
      value: age ?? "unknown",
      detail:
        "Scheduled backups are off, so this is whenever someone last ran one by hand.",
      state: "ok",
      tab: "backup",
    };
  }
  const intervals = m.intervalMs > 0 ? ageMs / m.intervalMs : 0;
  const state: HealthState =
    intervals >= BACKUP_STALE_INTERVALS_CRIT
      ? "crit"
      : intervals >= BACKUP_STALE_INTERVALS_WARN
        ? "warn"
        : "ok";
  return {
    key: "backup",
    label: "Last backup",
    value: age ?? "unknown",
    detail:
      state === "ok"
        ? "Within the configured backup interval."
        : `Older than ${Math.floor(intervals)} backup ${Math.floor(intervals) === 1 ? "interval" : "intervals"}. The scheduled backup is not running, or it is running and failing.`,
    state,
    tab: "backup",
  };
}

function errorLogsRow(m: NonNullable<HealthMetrics["errorLogs"]>): HealthRow {
  const state: HealthState =
    m.lastHour === 0
      ? "ok"
      : m.lastHour >= ERROR_LOG_HOURLY_CRIT
        ? "crit"
        : "warn";
  return {
    key: "error-logs",
    label: "Errors logged (1h)",
    value: String(m.lastHour),
    detail:
      m.lastHour === 0
        ? "Nothing hit console.error in the last hour."
        : `${m.lastHour} captured in the last hour.`,
    state,
    tab: "error-logs",
  };
}

function emailRow(m: NonNullable<HealthMetrics["email"]>): HealthRow {
  const rate = m.totalLast24h > 0 ? m.failedLast24h / m.totalLast24h : 0;
  const state: HealthState =
    m.failedLast24h === 0
      ? "ok"
      : m.totalLast24h >= MIN_EMAIL_VOLUME_FOR_RATE &&
          rate >= FAILED_EMAIL_RATE_CRIT
        ? "crit"
        : "warn";
  return {
    key: "email",
    label: "Failed emails (24h)",
    value: String(m.failedLast24h),
    detail:
      m.failedLast24h === 0
        ? `All ${m.totalLast24h} sent in the last day were accepted by the transport.`
        : `${m.failedLast24h} of ${m.totalLast24h} sends failed. Verification and reset mail goes down the same path.`,
    state,
    tab: "email-logs",
  };
}

function securityAlertsRow(
  m: NonNullable<HealthMetrics["securityAlerts"]>,
): HealthRow {
  const state: HealthState =
    m.unresolved === 0 ? "ok" : m.unresolvedSevere > 0 ? "crit" : "warn";
  return {
    key: "security-alerts",
    label: "Unresolved alerts",
    value: String(m.unresolved),
    detail:
      m.unresolved === 0
        ? "Every security alert has been resolved."
        : m.unresolvedSevere > 0
          ? m.unresolvedSevere === m.unresolved
            ? m.unresolved === 1
              ? "It is high or critical."
              : "All of them are high or critical."
            : `${m.unresolvedSevere} of them ${m.unresolvedSevere === 1 ? "is" : "are"} high or critical.`
          : "All low or medium severity.",
    state,
    tab: "security-alerts",
  };
}

function supportTicketsRow(
  m: NonNullable<HealthMetrics["supportTickets"]>,
): HealthRow {
  return {
    key: "support-tickets",
    label: "Tickets awaiting staff",
    value: String(m.awaitingStaff),
    detail:
      m.awaitingStaff === 0
        ? `${m.open} open, none of them waiting on us.`
        : `${m.awaitingStaff} of ${m.open} open tickets are waiting on a staff reply.`,
    state: m.awaitingStaff === 0 ? "ok" : "warn",
    tab: "support-tickets",
  };
}

function staffInvitesRow(
  m: NonNullable<HealthMetrics["staffInvites"]>,
): HealthRow {
  const state: HealthState = m.expired > 0 ? "warn" : "ok";
  return {
    key: "staff-invites",
    label: "Staff invites",
    value: `${m.pending} pending`,
    detail:
      m.expired > 0
        ? `${m.expired} expired without ever being accepted. Either the invitee never saw the mail or the accept flow did not work for them.`
        : m.pending === 0
          ? "No outstanding invites."
          : "Outstanding invites are still inside their expiry window.",
    state,
    tab: "admins",
  };
}

function unknownRow(key: string, label: string, tab: string): HealthRow {
  return {
    key,
    label,
    value: "unavailable",
    detail: "This check could not be read. See the error logs.",
    state: "unknown",
    tab,
  };
}

/**
 * Turns the raw metric payload into the rendered status list, worst first.
 * `updateAvailable` comes from the updater status the panel already fetches
 * on load for the nav dot, so it costs no extra request.
 */
export function buildHealthRows(
  metrics: HealthMetrics | null,
  extra?: { updateAvailable?: boolean },
): HealthRow[] {
  const rows: HealthRow[] = [];
  if (metrics) {
    if (metrics.scanQueue !== undefined) {
      if (metrics.scanQueue === null) {
        rows.push(unknownRow("scan-queue", "Scanner queue", "queue-status"));
        rows.push(
          unknownRow("failed-scans", "Engine failures (24h)", "queue-status"),
        );
      } else {
        rows.push(scanQueueRow(metrics.scanQueue));
        rows.push(failedScansRow(metrics.scanQueue));
      }
    }
    if (metrics.workers !== undefined) {
      rows.push(
        metrics.workers === null
          ? unknownRow("workers", "Background workers", "error-logs")
          : workersRow(metrics.workers),
      );
    }
    if (metrics.overdueSchedules !== undefined) {
      rows.push(
        metrics.overdueSchedules === null
          ? unknownRow("overdue-schedules", "Overdue schedules", "queue-status")
          : overdueSchedulesRow(metrics.overdueSchedules),
      );
    }
    if (metrics.backup !== undefined) {
      rows.push(
        metrics.backup === null
          ? unknownRow("backup", "Last backup", "backup")
          : backupRow(metrics.backup),
      );
    }
    if (metrics.errorLogs !== undefined) {
      rows.push(
        metrics.errorLogs === null
          ? unknownRow("error-logs", "Errors logged (1h)", "error-logs")
          : errorLogsRow(metrics.errorLogs),
      );
    }
    if (metrics.email !== undefined) {
      rows.push(
        metrics.email === null
          ? unknownRow("email", "Failed emails (24h)", "email-logs")
          : emailRow(metrics.email),
      );
    }
    if (metrics.securityAlerts !== undefined) {
      rows.push(
        metrics.securityAlerts === null
          ? unknownRow(
              "security-alerts",
              "Unresolved alerts",
              "security-alerts",
            )
          : securityAlertsRow(metrics.securityAlerts),
      );
    }
    if (metrics.supportTickets !== undefined) {
      rows.push(
        metrics.supportTickets === null
          ? unknownRow(
              "support-tickets",
              "Tickets awaiting staff",
              "support-tickets",
            )
          : supportTicketsRow(metrics.supportTickets),
      );
    }
    if (metrics.staffInvites !== undefined) {
      rows.push(
        metrics.staffInvites === null
          ? unknownRow("staff-invites", "Staff invites", "admins")
          : staffInvitesRow(metrics.staffInvites),
      );
    }
  }
  if (extra?.updateAvailable) {
    rows.push({
      key: "updater",
      label: "Application version",
      value: "update available",
      detail: "A newer release is published. Review it before applying.",
      state: "warn",
      tab: "updater",
    });
  }
  // Worst first, then stable by insertion order within a state so the list
  // does not reshuffle between polls when nothing has changed.
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        STATE_RANK[a.row.state] - STATE_RANK[b.row.state] || a.index - b.index,
    )
    .map((entry) => entry.row);
}

/**
 * Every optional metric key buildHealthRows reads. The permission filter on
 * the route decides which of them a given role actually receives, so this is
 * the ceiling rather than the count any one operator sees.
 */
export const HEALTH_CHECK_KEYS = [
  "scanQueue",
  "workers",
  "overdueSchedules",
  "backup",
  "errorLogs",
  "email",
  "securityAlerts",
  "supportTickets",
  "staffInvites",
] as const;

/**
 * How many rows the health list reserves while it is waiting.
 *
 * Run through buildHealthRows rather than typed next to it: the skeleton in
 * components/admin/shared/skeleton.tsx said eight in a comment while the card's
 * own pre-fetch state passed six, so the route drew eight rows, the card
 * redrew six, and the real list then arrived at eight again. scanQueue emits
 * two rows on its own, which is exactly the sort of detail a hand-typed count
 * gets wrong. `updateAvailable` is left off: a ninth row only exists on a
 * deployment with a pending release, so reserving it would be wrong far more
 * often than right.
 */
const ALL_CHECKS_UNKNOWN: HealthMetrics = { generatedAt: "" };
for (const key of HEALTH_CHECK_KEYS) ALL_CHECKS_UNKNOWN[key] = null;

export const HEALTH_ROW_COUNT = buildHealthRows(ALL_CHECKS_UNKNOWN).length;

/** "2 minutes ago" for the "as of" line under the list. */
export function formatGeneratedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatRelativeTime(d);
}
