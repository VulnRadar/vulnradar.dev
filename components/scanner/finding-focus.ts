/**
 * Putting keyboard focus back on the finding that was opened.
 *
 * Opening a finding swaps the whole list for IssueDetail, which unmounts the
 * row that was activated, and Back swaps the list in again from scratch.
 * ResultsList already restores the scroll position across that, but focus went
 * to <body> both times, so a keyboard user who opened finding 30 of 50 and came
 * back Tabbed through every filter again to find their place.
 *
 * Module state, not component state, for the same reason as the scroll
 * position in results-list.tsx: it has to survive the unmount.
 */

let openedFindingId: string | null = null;
let justClosed = false;

/** The row the person just activated, called when they open it. */
export function rememberOpenedFinding(id: string): void {
  openedFindingId = id;
}

/**
 * IssueDetail calls this as it unmounts. The list that replaces it mounts in
 * the same commit, after this cleanup has run, so it can ask whether it is
 * coming back from a finding. The flag lapses on the next tick so that an
 * IssueDetail that unmounted because the person left the page does not leave a
 * claim on the next list that happens to mount, long afterwards.
 */
export function noteFindingClosed(): void {
  justClosed = true;
  setTimeout(() => {
    justClosed = false;
  }, 0);
}

/**
 * The finding this list should put focus back on, once: only when it is
 * mounting as the direct result of a finding closing.
 */
export function takeFindingToRefocus(): string | null {
  const id = justClosed ? openedFindingId : null;
  justClosed = false;
  openedFindingId = null;
  return id;
}

/**
 * Focus the row for `id` under `root`. Matched by comparing the attribute
 * rather than building a selector from it, since a finding id is whatever the
 * check author wrote. Returns whether a row was there to focus: a filter the
 * person changed in the meantime can legitimately have hidden it.
 */
export function focusFindingRow(root: ParentNode, id: string): boolean {
  for (const row of root.querySelectorAll<HTMLElement>("[data-finding-id]")) {
    if (row.dataset.findingId === id) {
      row.focus();
      return true;
    }
  }
  return false;
}
