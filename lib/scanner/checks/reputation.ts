/**
 * Threat-intelligence reputation checks placeholder.
 *
 * All reputation checks (Google Web Risk uris.search) run from
 * lib/scanner/async-checks.ts because they require an outbound HTTPS call to
 * a third-party API. The JSON entries in checks-data/reputation.json
 * document what that async probe checks for; the inline detectors below are
 * placeholders so the registry's coverage test can map every JSON id to a
 * known name.
 *
 * NOTE: this module is NOT registered in registry.ts BUNDLES — reputation
 * is async-only. Do not import these placeholders from the synchronous
 * scan orchestrator.
 */

import type { EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  "url-flagged-malware": () => null,
  "url-flagged-social-engineering": () => null,
  "url-flagged-unwanted-software": () => null,
};
