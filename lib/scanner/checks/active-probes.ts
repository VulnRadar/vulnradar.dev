/**
 * Active-probing checks placeholder.
 *
 * The reflected-input probe runs from lib/scanner/active-probe-check.ts
 * (invoked via lib/scanner/async-checks.ts) because it submits real HTTP
 * requests carrying a canary value, not something a synchronous
 * (url, headers, body) detector can do against an already-fetched
 * response. The JSON entry in checks-data/active-probes.json documents
 * what that probe checks for; the inline detector below is a placeholder
 * so the registry's coverage test can map the JSON id to a known name.
 *
 * NOTE: this module is NOT registered in registry.ts BUNDLES -- active
 * probing is async-only, and unlike every other async-only category it is
 * also opt-in only: see buildBranches in async-checks.ts, which never
 * includes this branch under an omitted/empty `scanners` filter.
 */

import type { EvidenceFn as DetectFn } from "../_helpers";

export const detectors: Record<string, DetectFn> = {
  "reflected-input-xss": () => null,
  "sql-injection-error-based": () => null,
  "server-side-template-injection": () => null,
};
