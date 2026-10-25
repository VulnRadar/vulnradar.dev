/**
 * Where keyboard focus goes when a row leaves the notification panel.
 *
 * Dismissing a notice removes the row that holds the focused button. The
 * browser answers by dropping focus on <body>, outside the open popover, so a
 * keyboard user who tidies the panel loses their place after every row. The
 * panel instead hands focus to whatever now sits where the removed row was,
 * and to its own heading once the list is empty.
 *
 * The dismiss button of the next row rather than its first action, on purpose:
 * for a team invite the first action is "Accept invite", and landing a reader
 * who just pressed Enter on a dismiss control on a button that joins a team is
 * the wrong failure. A dismiss lands on a dismiss, which also keeps "clear the
 * list" a repeatable keystroke.
 *
 * Kept free of React and of the document so the choice can be tested without a
 * DOM; the panel does the querying and passes the rows in.
 */

export interface FocusTarget {
  focus(): void;
}

export interface FocusRow {
  querySelector(selector: string): FocusTarget | null;
}

/** Marks the control that dismisses its row. */
export const DISMISS_SELECTOR = "[data-notif-dismiss]";

/** The fallback for a row with nothing to dismiss: its first action. */
const ACTION_SELECTOR = "a[href], button:not(:disabled)";

/**
 * Which of the remaining rows takes over from the one at `removedIndex`: the
 * row that moved up into its place, or the new last row when the last one was
 * removed. `null` when nothing is left.
 */
export function focusIndexAfterRemoval(
  removedIndex: number,
  remaining: number,
): number | null {
  if (remaining <= 0) return null;
  return Math.min(Math.max(removedIndex, 0), remaining - 1);
}

/**
 * Moves focus after a row was removed. `rows` is what is left, in order.
 * Returns where it went, so the caller (and the test) can tell a row from the
 * heading from nowhere.
 */
export function focusAfterRemoval(
  rows: readonly FocusRow[],
  removedIndex: number,
  heading: FocusTarget | null,
): "row" | "heading" | "none" {
  const index = focusIndexAfterRemoval(removedIndex, rows.length);
  if (index !== null) {
    const row = rows[index];
    const target =
      row.querySelector(DISMISS_SELECTOR) ?? row.querySelector(ACTION_SELECTOR);
    if (target) {
      target.focus();
      return "row";
    }
  }
  if (heading) {
    heading.focus();
    return "heading";
  }
  return "none";
}
