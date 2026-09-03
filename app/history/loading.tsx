"use client";

import { getQueryParam, useQuerySeededState } from "@/lib/ui/url-state";
import {
  HistorySkeleton,
  HistoryDetailRouteSkeleton,
} from "@/components/history";

/**
 * /history is two pages behind one URL: the scan list, and one scan's report
 * at ?scan=<id>. A route fallback gets no params, so this one drew the list
 * every time and a reader opening a scan saw the list placeholder, then the
 * page mount and draw the detail placeholder over it. Two shapes for one
 * navigation, which is the structural half of the double-skeleton bug.
 *
 * useQuerySeededState is the same pre-paint correction HistoryPage itself uses
 * to pick its branch: the first render is the list, matching what the server
 * renders with no window to read, and a layout effect swaps in the detail
 * shape after the DOM is built and before the browser paints. So hydration
 * still sees identical trees and only the right shape is ever visible.
 */
export default function Loading() {
  const [isDetail] = useQuerySeededState(
    () => getQueryParam("scan") !== null,
    false,
  );

  return isDetail ? <HistoryDetailRouteSkeleton /> : <HistorySkeleton />;
}
