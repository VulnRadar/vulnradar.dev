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
  /**
   * Checks that threw. They reached no conclusion, so they are excluded from
   * `checksRun` rather than counted as clean, and each one's id is logged (see
   * the catch blocks in `runSyncChecks`). Previously both catch blocks were
   * bare `catch {}` with no logging and no counter, so a detector that started
   * throwing, on a null field, a new HTML shape, a changed third-party
   * response, silently stopped producing findings while the user was still
   * shown the full checks-run count and a clean result. With 310+ checks that
   * could stay broken across releases with no signal to anyone.
   * ref: AUDIT-012#obs-01
   */
  checksErrored: number;
  /**
   * The ids of those checks. The count alone told an operator that something
   * broke and not what, and the console line that named it is gone by the
   * time anyone looks at the scan.
   */
  erroredChecks: string[];
  /** Findings folded into another finding as duplicates of the same issue. */
  deduped: number;
}

/**
 * The `ScanResult.incomplete` key for a scan in which at least one page check
 * threw. Such a check reached no conclusion, so its area was not checked, and
 * a zero-finding result must not read as clean because of it: every result
 * surface already says so for anything listed in `incomplete`.
 */
export const PAGE_CHECKS_INCOMPLETE = "page-checks";

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
  fetchedUrl?: string,
): SyncCheckResult {
  const pass = checkPasses(
    url,
    headers,
    body,
    categories,
    onProgress,
    fetchedUrl,
  );
  let step = pass.next();
  while (!step.done) step = pass.next();
  return step.value;
}

/** One macrotask, so pending I/O callbacks actually get to run. A microtask
 *  (`await Promise.resolve()`) would not: it drains before the event loop
 *  reaches the poll phase, so it yields to nothing that matters here. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof setImmediate === "function") setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

/**
 * The same work as `runSyncChecks`, with the event loop released as it goes.
 *
 * Measured on this check set (1MB body, the cap execute-scan.ts applies):
 * `runSyncChecks` blocks for ~1.2s straight, ~355ms at 250KB, ~63ms at 50KB.
 * In a single persistent Node process that is 1.2 seconds during which every
 * other in-flight scan, every status poll and every unrelated request is
 * stalled, because none of it is waiting on I/O: it is one uninterrupted
 * synchronous block. Driven this way the same work takes the same total time
 * (~1.05s measured, the macrotask hops are a rounding error) but the longest
 * uninterrupted block drops to ~200ms.
 *
 * That ~200ms floor is `buildPageContext`, the one-shot HTML parse below: no
 * individual check comes close (the slowest legacy detector measured 30ms,
 * the slowest PageCheck 13ms). Splitting it further would mean an incremental
 * parser, which is a different piece of work.
 *
 * `runSyncChecks` stays exported, but nothing in the request path calls it any
 * more. This used to say it was kept for "the bulk and authenticated scan
 * routes", on the grounds that the extra await "would change their control
 * flow for no benefit (they already run one page at a time)". Both halves of
 * that were wrong by the end. Bulk scans go through execute-bulk-scan.ts into
 * executeScan(), which yields; and running one page at a time is a fact about
 * the caller, while the cost of blocking is paid by every other scan and
 * status poll sharing the process - which is what the paragraph above this one
 * measures. The authenticated route now yields too.
 *
 * What it is still for is the test suite, which drives the check loop
 * synchronously in four files and has no reason not to. Both variants share
 * the generator below, so there is one implementation of the loop either way.
 * ref: AUDIT-011#scan-06
 */
export async function runSyncChecksYielding(
  url: string,
  headers: Headers,
  body: string,
  categories?: Category[] | null,
  onProgress?: ScanProgressHook,
  fetchedUrl?: string,
): Promise<SyncCheckResult> {
  const pass = checkPasses(
    url,
    headers,
    body,
    categories,
    onProgress,
    fetchedUrl,
  );
  let step = pass.next();
  while (!step.done) {
    await yieldToEventLoop();
    step = pass.next();
  }
  return step.value;
}

/**
 * The check loop itself, with `yield` at every point where it is safe to let
 * the process do something else, so a caller can decide whether to run it
 * straight through or to release the event loop at each one. Not exported:
 * `runSyncChecks` and `runSyncChecksYielding` above are the two supported
 * ways to drive it.
 */
function* checkPasses(
  url: string,
  headers: Headers,
  body: string,
  categories?: Category[] | null,
  onProgress?: ScanProgressHook,
  /**
   * The URL the headers and body really came from, when the fetch followed a
   * redirect. Detectors judge THIS: `headers` belong to it, and a scheme-gated
   * check reading the requested URL instead got the protocol wrong. A scan
   * requested as http://example.com that redirects to https://example.com
   * was told it had no TLS at all (deprecated-tls, high) while HSTS on the
   * HTTPS response it actually inspected was never checked (hsts-missing
   * returns early for any non-https URL), and mixed-content and form-action
   * were skipped on a real HTTPS page.
   *
   * `url` stays the identity: finding ids are keyed on it, as are triage marks
   * and regression baselines, so a redirect never changes a finding's id.
   */
  fetchedUrl?: string,
): Generator<void, SyncCheckResult, void> {
  const detectUrl = fetchedUrl ?? url;
  const allowedCategories =
    categories && categories.length > 0 ? new Set(categories) : null;
  const applicablePageChecks = allowedCategories
    ? pageChecks.filter((c) => allowedCategories.has(c.category))
    : pageChecks;
  const iterCategories = getPlannedSyncCategories(categories);

  // Only built when at least one PageCheck will actually run, same as
  // before this function grouped its work by category.
  //
  // Yield first. This parse is the single longest uninterruptible span in the
  // whole pass (~200ms on a 1MB body, measured), so the process gets a turn
  // immediately before it rather than arriving at it mid-backlog.
  yield;
  const ctx =
    applicablePageChecks.length > 0
      ? buildPageContext(detectUrl, headers, body)
      : null;

  const findings: Vulnerability[] = [];
  let legacyRun = 0;
  let checksSkipped = 0;
  let checksErrored = 0;
  const erroredChecks: string[] = [];

  // Category boundaries alone are not fine-grained enough to bound the pause:
  // the categories are very unevenly sized, and the largest one on its own was
  // measured at 279ms of uninterrupted work on a 1MB body. Yielding every N
  // checks inside a category as well keeps the longest block short regardless
  // of how the checks are distributed. 20 is small enough to matter and large
  // enough that the macrotask hops stay a rounding error next to the checks
  // themselves. ref: AUDIT-011#scan-06
  const YIELD_EVERY_CHECKS = 20;
  let sinceYield = 0;

  for (const category of iterCategories) {
    const catLegacyChecks = getChecksByCategory([category]);
    const catPageChecks = applicablePageChecks.filter(
      (c) => c.category === category,
    );

    onProgress?.(category, "start");
    // Where this category's own findings begin, so the "done" event below can
    // report exactly what it turned up without the consumer having to diff
    // anything. ref: AUDIT-014#scanui-02
    const categoryFindingsFrom = findings.length;

    for (const check of catLegacyChecks) {
      try {
        const result = check(detectUrl, headers, body, url);
        if (result) findings.push(result);
      } catch (err) {
        // One bad detector must not take the scan down with it, but it must
        // not disappear either: a throwing check reached no conclusion, so it
        // is neither a finding nor evidence of a clean result.
        checksErrored++;
        erroredChecks.push(check.checkId ?? "unknown");
        console.error(
          `[scanner] check "${check.checkId ?? "unknown"}" threw and did not run:`,
          err,
        );
      }
      if (++sinceYield >= YIELD_EVERY_CHECKS) {
        sinceYield = 0;
        yield;
      }
    }
    legacyRun += catLegacyChecks.length;

    for (const check of catPageChecks) {
      // ctx is guaranteed non-null here: catPageChecks is only non-empty
      // when applicablePageChecks is, which is exactly the condition that
      // built ctx above.
      if (++sinceYield >= YIELD_EVERY_CHECKS) {
        sinceYield = 0;
        yield;
      }
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
      } catch (err) {
        // Same guarantee, and the same accounting, as the legacy loop above.
        checksErrored++;
        erroredChecks.push(check.id);
        console.error(
          `[scanner] check "${check.id}" threw and did not run:`,
          err,
        );
      }
    }

    // Built only when something is listening: an unused slice per category is
    // pure allocation on the path runSyncChecks drives with no hook at all.
    if (onProgress) {
      onProgress(category, "done", {
        newFindings: findings
          .slice(categoryFindingsFrom)
          .map((f) => ({ severity: f.severity, title: f.title })),
      });
    }

    // Yield point. runSyncChecks drives straight past it; the yielding
    // driver awaits a macrotask here so the process can serve other work
    // between categories. Placed after "done" so a progress consumer sees
    // the category completed before the pause, not after it.
    yield;
  }

  const deduped = dedupeFindings(findings, pageCheckGroups);

  return {
    findings: deduped.findings,
    // A check that threw is subtracted here. It was previously counted as
    // run, so the checksRun figure shown to the user was inflated by exactly
    // the number of broken detectors: the scan claimed to have checked things
    // it had not. ref: AUDIT-012#obs-01
    checksRun:
      legacyRun + applicablePageChecks.length - checksSkipped - checksErrored,
    checksSkipped,
    checksErrored,
    erroredChecks,
    deduped: deduped.merged,
  };
}
