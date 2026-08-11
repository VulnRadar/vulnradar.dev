/**
 * Scan execution.
 *
 * `registry.ts` owns the check inventory: the legacy `(url, headers, body)`
 * detector map, and the `PageCheck` definitions from `checks/page-checks/**`.
 * This module is where a single response actually gets evaluated against
 * both: it builds the parsed `PageContext` once, runs every applicable
 * check, skips (and counts) checks whose declared requirements the response
 * does not meet, and deduplicates the result before handing it back to a
 * route handler.
 *
 * A single slow or throwing check must not take down the scan: every call
 * into a check is wrapped so one bad detector degrades to a missing finding,
 * not a failed response.
 */

import type { Category, ScanProgressHook, Vulnerability } from "./types";
import { ALL_CATEGORIES } from "./types";
import { getChecksByCategory } from "./registry";
import { pageChecks, pageCheckGroups } from "./checks/page-checks";
import {
  requirementsMet,
  METHOD_CONFIDENCE,
  type PageCheck,
  type CheckHit,
} from "./check-types";
import { buildPageContext } from "./page-context";
import { dedupeFindings } from "./dedupe";
import { generateId } from "./_helpers";

export interface SyncCheckResult {
  findings: Vulnerability[];
  /** Checks that were invoked and reached a conclusion (finding or not). */
  checksRun: number;
  /** Checks skipped because the response did not meet their declared `needs`. */
  checksSkipped: number;
  /** Findings folded into another finding as duplicates of the same issue. */
  deduped: number;
}

/**
 * A string that differs between two hits from the same check's `run()` call
 * when, and only when, the hits describe genuinely different things, so
 * `generateId` can fold it in and keep multi-hit findings from colliding on
 * id (see check-types.ts's `CheckHit | CheckHit[] | null` and _helpers.ts's
 * `generateId`).
 *
 * Prefers the hit's excerpts, the verbatim proof pointing at the specific
 * thing found (e.g. a script `src` URL), over its `evidence` summary: two
 * hits can share identical evidence text (the same library name and
 * version) while pointing at two different script URLs, which excerpts
 * would still tell apart.
 */
function hitDistinguisher(hit: CheckHit): string {
  if (hit.excerpts && hit.excerpts.length > 0) {
    return hit.excerpts.map((e) => `${e.label}:${e.value}`).join("|");
  }
  return hit.evidence;
}

function hitToVulnerability(
  check: PageCheck,
  hit: CheckHit,
  url: string,
  distinguish: boolean,
): Vulnerability {
  const confidence =
    hit.confidence ?? check.confidence ?? METHOD_CONFIDENCE[check.method];
  return {
    id: generateId(
      check.id,
      url,
      distinguish ? hitDistinguisher(hit) : undefined,
    ),
    title: check.title,
    severity: hit.severity ?? check.severity,
    category: check.category,
    description: check.description,
    evidence: hit.evidence,
    riskImpact: check.riskImpact,
    explanation: check.explanation,
    fixSteps: check.fixSteps,
    codeExamples: check.codeExamples,
    references: check.references ?? [],
    confidence,
    detectionMethod: check.method,
    evidenceExcerpts: hit.excerpts,
  };
}

/**
 * The categories that genuinely have synchronous work to do for the given
 * filter: at least one legacy detector or one `PageCheck` registered
 * against them. `dns`, `tls` and `email` are declared `Category` values but
 * carry zero synchronous checks (they are dispatched from the async layer
 * instead, see async-checks.ts), so they never appear here — reporting
 * progress for a category that does nothing would not be "what genuinely
 * just happened."
 *
 * Exported so a caller (the scan route) can size a progress denominator
 * before calling `runSyncChecks`, using the exact same set `runSyncChecks`
 * will iterate — one source of truth for "what will actually run."
 */
export function getPlannedSyncCategories(
  categories?: Category[] | null,
): Category[] {
  const allowedCategories =
    categories && categories.length > 0 ? new Set(categories) : null;
  const candidateCategories = allowedCategories
    ? ALL_CATEGORIES.filter((c) => allowedCategories.has(c))
    : ALL_CATEGORIES;
  const applicablePageChecks = allowedCategories
    ? pageChecks.filter((c) => allowedCategories.has(c.category))
    : pageChecks;

  return candidateCategories.filter((category) => {
    if (getChecksByCategory([category]).length > 0) return true;
    return applicablePageChecks.some((c) => c.category === category);
  });
}

/**
 * Run every synchronous check, the legacy detector map plus the
 * `PageCheck` set, against a single response.
 *
 * `body` should already be capped by the caller; this function does not
 * enforce a size limit itself.
 *
 * `onProgress`, when given, is called once per category as it starts and
 * again when it finishes, in the same order `getPlannedSyncCategories`
 * reports. It is not wrapped in the per-check try/catch below: a hook that
 * throws (for example to signal the scan was cancelled) aborts the rest of
 * this function and propagates to the caller, which is deliberate.
 */
export function runSyncChecks(
  url: string,
  headers: Headers,
  body: string,
  categories?: Category[] | null,
  onProgress?: ScanProgressHook,
): SyncCheckResult {
  const allowedCategories =
    categories && categories.length > 0 ? new Set(categories) : null;
  const applicablePageChecks = allowedCategories
    ? pageChecks.filter((c) => allowedCategories.has(c.category))
    : pageChecks;
  const iterCategories = getPlannedSyncCategories(categories);

  // Only built when at least one PageCheck will actually run, same as
  // before this function grouped its work by category.
  const ctx =
    applicablePageChecks.length > 0
      ? buildPageContext(url, headers, body)
      : null;

  const findings: Vulnerability[] = [];
  let legacyRun = 0;
  let checksSkipped = 0;

  for (const category of iterCategories) {
    const catLegacyChecks = getChecksByCategory([category]);
    const catPageChecks = applicablePageChecks.filter(
      (c) => c.category === category,
    );

    onProgress?.(category, "start");

    for (const check of catLegacyChecks) {
      try {
        const result = check(url, headers, body);
        if (result) findings.push(result);
      } catch {
        // One bad detector must not take the scan down with it.
      }
    }
    legacyRun += catLegacyChecks.length;

    for (const check of catPageChecks) {
      // ctx is guaranteed non-null here: catPageChecks is only non-empty
      // when applicablePageChecks is, which is exactly the condition that
      // built ctx above.
      if (!requirementsMet(check, ctx!)) {
        checksSkipped++;
        continue;
      }
      try {
        const result = check.run(ctx!);
        if (!result) continue;
        const hits = Array.isArray(result) ? result : [result];
        // Only fold a per-hit distinguisher into the id when this check
        // actually produced more than one hit this run: a check that only
        // ever returns one hit (the overwhelming majority) keeps producing
        // the exact id it always has, so existing scan_finding_feedback
        // rows and regression-alert baselines for those findings stay valid.
        const distinguish = hits.length > 1;
        for (const hit of hits)
          findings.push(hitToVulnerability(check, hit, url, distinguish));
      } catch {
        // Same guarantee as the legacy loop above.
      }
    }

    onProgress?.(category, "done");
  }

  const deduped = dedupeFindings(findings, pageCheckGroups);

  return {
    findings: deduped.findings,
    checksRun: legacyRun + applicablePageChecks.length - checksSkipped,
    checksSkipped,
    deduped: deduped.merged,
  };
}
