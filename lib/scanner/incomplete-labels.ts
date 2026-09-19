/**
 * Plain-language names for the areas `ScanResult.incomplete` lists.
 *
 * The contract for that field (lib/scanner/types.ts) is that a listed area
 * means "not checked", never "checked and clean", so every surface that shows
 * a result has to be able to say which areas those were. The map used to be a
 * local const inside components/scanner/scan-result-detail.tsx, which is the
 * one place it rendered: the summary above it knew a scan was partial but had
 * no way to name the areas, so when a scan found something AND missed an area
 * the reader was told "some checks ran out of time" and never which. The
 * comment there even said the areas were named below, which was true only on
 * the no-findings path, since the empty state that named them does not render
 * when there are findings.
 *
 * Keys are the labels the engine emits: one per async branch
 * (`getPlannedAsyncBranches`), plus `page-checks` from engine.ts and
 * `authenticated-session` from POST /api/v3/scan/authenticated.
 * tests/lib/scanner/incomplete-labels.test.ts holds this list to the engine's,
 * so a new branch cannot ship with a raw slug as its user-facing name.
 */
export const INCOMPLETE_LABELS: Record<string, string> = {
  dns: "DNS records",
  tls: "TLS and certificate checks",
  "live-fetch": "Live page fetch",
  reputation: "Domain reputation lookups",
  // Thrown by osv-check.ts when OSV.dev answered none of the lookups.
  "osv-libraries": "The live vulnerable-library lookup",
  "active-probes": "Active probes",
  // Written by POST /api/v3/scan/authenticated when the login held long
  // enough to start but the session was lost during the run: the pages that
  // came back are the signed-out surface, so the authenticated area the user
  // asked about is unchecked rather than clean.
  "authenticated-session": "The signed-in view of this page",
  // A page check threw instead of reaching a verdict (engine.ts records which
  // in result_meta.erroredChecks for operators).
  "page-checks": "Some page checks",
  // The site answered with a bot challenge instead of its page
  // (lib/scanner/bot-challenge.ts), so everything read from the page, its
  // headers and the files beside it was skipped.
  "bot-challenge":
    "The page, its headers and its files: the site showed the scanner a bot challenge instead",
};

/**
 * The areas to show a reader, in the order the engine reported them.
 *
 * An unrecognised key passes through as itself rather than being dropped: a
 * slug in the UI is ugly, and a silently shorter list is a scan that looks
 * more complete than it was.
 */
export function describeIncompleteAreas(
  areas: readonly string[] | undefined,
): string[] {
  return (areas ?? []).map((area) => INCOMPLETE_LABELS[area] ?? area);
}
