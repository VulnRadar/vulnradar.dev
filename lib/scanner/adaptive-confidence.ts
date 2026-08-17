/**
 * Post-processing pass that discounts a finding's confidence when its
 * check has a real, statistically meaningful false-positive rate from
 * user feedback (scan_finding_feedback, aggregated in
 * lib/scanner/check-accuracy.ts) -- closing the loop the admin Engine
 * Feedback panel's "Check Accuracy" table already surfaces but, until
 * now, never applied automatically.
 *
 * Deliberately conservative: a check only ever gets touched once it
 * crosses the EXACT same "flagged" threshold the admin panel already
 * uses (ENGINE_FEEDBACK_MIN_SAMPLE_SIZE + ENGINE_FEEDBACK_NOISE_THRESHOLD_PERCENT),
 * so a check with too little feedback, or a normal/low false-positive
 * rate, is never adjusted -- this only kicks in for a check an admin
 * would already see flagged as noisy. The discount itself is
 * proportional: `confidence * (1 - falsePositiveRate / 100)`, so a check
 * flagged at a 40% false-positive rate has its findings' confidence
 * multiplied by 0.6, never floored below 0.
 *
 * The per-check accuracy map is cached in-memory with a TTL: feedback
 * accumulates slowly (human submissions), so recomputing the full
 * scan_finding_feedback aggregation on every single scan would be one
 * more full table scan per scan for no real benefit. Fail-open by
 * construction, matching every other post-processing pass in this
 * codebase (cve-enrichment.ts, cvss.ts): any failure here returns
 * findings unmodified rather than failing the scan.
 */

import { getSetting } from "@/lib/config/runtime-config";
import { aggregateCheckAccuracy, extractCheckId } from "./check-accuracy";
import type { CheckAccuracyCounts } from "./check-accuracy";
import type { Vulnerability } from "./types";
import { APP_NAME } from "@/lib/config/constants";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

let cache: {
  map: Map<string, CheckAccuracyCounts>;
  fetchedAt: number;
} | null = null;

function isCacheFresh(): boolean {
  return cache !== null && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}

async function getCachedCheckAccuracy(): Promise<
  Map<string, CheckAccuracyCounts>
> {
  if (isCacheFresh()) return cache!.map;
  try {
    const map = await aggregateCheckAccuracy();
    cache = { map, fetchedAt: Date.now() };
    return map;
  } catch (err) {
    console.error(
      `[${APP_NAME}] adaptive-confidence: failed to refresh check-accuracy cache (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return cache?.map ?? new Map();
  }
}

/** Test-only: clears the module-level cache so each test starts cold. */
export function _resetCheckAccuracyCacheForTests(): void {
  cache = null;
}

/**
 * Discounts confidence on any finding whose check is currently flagged
 * (real, sufficient-sample false-positive rate). Findings for checks with
 * no feedback, insufficient feedback, or a normal false-positive rate are
 * returned unchanged (same object reference). A finding with no
 * confidence set at all is left alone -- there's nothing to adjust.
 */
export async function applyAdaptiveConfidence(
  findings: Vulnerability[],
): Promise<Vulnerability[]> {
  if (findings.length === 0) return findings;

  try {
    if (!(await getSetting("ADAPTIVE_CONFIDENCE_ENABLED"))) return findings;

    const [minSampleSize, thresholdPercent, accuracyMap] = await Promise.all([
      getSetting("ENGINE_FEEDBACK_MIN_SAMPLE_SIZE"),
      getSetting("ENGINE_FEEDBACK_NOISE_THRESHOLD_PERCENT"),
      getCachedCheckAccuracy(),
    ]);
    if (accuracyMap.size === 0) return findings;

    return findings.map((finding) => {
      if (finding.confidence === undefined) return finding;
      const accuracy = accuracyMap.get(extractCheckId(finding.id));
      if (!accuracy) return finding;

      const flagged =
        accuracy.total >= minSampleSize &&
        accuracy.falsePositiveRate >= thresholdPercent;
      if (!flagged) return finding;

      const confidence = Math.max(
        0,
        Math.round(finding.confidence * (1 - accuracy.falsePositiveRate / 100)),
      );
      return { ...finding, confidence };
    });
  } catch (err) {
    console.error(
      `[${APP_NAME}] adaptive-confidence: pass failed (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return findings;
  }
}
