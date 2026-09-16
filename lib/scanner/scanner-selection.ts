/**
 * The `scanners` filter a scan request may carry, validated once for every
 * route that accepts one.
 *
 * Each scan route used to take the array as given. A name that matches
 * nothing, a typo in a CLI flag or a CI template, selects no category, so the
 * scan ran zero checks and came back with zero findings: a result that reads
 * as clean for a site nothing looked at. Unknown names are now refused with
 * the list of names that exist.
 */

import { ALL_CATEGORIES } from "./types";
import {
  ACTIVE_PROBES_CATEGORY,
  isActiveProbeSelector,
} from "./active-probe-catalog";

/** More than every category and probe selector combined, so a real request
 *  never reaches it; it only bounds a hostile one. */
const MAX_SCANNERS = 64;

export type ScannerSelection =
  { ok: true; scanners: string[] | null } | { ok: false; error: string };

function isKnownScanner(name: string): boolean {
  return (
    (ALL_CATEGORIES as readonly string[]).includes(name) ||
    isActiveProbeSelector(name)
  );
}

/**
 * `null` means "every default category", which is what an omitted or empty
 * filter has always meant. Anything else must be an array of known names.
 */
export function parseScannerSelection(value: unknown): ScannerSelection {
  if (value === undefined || value === null)
    return { ok: true, scanners: null };
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: "scanners must be an array of scanner names.",
    };
  }
  if (value.length === 0) return { ok: true, scanners: null };
  if (value.length > MAX_SCANNERS) {
    return {
      ok: false,
      error: `scanners can list at most ${MAX_SCANNERS} names.`,
    };
  }
  const unknown = value.filter(
    (v) => typeof v !== "string" || !isKnownScanner(v),
  );
  if (unknown.length > 0) {
    const shown = unknown
      .slice(0, 5)
      .map((v) => (typeof v === "string" ? `"${v.slice(0, 40)}"` : typeof v))
      .join(", ");
    return {
      ok: false,
      error: `Unknown scanner name${unknown.length === 1 ? "" : "s"}: ${shown}. Valid names are ${ALL_CATEGORIES.join(", ")}, ${ACTIVE_PROBES_CATEGORY}, and ${ACTIVE_PROBES_CATEGORY}:<probe>.`,
    };
  }
  return { ok: true, scanners: [...new Set(value as string[])] };
}
