/**
 * What a URL change should do to the scan open on the history page.
 *
 * app/history/page.tsx listens for LOCATION_CHANGE_EVENT, and that event is
 * deliberately a catch-all: lib/ui/url-state.ts patches history.pushState and
 * history.replaceState so EVERY URL write in the app emits it, ours included.
 * The handler behind it used to reload the open scan on every one of those
 * events, which meant every control that writes a query param reloaded the
 * report. The findings list writes ?sev, ?cat, ?sort, ?group and ?q
 * (components/scanner/results-list.tsx) and pushes ?finding= when a finding is
 * opened, so toggling "Most severe first" ran setDetailLoading(true) plus
 * setScanDetail(null) and refetched: a fully loaded report blanked behind
 * HistoryDetailSkeleton, the list remounted (losing search focus and the
 * scroll position), and all of it for a sort that is pure client-side work
 * over findings already in memory.
 *
 * The fix is to diff what the page actually cares about, which is ?scan=, and
 * to compare it against the scan already loaded rather than only against the
 * previous URL. Split out as plain .ts so the decision is unit-testable with
 * no DOM, the same split as history-filter-utils.ts.
 */

export interface ScanParamState {
  /** ?scan= as the URL reads right now. null means the list view. */
  nextScanId: string | null;
  /**
   * The id this handler last saw. `undefined` before its first run, so the
   * initial mount (which may be restoring a deep link like
   * ?scan=abc&finding=missing-csp-header) is never mistaken for a "switched
   * scans" transition and does not wipe the finding it was asked to restore.
   */
  prevScanId: string | null | undefined;
  /**
   * The id whose detail is on screen or in flight, null when none is. This is
   * the value that makes the check hold up under re-entrancy: removing
   * ?finding= writes to history, which re-enters the handler synchronously.
   */
  loadedScanId: string | null;
}

export interface ScanParamTransition {
  /** Fetch the detail for nextScanId. */
  load: boolean;
  /** Drop the selected finding and its ?finding= param. */
  clearFinding: boolean;
}

export function resolveScanParamChange({
  nextScanId,
  prevScanId,
  loadedScanId,
}: ScanParamState): ScanParamTransition {
  return {
    // Load only when the report on screen is not already the one the URL is
    // asking for. Any other param moving is somebody else's business, and a
    // repeat of the same id (a row click that also pushes ?scan=, the
    // re-entrant pass after ?finding= is cleared) is already handled.
    load: nextScanId !== null && loadedScanId !== nextScanId,
    // A different scan, or going back to the list, invalidates whatever
    // finding was selected under the previous scan: its findings array is
    // unrelated and check ids repeat across scans, so leaving the param
    // around risks re-selecting an unrelated finding with the same id.
    clearFinding: prevScanId !== undefined && prevScanId !== nextScanId,
  };
}

export interface ScanParamTracker {
  /** Resolve one URL change and record the id it moved to. */
  next(nextScanId: string | null): ScanParamTransition;
  /**
   * Record the scan now loading or loaded, so a later URL change naming it
   * asks for no second fetch. Called wherever a load starts, including the
   * ones that do not come from a URL change at all (clicking a history row,
   * the Retry button), and with null when the detail is torn down.
   */
  claim(scanId: string | null): void;
}

/**
 * Holds the two values resolveScanParamChange needs across calls. It lives
 * here rather than in a pair of refs inside the page so the whole sequence
 * (mount, open a scan, filter it, open a finding, switch scans) is exercised
 * by tests/components/history/scan-param-sync.test.ts, which is where a
 * regression would show up: the decision above is only as good as the two
 * values handed to it.
 */
export function createScanParamTracker(): ScanParamTracker {
  let prevScanId: string | null | undefined = undefined;
  let loadedScanId: string | null = null;

  return {
    next(nextScanId) {
      const transition = resolveScanParamChange({
        nextScanId,
        prevScanId,
        loadedScanId,
      });
      prevScanId = nextScanId;
      return transition;
    },
    claim(scanId) {
      loadedScanId = scanId;
    },
  };
}
