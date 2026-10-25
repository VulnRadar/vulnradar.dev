/**
 * What the dashboard does with ?scan=.
 *
 * It is overloaded. A URL/host-looking value is a target; anything else -- an
 * opaque history public_id (hex) or a legacy numeric id -- is a saved scan to
 * open in History. Hosts and URLs always carry a dot, slash, or scheme colon,
 * and neither an opaque public_id nor a numeric id ever does, so that cleanly
 * separates the two meanings.
 *
 * A target only ever prefills the form. Starting the scan is a separate
 * decision, and it needs the grant in lib/ui/scan-again.ts: a link from
 * another site must not be able to spend the visitor's scans.
 */

export function scanParamIsTarget(value: string): boolean {
  return /[./:]/.test(value);
}

/** The target ?scan= should drop into the form, if it names one. */
export function scanParamPrefill(scanParam: string | null): string | undefined {
  return scanParam && scanParamIsTarget(scanParam) ? scanParam : undefined;
}

/**
 * The target to start scanning right now, or null.
 *
 * Null for no param, for a saved scan's id, while a scan is already running
 * (a second would be refused for concurrency anyway, and the grant should not
 * be spent on it), and for a target nobody armed. `consume` is injected so
 * this stays testable without a browser; the page passes consumeScanAgain.
 */
export function scanParamToStart(
  scanParam: string | null,
  scanning: boolean,
  consume: (url: string) => boolean,
): string | null {
  if (!scanParam || !scanParamIsTarget(scanParam) || scanning) return null;
  return consume(scanParam) ? scanParam : null;
}
