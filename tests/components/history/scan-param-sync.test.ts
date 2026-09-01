import { describe, it, expect } from "vitest";
import {
  createScanParamTracker,
  resolveScanParamChange,
} from "@/components/history/scan-param-sync";

/**
 * Regression suite for the skeleton flash on the history detail view.
 *
 * app/history/page.tsx subscribes to LOCATION_CHANGE_EVENT, which
 * lib/ui/url-state.ts emits for EVERY history.pushState/replaceState in the
 * app. It used to call loadScanDetail() on all of them, so toggling "Most
 * severe first" in the findings list (which writes ?sort=asc through
 * history.replaceState) ran setDetailLoading(true) + setScanDetail(null) and
 * refetched the whole scan: the report vanished behind HistoryDetailSkeleton
 * and the list remounted, for a sort over findings already in memory.
 *
 * The rule these cases pin: the detail reloads only when the URL asks for a
 * DIFFERENT scan than the one already loaded or in flight. Everything else on
 * the query string is somebody else's business.
 */

const SCAN = "sc_abc123";
const OTHER_SCAN = "sc_def456";

/** How the page reads ?scan= out of a URL (getQueryParam, minus the window). */
function scanOf(url: string): string | null {
  const value = new URLSearchParams(url.split("?")[1] ?? "").get("scan");
  return value === null || value === "" ? null : value;
}

/** One URL change, resolved the way handleQueryChange resolves it. */
function transitionBetween(
  prevUrl: string,
  nextUrl: string,
  loadedScanId: string | null,
) {
  return resolveScanParamChange({
    nextScanId: scanOf(nextUrl),
    prevScanId: scanOf(prevUrl),
    loadedScanId,
  });
}

describe("resolveScanParamChange", () => {
  describe("a findings-list control writes its param while a scan is open", () => {
    // Every param components/scanner/results-list.tsx writes, as the URL
    // actually looks before and after the control is used. None of them moves
    // ?scan=, so none may reload the report or reset the loading flag.
    const FILTER_WRITES: [label: string, from: string, to: string][] = [
      [
        "sort (most severe / least severe)",
        `/history?scan=${SCAN}`,
        `/history?scan=${SCAN}&sort=asc`,
      ],
      [
        "sort toggled back off",
        `/history?scan=${SCAN}&sort=asc`,
        `/history?scan=${SCAN}`,
      ],
      [
        "severity filter",
        `/history?scan=${SCAN}`,
        `/history?scan=${SCAN}&sev=critical,high`,
      ],
      [
        "category filter",
        `/history?scan=${SCAN}`,
        `/history?scan=${SCAN}&cat=headers`,
      ],
      [
        "group by severity",
        `/history?scan=${SCAN}`,
        `/history?scan=${SCAN}&group=flat`,
      ],
      [
        "search box (debounced write)",
        `/history?scan=${SCAN}`,
        `/history?scan=${SCAN}&q=csp`,
      ],
      [
        "opening a finding",
        `/history?scan=${SCAN}`,
        `/history?scan=${SCAN}&finding=missing-csp-header`,
      ],
      [
        "several filters already on, one more added",
        `/history?scan=${SCAN}&sev=critical&q=csp`,
        `/history?scan=${SCAN}&sev=critical&q=csp&sort=asc`,
      ],
    ];

    for (const [label, from, to] of FILTER_WRITES) {
      it(`${label}: no reload, no finding reset`, () => {
        expect(transitionBetween(from, to, SCAN)).toEqual({
          load: false,
          clearFinding: false,
        });
      });
    }
  });

  describe("first run", () => {
    it("loads a deep-linked scan", () => {
      expect(
        resolveScanParamChange({
          nextScanId: SCAN,
          prevScanId: undefined,
          loadedScanId: null,
        }),
      ).toEqual({ load: true, clearFinding: false });
    });

    it("keeps a deep-linked ?finding= rather than reading the mount as a scan switch", () => {
      // prevScanId is undefined only before the handler's first run. Reading
      // that as "the scan changed" would strip the ?finding= the deep link
      // exists to restore, before results-list.tsx ever got to select it.
      const { clearFinding } = resolveScanParamChange({
        nextScanId: SCAN,
        prevScanId: undefined,
        loadedScanId: null,
      });
      expect(clearFinding).toBe(false);
    });

    it("does nothing on the list view", () => {
      expect(
        resolveScanParamChange({
          nextScanId: null,
          prevScanId: undefined,
          loadedScanId: null,
        }),
      ).toEqual({ load: false, clearFinding: false });
    });
  });

  describe("the scan itself changes", () => {
    it("loads the new scan and drops the old finding", () => {
      expect(
        transitionBetween(
          `/history?scan=${SCAN}&finding=missing-csp-header`,
          `/history?scan=${OTHER_SCAN}`,
          SCAN,
        ),
      ).toEqual({ load: true, clearFinding: true });
    });

    it("clears the finding but starts no load when collapsing back to the list", () => {
      expect(
        transitionBetween(`/history?scan=${SCAN}`, "/history", SCAN),
      ).toEqual({ load: false, clearFinding: true });
    });

    it("loads a scan opened from the list", () => {
      expect(
        transitionBetween("/history", `/history?scan=${SCAN}`, null),
      ).toEqual({ load: true, clearFinding: true });
    });

    it("reloads a scan that was closed and reopened", () => {
      // The page nulls loadedScanId when it collapses back to the list, so
      // Forward (or clicking the same row again) genuinely has to fetch.
      expect(
        transitionBetween("/history", `/history?scan=${SCAN}`, null).load,
      ).toBe(true);
    });
  });

  describe("a whole session through the tracker", () => {
    // The decision above is only as good as what is fed to it, and that
    // bookkeeping is what a future edit is most likely to get wrong. This
    // replays a real session against the tracker the page uses, counting the
    // loads: exactly one, at the point the scan is opened.
    it("loads once, then survives every filter the findings list writes", () => {
      const tracker = createScanParamTracker();
      const loads: string[] = [];
      // What app/history/page.tsx does with each transition, minus React.
      const urlChanged = (scanId: string | null) => {
        const transition = tracker.next(scanId);
        if (scanId !== null) {
          if (transition.load) {
            loads.push(scanId);
            tracker.claim(scanId);
          }
        } else {
          tracker.claim(null);
        }
        return transition;
      };

      // Mount on the list view.
      expect(urlChanged(null)).toEqual({ load: false, clearFinding: false });

      // Click a row: the page loads directly and then pushes ?scan=, which
      // fires a query-change AND a location-change event, so the handler runs
      // twice more for a scan already in flight.
      tracker.claim(SCAN);
      loads.push(SCAN);
      urlChanged(SCAN);
      urlChanged(SCAN);
      expect(loads).toEqual([SCAN]);

      // Sort, group, filter, search: this is the bug the suite exists for.
      urlChanged(SCAN); // ?sort=asc
      urlChanged(SCAN); // ?sort= removed again
      urlChanged(SCAN); // ?group=flat
      urlChanged(SCAN); // ?sev=critical,high
      urlChanged(SCAN); // ?cat=headers
      urlChanged(SCAN); // ?q=csp
      expect(loads).toEqual([SCAN]);

      // Open a finding, then go back to the list of findings.
      urlChanged(SCAN); // ?finding= pushed
      urlChanged(SCAN); // ?finding= removed
      expect(loads).toEqual([SCAN]);

      // Switching scans is the one thing that must fetch.
      const switched = urlChanged(OTHER_SCAN);
      expect(switched).toEqual({ load: true, clearFinding: true });
      expect(loads).toEqual([SCAN, OTHER_SCAN]);

      // Back to the list, then reopen the first scan: it was torn down, so it
      // loads again.
      urlChanged(null);
      expect(urlChanged(SCAN)).toEqual({ load: true, clearFinding: true });
      expect(loads).toEqual([SCAN, OTHER_SCAN, SCAN]);
    });

    it("keeps a deep-linked finding while loading the scan it belongs to", () => {
      const tracker = createScanParamTracker();
      // Mount straight onto /history?scan=X&finding=Y.
      const mount = tracker.next(SCAN);
      expect(mount).toEqual({ load: true, clearFinding: false });
      tracker.claim(SCAN);
      // results-list.tsx then selects the finding, which pushes the same
      // ?finding= value: still no reload, still no reset.
      expect(tracker.next(SCAN)).toEqual({ load: false, clearFinding: false });
    });
  });

  describe("re-entrancy", () => {
    it("starts no second load for a scan already in flight", () => {
      // Two things re-enter the handler with the same id: clicking a row
      // (loadScanDetail, then a ?scan= push that fires both a query-change and
      // a location-change event) and removing ?finding= during a scan switch.
      // loadedScanId is claimed before either can run, so both are no-ops.
      expect(
        resolveScanParamChange({
          nextScanId: SCAN,
          prevScanId: null,
          loadedScanId: SCAN,
        }).load,
      ).toBe(false);
    });

    it("clears the finding once, not on the pass that follows it", () => {
      const first = transitionBetween(
        `/history?scan=${SCAN}&finding=missing-csp-header`,
        `/history?scan=${OTHER_SCAN}&finding=missing-csp-header`,
        SCAN,
      );
      // The page writes prevScanIdRef before removing ?finding=, so the
      // re-entrant pass sees prevScanId === nextScanId and the recursion stops.
      const reentrant = transitionBetween(
        `/history?scan=${OTHER_SCAN}`,
        `/history?scan=${OTHER_SCAN}`,
        OTHER_SCAN,
      );
      expect(first.clearFinding).toBe(true);
      expect(reentrant).toEqual({ load: false, clearFinding: false });
    });
  });
});
