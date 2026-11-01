import type { ActiveProbeId } from "@/lib/scanner/active-probe-catalog";
import { serializeActiveProbeIds } from "@/lib/scanner/active-probe-catalog";

export interface ScanFormQueryState {
  mode: string;
  familyIds: readonly string[];
  enabledFamilies: ReadonlySet<string>;
  selectedActiveProbes: ReadonlySet<ActiveProbeId>;
  captureScreenshot: boolean;
  portScan: boolean;
}

/**
 * Every query param the scan form mirrors its state into, as one object.
 *
 * It is handed to setQueryParams in a single call so a change costs at most
 * one history write: the old mirror made one call per family on top of the
 * main one, 18 replaceState calls per change and on mount, which is past
 * Safari's limit of 100 in 30 seconds after a handful of toggles. Defaults
 * are null so they leave the URL, except mode, which is always spelled out.
 */
export function buildScanFormQuery(
  state: ScanFormQueryState,
): Record<string, string | null> {
  const params: Record<string, string | null> = {
    mode: state.mode,
    active_probes: serializeActiveProbeIds(state.selectedActiveProbes),
    screenshot: state.captureScreenshot ? "1" : null,
    port_scan: state.portScan ? "1" : null,
  };
  for (const id of state.familyIds) {
    params[`family_${id}`] = state.enabledFamilies.has(id) ? null : "0";
  }
  return params;
}
