/**
 * Share-link expiry helpers, split out of share-modal.tsx the same way
 * ai-review-gate.ts is split out of the actions menu: the test runner is
 * configured for plain .ts and cannot transform a .tsx, so anything worth
 * asserting has to live outside the component file.
 */

/** Matches ALLOWED_EXPIRY_DAYS in app/api/v3/history/[id]/share/route.ts.
 *  The route rejects anything else, so the modal offers presets rather than a
 *  date picker: these are the only values the API will take, and they are the
 *  ones people actually want. `null` means the link never expires. */
export const EXPIRY_PRESETS: { days: number | null; label: string }[] = [
  { days: null, label: "Never" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const DAY_MS = 86_400_000;

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
 */
export function activePreset(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  const days = ms / DAY_MS;
  const timed = [7, 30, 90];
  return timed.reduce((best, d) =>
    Math.abs(d - days) < Math.abs(best - days) ? d : best,
  );
}
