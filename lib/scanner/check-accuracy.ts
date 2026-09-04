/**
 * Aggregates scan_finding_feedback (collected app-wide via POST
 * /api/v3/scan/feedback) into a per-check false-positive rate: across
 * every user's feedback, what fraction of instances of this check got
 * marked false_positive vs confirmed vs not_applicable.
 *
 * Shared by two consumers with different freshness needs: the admin
 * Engine Feedback panel (app/api/v3/admin/engine-feedback/checks/route.ts)
 * reads it live, on demand; lib/scanner/adaptive-confidence.ts caches it
 * with a TTL and uses it to discount a finding's confidence for a check
 * with a real, statistically meaningful false-positive rate. Both need the
 * exact same extraction/aggregation logic, so it lives here once rather
 * than risking the two definitions drifting apart.
 */

import pool from "@/lib/database/db";

/**
 * Everything before the LAST "--" in a stable finding id
 * (`<checkId>--<hash>`, see lib/scanner/_helpers.ts's generateId). Using
 * the last occurrence, not the first, is defensive rather than load-
 * bearing today -- no check id in lib/scanner/checks-data/*.json currently
 * contains a literal "--" -- but it is what the id format actually
 * guarantees: the hash is everything after the final separator.
 */
export function extractCheckId(findingId: string): string {
  const idx = findingId.lastIndexOf("--");
  return idx === -1 ? findingId : findingId.slice(0, idx);
}

export interface CheckAccuracyCounts {
  confirmed: number;
  falsePositive: number;
  notApplicable: number;
  total: number;
  /** 0-100, one decimal place. */
  falsePositiveRate: number;
}

interface FeedbackVerdictRow {
  finding_id: string;
  verdict: "confirmed" | "false_positive" | "not_applicable";
  count: number;
}

/**
 * A live GROUP BY, not a materialized table: feedback row counts are
 * nowhere near the volume that would justify precomputation on write.
 * Callers that run this often (every scan, potentially) should cache the
 * result themselves rather than calling this per-finding or per-scan --
 * see adaptive-confidence.ts's own TTL cache.
 */
export async function aggregateCheckAccuracy(): Promise<
  Map<string, CheckAccuracyCounts>
> {
  const result = await pool.query<FeedbackVerdictRow>(
    `SELECT finding_id, verdict, COUNT(*)::int AS count
     FROM scan_finding_feedback
     GROUP BY finding_id, verdict`,
  );

  const byCheck = new Map<
    string,
    { confirmed: number; falsePositive: number; notApplicable: number }
  >();
  for (const row of result.rows) {
    const checkId = extractCheckId(row.finding_id);
    const entry = byCheck.get(checkId) ?? {
      confirmed: 0,
      falsePositive: 0,
      notApplicable: 0,
    };
    if (row.verdict === "confirmed") entry.confirmed += row.count;
    else if (row.verdict === "false_positive") entry.falsePositive += row.count;
    else if (row.verdict === "not_applicable") entry.notApplicable += row.count;
    byCheck.set(checkId, entry);
  }

  const out = new Map<string, CheckAccuracyCounts>();
  for (const [checkId, counts] of byCheck) {
    const total =
      counts.confirmed + counts.falsePositive + counts.notApplicable;
    const falsePositiveRate =
      total > 0 ? Math.round((counts.falsePositive / total) * 1000) / 10 : 0;
    out.set(checkId, { ...counts, total, falsePositiveRate });
  }
  return out;
}

/**
 * Lower bound of the Wilson score interval for a proportion, at ~95%
 * confidence (z = 1.96).
 *
 * The raw false-positive rate is a terrible ranking key at small n: one
 * report of "false positive" and nothing else is 100%, which outranks a
 * check with six false positives out of ten. Wilson answers the question
 * the operator is actually asking -- "how bad is this check at worst,
 * given how little we know?" -- so 1/1 scores 0.21 while 6/10 scores 0.31
 * and the better-evidenced check sorts first. The rate itself is still
 * shown; this only decides order.
 */
export function wilsonLowerBound(successes: number, total: number): number {
  if (total <= 0) return 0;
  const z = 1.96;
  const z2 = z * z;
  const p = successes / total;
  const denominator = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const margin =
    z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return Math.max(0, (centre - margin) / denominator);
}

/**
 * How many false-positive reports a check that has NEVER been confirmed
 * needs before the panel calls it out.
 *
 * The flat "20% of at least 5 samples" rule cannot see these at all: a
 * Critical check with one report, that report being "false positive", is
 * n=1 and so invisible, while a Low check sitting at exactly 20% over 5
 * samples gets flagged. That is backwards. A finding nobody has ever
 * agreed with is a different and worse failure than a finding people
 * sometimes disagree with, and the more severe the finding the louder it
 * is when it misfires: a bogus Critical is what makes someone distrust
 * the whole scanner. So the bar drops to a single report for Critical and
 * High, and stays at two everywhere else (including unknown severity) so
 * a lone shrug on a Low check does not fill the page with n=1 noise.
 */
const NEVER_CONFIRMED_MIN_FALSE_POSITIVES: Record<string, number> = {
  critical: 1,
  high: 1,
  medium: 2,
  low: 2,
  info: 2,
};
const NEVER_CONFIRMED_DEFAULT_MIN = 2;

export function neverConfirmedFloor(severity: string | null): number {
  if (!severity) return NEVER_CONFIRMED_DEFAULT_MIN;
  return (
    NEVER_CONFIRMED_MIN_FALSE_POSITIVES[severity.toLowerCase()] ??
    NEVER_CONFIRMED_DEFAULT_MIN
  );
}

/**
 * Ranking weight per severity. Two checks with the same evidence are not
 * equally urgent to retune: a wrong Critical is what makes someone stop
 * trusting the scanner, a wrong Info is background noise. Within one
 * severity the Wilson bound decides everything, so ten reports at 60%
 * still outrank one at 100%; across severities the spread here (1.6 down
 * to 0.85) is wide enough that a never-confirmed Critical can outrank a
 * well-evidenced Info, which is the intended answer to "what should I
 * look at first".
 */
const SEVERITY_PRIORITY_WEIGHT: Record<string, number> = {
  critical: 1.6,
  high: 1.35,
  medium: 1.15,
  low: 1,
  info: 0.85,
};

export interface CheckAccuracyVerdictRule {
  /** 0-100. The existing ENGINE_FEEDBACK_NOISE_THRESHOLD_PERCENT setting. */
  thresholdPercent: number;
  /** The existing ENGINE_FEEDBACK_MIN_SAMPLE_SIZE setting. */
  minSampleSize: number;
}

export interface CheckAccuracyAssessment {
  /**
   * The original rule, unchanged: at or above the configured
   * false-positive percentage, with at least the configured sample size.
   * Both settings still mean exactly what they meant before.
   */
  flagged: boolean;
  /**
   * Never once confirmed, and reported false at least
   * neverConfirmedFloor(severity) times. Independent of `flagged`: it is
   * what that rule structurally cannot see.
   */
  neverConfirmed: boolean;
  /** Sort key. Higher is more worth an operator's time. */
  priority: number;
}

export function assessCheckAccuracy(
  counts: CheckAccuracyCounts,
  severity: string | null,
  rule: CheckAccuracyVerdictRule,
): CheckAccuracyAssessment {
  const weight = severity
    ? (SEVERITY_PRIORITY_WEIGHT[severity.toLowerCase()] ?? 1)
    : 1;
  return {
    flagged:
      counts.total >= rule.minSampleSize &&
      counts.falsePositiveRate >= rule.thresholdPercent,
    neverConfirmed:
      counts.confirmed === 0 &&
      counts.falsePositive >= neverConfirmedFloor(severity),
    priority:
      Math.round(
        wilsonLowerBound(counts.falsePositive, counts.total) * weight * 10000,
      ) / 10000,
  };
}

/** One submitted verdict, as the admin panel's expandable row shows it. */
export interface CheckFeedbackVerdict {
  id: number;
  checkId: string;
  /** The page the finding was on. Rendered as text, never as a link. */
  findingUrl: string;
  verdict: "confirmed" | "false_positive" | "not_applicable";
  /** Free text the submitter typed. Truncated; may be empty. */
  notes: string;
  createdAt: string;
}

interface FeedbackDetailRow {
  id: number;
  finding_id: string;
  finding_url: string;
  verdict: CheckFeedbackVerdict["verdict"];
  notes: string | null;
  created_at: Date | string;
}

/** Long enough to be evidence, short enough not to wreck the table. */
const MAX_URL_CHARS = 300;
const MAX_NOTE_CHARS = 500;

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

/**
 * The individual verdicts behind one or more check-accuracy rows.
 *
 * Counts alone say "credit-card-pattern is 100% false positive" but not
 * what it fired on or why the submitter disagreed, which is the only part
 * that tells someone how to fix the detector. Loaded on demand rather
 * than with the table, and capped per check, so one noisy check cannot
 * blow up the response.
 *
 * `finding_id` is `<checkId>--<hash>`, so the SQL narrows with a prefix
 * LIKE and the exact grouping is re-done in JS with extractCheckId --
 * a check id that itself contained "--" would otherwise pull in a
 * neighbouring check's rows.
 */
export async function fetchCheckFeedbackVerdicts(
  checkIds: string[],
  perCheck: number,
): Promise<Map<string, CheckFeedbackVerdict[]>> {
  const out = new Map<string, CheckFeedbackVerdict[]>();
  if (checkIds.length === 0 || perCheck <= 0) return out;
  for (const id of checkIds) out.set(id, []);

  // LIKE metacharacters in a check id would otherwise widen the match.
  const patterns = checkIds.map(
    (id) => `${id.replace(/[\\%_]/g, (c) => `\\${c}`)}--%`,
  );
  // A hard ceiling on top of the per-check cap: this is a live admin read,
  // not a report job.
  const globalCap = Math.min(checkIds.length * perCheck * 2, 2000);

  const result = await pool.query<FeedbackDetailRow>(
    `SELECT id, finding_id, finding_url, verdict, notes, created_at
     FROM scan_finding_feedback
     WHERE finding_id = ANY($1::text[])
        OR finding_id LIKE ANY($2::text[])
     ORDER BY created_at DESC, id DESC
     LIMIT $3`,
    [checkIds, patterns, globalCap],
  );

  for (const row of result.rows) {
    const checkId = extractCheckId(row.finding_id);
    const bucket = out.get(checkId);
    if (!bucket || bucket.length >= perCheck) continue;
    bucket.push({
      id: row.id,
      checkId,
      findingUrl: clamp(row.finding_url ?? "", MAX_URL_CHARS),
      verdict: row.verdict,
      notes: clamp((row.notes ?? "").trim(), MAX_NOTE_CHARS),
      createdAt: new Date(row.created_at).toISOString(),
    });
  }
  return out;
}
