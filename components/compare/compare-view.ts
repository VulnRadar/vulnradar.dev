/**
 * Which part of /compare is on screen, and what a URL change does to it.
 *
 * Both used to be written inline in app/compare/page.tsx as conjunctions of
 * four pieces of state, and the conjunctions had a hole in them. The three
 * content regions were gated on `!selectedHost`, `selectedHost && selectedGroup`
 * and `diffResult`. Open a saved comparison whose scan has since been deleted:
 * the diff request 404s, the page backfills `selectedHost` from the scan that
 * survived, and if that host is left with fewer than two scans it has no entry
 * in the host groups, so `selectedGroup` is null. Host set, group null, no
 * diff: none of the three regions matched, and the reader got an error alert
 * over an empty page with no picker, no "Change host" and nothing to click.
 * Clicking Compare in the nav did not help either, because the URL handler
 * cleared a and b but left the host and the error where they were.
 *
 * Split out as plain .ts so the decision is unit-testable with no DOM, the
 * same split as components/history/scan-param-sync.ts.
 */

export type CompareRegion = "skeleton" | "hosts" | "scans" | "diff";

export interface CompareRegionInput {
  /** A page entered on ?a=&b= that has not settled its first comparison. */
  deepLinkPending: boolean;
  hasDiff: boolean;
  /**
   * The chosen host has a group with two or more scans to pick from. Not
   * "a host is chosen": a host can be set without a group behind it, and that
   * is the state the old gating fell through.
   */
  hasGroup: boolean;
}

/**
 * Exactly one region, always. The host picker is the fallback, so a state the
 * rest of the page cannot render still lands somewhere the reader can act.
 */
export function resolveCompareRegion({
  deepLinkPending,
  hasDiff,
  hasGroup,
}: CompareRegionInput): CompareRegion {
  if (deepLinkPending) return "skeleton";
  if (hasDiff) return "diff";
  return hasGroup ? "scans" : "hosts";
}

export interface CompareUrlInput {
  a: string | null;
  b: string | null;
  /** Whether the URL this handler last saw carried both a and b. */
  pairWasInUrl: boolean;
}

export interface CompareUrlChange {
  /** The comparison to run, or null when the URL does not name two scans. */
  run: { a: string; b: string } | null;
  /** Drop the diff and the error that belonged to the comparison. */
  clearResult: boolean;
  /** Send the page back to the host picker. */
  resetHost: boolean;
}

/**
 * The handler behind LOCATION_CHANGE_EVENT, which is a catch-all: every URL
 * write on the page re-enters it, the page's own pickers included.
 *
 * The host is therefore reset only on the one transition no picker produces
 * on its own, a full pair leaving the URL at once: the Compare nav link,
 * back/forward off a saved comparison, or the reset and change-host buttons
 * (which clear it anyway). Resetting whenever a or b is missing would undo the
 * reader's own picks. Choosing the first scan of a host writes ?a= with no b,
 * and deselecting the only scan writes both as null, and neither of those
 * means "start over".
 */
export function resolveCompareUrlChange({
  a,
  b,
  pairWasInUrl,
}: CompareUrlInput): CompareUrlChange {
  if (a !== null && b !== null) {
    return { run: { a, b }, clearResult: false, resetHost: false };
  }
  return {
    run: null,
    clearResult: true,
    resetHost: pairWasInUrl && a === null && b === null,
  };
}
