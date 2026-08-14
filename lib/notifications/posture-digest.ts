/**
 * Periodic posture digest (AUDIT-010): a weekly/monthly summary across
 * every site a user has scanned, sent only to users who've opted in
 * (users.digest_email_enabled, see lib/notifications/digest-schema.ts).
 * Every other notification in this app is per-scan or per-event
 * (scanCompleteEmail, criticalFindingsEmail, scheduledScanCompleteEmail);
 * this is the first one that looks across a user's whole account.
 *
 * Design, mirroring lib/scanner/scheduled-scans-worker.ts's shape:
 *
 * - `buildDigestForUser` computes one user's digest by diffing the latest
 *   completed scan of each distinct site against what that same site's
 *   latest completed scan looked like as of the previous digest (or
 *   CONFIG_POSTURE_DIGEST_WINDOW_DAYS ago, for a user's first digest).
 *   Reuses diffFindingsByKey (lib/scanner/finding-diff.ts), the same
 *   primitive lib/scanner/regression-alert.ts's per-scan regression check
 *   uses, keyed on Vulnerability.id -- a stable per-check-per-URL id, which
 *   is what makes "is this the same finding as last time" answerable
 *   across two arbitrary scans of the same site. A finding the user has
 *   marked false_positive (scan_finding_feedback) is excluded from both
 *   the "new" list and the open counts, same as the per-scan regression
 *   alert.
 *
 * - `getDueDigestUsers` / `sendWeeklyDigests` is the batch job: find
 *   opted-in, non-disabled users whose last digest (or opt-in) is at
 *   least CONFIG_POSTURE_DIGEST_WINDOW_DAYS old, build each one's digest,
 *   and send it through the same sendNotificationEmail infra every other
 *   category uses (deployment-wide FEATURE_EMAIL_NOTIFICATIONS kill
 *   switch, per-user email_posture_digest preference, unsubscribe token).
 *   A user with zero completed scans still has last_digest_sent_at
 *   stamped (no email) so they aren't re-queried as "due" on every
 *   polling tick forever.
 *
 * - `schedulePeriodicPostureDigest` is the same in-process setInterval
 *   pattern as lib/database/cleanup.ts's schedulePeriodicCleanup and
 *   scheduled-scans-worker.ts's schedulePeriodicScheduledScans: unref'd,
 *   only fires in a long-lived deployment, safe to call again (cancels
 *   any previous timer first).
 */

import pool from "@/lib/database/db";
import { getSetting } from "@/lib/config/runtime-config";
import {
  CONFIG_POSTURE_DIGEST_POLL_INTERVAL_MS,
  CONFIG_POSTURE_DIGEST_WINDOW_DAYS,
  CONFIG_POSTURE_DIGEST_MAX_FINDINGS_LISTED,
} from "@/lib/config/config-values";
import { APP_NAME } from "@/lib/config/constants";
import { diffFindingsByKey } from "@/lib/scanner/finding-diff";
import type { Vulnerability } from "@/lib/scanner/types";
import { sendNotificationEmail } from "./notifications";
import { postureDigestEmail, type PostureDigestData } from "@/lib/email/email";

function isCriticalOrHigh(f: Vulnerability): boolean {
  return f.severity === "critical" || f.severity === "high";
}

/** Findings this user has marked false_positive on any site -- excluded
 *  from both the "new" list and the open counts, same suppression rule
 *  lib/scanner/regression-alert.ts applies to the per-scan alert. */
async function getSuppressedFindingIds(userId: number): Promise<Set<string>> {
  const result = await pool.query<{ finding_id: string }>(
    `SELECT finding_id FROM scan_finding_feedback
     WHERE user_id = $1 AND verdict = 'false_positive'`,
    [userId],
  );
  return new Set(result.rows.map((r) => r.finding_id));
}

/** The latest *completed* scan's findings for each distinct URL this user
 *  has scanned, as of `asOf` (or overall, when omitted). Used twice per
 *  digest: once with no cutoff (the current picture) and once with `asOf`
 *  set to the previous digest boundary (the baseline to diff against). */
async function getLatestFindingsPerUrl(
  userId: number,
  asOf?: Date,
): Promise<Map<string, Vulnerability[]>> {
  const result = asOf
    ? await pool.query<{ url: string; findings: unknown }>(
        `SELECT DISTINCT ON (url) url, findings
         FROM scan_history
         WHERE user_id = $1 AND status = 'completed' AND scanned_at <= $2
         ORDER BY url, scanned_at DESC`,
        [userId, asOf.toISOString()],
      )
    : await pool.query<{ url: string; findings: unknown }>(
        `SELECT DISTINCT ON (url) url, findings
         FROM scan_history
         WHERE user_id = $1 AND status = 'completed'
         ORDER BY url, scanned_at DESC`,
        [userId],
      );

  const map = new Map<string, Vulnerability[]>();
  for (const row of result.rows) {
    const raw = row.findings;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    map.set(row.url, Array.isArray(parsed) ? (parsed as Vulnerability[]) : []);
  }
  return map;
}

/**
 * Build one user's digest. Returns null when the user has no completed
 * scan of anything yet -- nothing to summarize, so sendWeeklyDigests skips
 * sending (but still stamps last_digest_sent_at).
 */
export async function buildDigestForUser(
  userId: number,
  windowStart: Date,
): Promise<PostureDigestData | null> {
  const [currentMap, baselineMap, suppressed] = await Promise.all([
    getLatestFindingsPerUrl(userId),
    getLatestFindingsPerUrl(userId, windowStart),
    getSuppressedFindingIds(userId),
  ]);

  if (currentMap.size === 0) return null;

  const newFindings: PostureDigestData["newFindings"] = [];
  let currentOpenCount = 0;
  let previousOpenCount = 0;

  for (const [url, current] of currentMap) {
    const baseline = baselineMap.get(url) ?? [];
    const { added } = diffFindingsByKey(baseline, current, (f) => f.id);

    currentOpenCount += current.filter(
      (f) => isCriticalOrHigh(f) && !suppressed.has(f.id),
    ).length;
    previousOpenCount += baseline.filter(
      (f) => isCriticalOrHigh(f) && !suppressed.has(f.id),
    ).length;

    for (const f of added) {
      if (isCriticalOrHigh(f) && !suppressed.has(f.id)) {
        newFindings.push({ title: f.title, severity: f.severity, url });
      }
    }
  }

  // Critical first, then high -- both groups otherwise keep the
  // per-site iteration order above (Map preserves insertion order).
  newFindings.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1,
  );

  const newFindingsTotal = newFindings.length;

  return {
    siteCount: currentMap.size,
    newFindings: newFindings.slice(
      0,
      CONFIG_POSTURE_DIGEST_MAX_FINDINGS_LISTED,
    ),
    newFindingsTotal,
    newCriticalCount: newFindings.filter((f) => f.severity === "critical")
      .length,
    newHighCount: newFindings.filter((f) => f.severity === "high").length,
    currentOpenCount,
    previousOpenCount,
    trend:
      currentOpenCount > previousOpenCount
        ? "up"
        : currentOpenCount < previousOpenCount
          ? "down"
          : "flat",
    windowDays: CONFIG_POSTURE_DIGEST_WINDOW_DAYS,
  };
}

export interface DueDigestUser {
  id: number;
  email: string;
  last_digest_sent_at: Date | null;
}

/** Opted-in, non-disabled users whose digest is due: never sent one, or
 *  their last one is at least `windowDays` old. */
export async function getDueDigestUsers(
  windowDays: number = CONFIG_POSTURE_DIGEST_WINDOW_DAYS,
): Promise<DueDigestUser[]> {
  const result = await pool.query<DueDigestUser>(
    `SELECT id, email, last_digest_sent_at
     FROM users
     WHERE digest_email_enabled = true
       AND disabled_at IS NULL
       AND (last_digest_sent_at IS NULL OR last_digest_sent_at <= NOW() - make_interval(days => $1))
     ORDER BY id`,
    [windowDays],
  );
  return result.rows;
}

export interface SendWeeklyDigestsStats {
  candidates: number;
  sent: number;
  skippedNoSites: number;
  errors: number;
}

/**
 * One full pass: find who's due, build and send each digest, stamp
 * last_digest_sent_at. Exported directly (not just via the periodic
 * timer), same as scheduled-scans-worker.ts's runDueSchedules, so a
 * "force a run now" admin action has something to call.
 */
export async function sendWeeklyDigests(): Promise<SendWeeklyDigestsStats> {
  const stats: SendWeeklyDigestsStats = {
    candidates: 0,
    sent: 0,
    skippedNoSites: 0,
    errors: 0,
  };

  // deployment-wide kill switch, separate from FEATURE_EMAIL_NOTIFICATIONS
  // (which sendNotificationEmail below already checks) -- lets an admin
  // pause just this feature.
  if (!(await getSetting("POSTURE_DIGEST_ENABLED"))) return stats;

  const due = await getDueDigestUsers(CONFIG_POSTURE_DIGEST_WINDOW_DAYS);
  stats.candidates = due.length;
  if (due.length === 0) return stats;

  const now = new Date();

  for (const user of due) {
    try {
      const windowStart =
        user.last_digest_sent_at ??
        new Date(
          now.getTime() -
            CONFIG_POSTURE_DIGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        );
      const digest = await buildDigestForUser(user.id, windowStart);

      if (digest) {
        await sendNotificationEmail({
          userId: user.id,
          userEmail: user.email,
          type: "posture_digest",
          emailContent: postureDigestEmail(digest),
        });
        stats.sent++;
      } else {
        stats.skippedNoSites++;
      }

      await pool.query(
        `UPDATE users SET last_digest_sent_at = $1 WHERE id = $2`,
        [now, user.id],
      );
    } catch (err) {
      stats.errors++;
      console.error(
        `[${APP_NAME}] Posture digest failed for user #${user.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return stats;
}

function formatStats(stats: SendWeeklyDigestsStats): string {
  return (
    `${stats.sent} sent, ${stats.skippedNoSites} skipped (no sites), ` +
    `${stats.errors} errored (of ${stats.candidates} due)`
  );
}

let activeDigestTimer: NodeJS.Timeout | null = null;

/**
 * Schedule a repeating pass over due posture digests. Same pattern as
 * lib/scanner/scheduled-scans-worker.ts's schedulePeriodicScheduledScans:
 * an in-process setInterval, unref'd so a pending pass never keeps the
 * process alive on SIGTERM, only fires in a long-lived deployment
 * (Node/Docker/self-hosted -- not serverless). Returns the timer handle so
 * callers can clearInterval on shutdown; a repeat call cancels any
 * previously scheduled timer first (prevents double-scheduling on hot
 * reload).
 */
export function schedulePeriodicPostureDigest(
  intervalMs: number = CONFIG_POSTURE_DIGEST_POLL_INTERVAL_MS,
): NodeJS.Timeout {
  if (activeDigestTimer) {
    clearInterval(activeDigestTimer);
  }
  const safeInterval =
    Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : CONFIG_POSTURE_DIGEST_POLL_INTERVAL_MS;

  activeDigestTimer = setInterval(async () => {
    try {
      const stats = await sendWeeklyDigests();
      if (stats.sent > 0 || stats.errors > 0) {
        console.log(
          `[${APP_NAME}] Posture digest worker: ${formatStats(stats)}`,
        );
      }
    } catch (err) {
      console.error(`[${APP_NAME}] Posture digest worker pass failed:`, err);
    }
  }, safeInterval);
  activeDigestTimer.unref?.();
  return activeDigestTimer;
}

export function stopPeriodicPostureDigest(): void {
  if (activeDigestTimer) {
    clearInterval(activeDigestTimer);
    activeDigestTimer = null;
  }
}
