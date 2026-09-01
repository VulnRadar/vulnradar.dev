/**
 * Selection helpers for the findings list's bulk-remediation mode.
 *
 * Pulled out of results-list.tsx for the same reason ./finding-search was:
 * the repo has no DOM test environment, so the only way to cover a rule that
 * decides which findings a bulk write touches is to keep it as a pure
 * function.
 */

/**
 * Narrow a selection down to the findings currently visible under the active
 * filters.
 *
 * The bulk bar's "N selected" is a promise about what Apply will change, and
 * selection used to survive a filter change untouched: narrowing to Critical
 * left the High picks in the set, so the count included rows the reader could
 * no longer see and Apply wrote to them. Returns the original set when nothing
 * was dropped, so a caller can use it directly as a React state updater
 * without forcing a re-render on every filter keystroke.
 */
export function pruneSelectionToVisible(
  selected: ReadonlySet<string>,
  visibleIds: Iterable<string>,
): Set<string> {
  if (selected.size === 0) return selected as Set<string>;
  const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds);
  const next = new Set<string>();
  for (const id of selected) if (visible.has(id)) next.add(id);
  return next.size === selected.size ? (selected as Set<string>) : next;
}
