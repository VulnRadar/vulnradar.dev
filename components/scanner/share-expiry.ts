/**
 * Share-link expiry helpers, split out of share-modal.tsx the same way
 * ai-review-gate.ts is split out of the actions menu: the test runner is
 * configured for plain .ts and cannot transform a .tsx, so anything worth
 * asserting has to live outside the component file.
 */

/** Matches ALLOWED_EXPIRY_DAYS in app/api/v3/history/[id]/share/route.ts.
 *  The route rejects anything else, so the modal offers presets rather than a
 *  date picker: these are the only values the API will take, and they are the
 *  ones people actually want. `null` means the link never expires.
 *
 *  Order: shortest to longest, with "never" at the far end. It used to be
 *  first. Two reasons it moved. The other three read as a scale, and "never"
 *  is that scale's unbounded end, not something outside it: a list that goes
 *  never / 7 / 30 / 90 asks the reader to re-sort it in their head. And the
 *  first slot in a radiogroup is the one hit by reflex and the one keyboard
 *  focus lands on, which is a poor place to put "this link to a security
 *  report never stops working". Nothing about the default changes: a share is
 *  still created with no expiry, and the control still lights up whatever the
 *  link actually carries. */
export const EXPIRY_PRESETS: { days: number | null; label: string }[] = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: null, label: "Never" },
];

const DAY_MS = 86_400_000;

/** The longest window the route will issue. A stored expiry further out than
 *  this came from somewhere other than this UI, so no preset describes it. */
const LONGEST_PRESET_DAYS = 90;

/** Slack above LONGEST_PRESET_DAYS, for the moments between the server
 *  resolving `now + 90 days` and the browser reading it back against its own
 *  clock. Half a day absorbs that and ordinary clock skew without letting a
 *  genuinely longer expiry claim the 90-day preset. */
const CLOCK_SKEW_GRACE_DAYS = 0.5;

/** Human date for the "stops working on ..." line. */
export function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Which preset to light up for a stored expiry. The API only stores the
 * resolved timestamp, so the original choice is not recoverable: this reports
 * the preset closest to what is actually LEFT, which is exact right after a
 * click and stays honest as the link ages. The precise date is printed
 * underneath it either way.
 *
 * It returns null rather than a nearest guess in the two cases where no
 * preset honestly describes the link, and that is a fix, not a nicety. This
 * used to reduce over [7, 30, 90] unconditionally, so EVERY non-null
 * timestamp lit one of them up:
 *
 *  - An already-expired link resolved to 7 (negative remaining time is
 *    nearest the smallest preset). The modal drew "7 days" as the selected
 *    radio next to copy reading "this link stopped working, pick a new
 *    window", and the modal skipped the change handler for the selected
 *    radio, so the one button a reader would press to reissue the link was
 *    inert. The rest still worked, but the obvious action did nothing.
 *  - An expiry further out than 90 days (a legacy row, or a direct database
 *    write; the route itself will not issue one) claimed the 90-day preset,
 *    which is simply not what the link says.
 *
 * Nothing claims a preset in either case now, so every button is live and
 * the date printed under the control is the only claim being made.
 */
export function activePreset(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  const days = ms / DAY_MS;
  if (days <= 0) return null;
  if (days > LONGEST_PRESET_DAYS + CLOCK_SKEW_GRACE_DAYS) return null;
  const timed = [7, 30, 90];
  return timed.reduce((best, d) =>
    Math.abs(d - days) < Math.abs(best - days) ? d : best,
  );
}
