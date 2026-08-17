/**
 * Active-probing checks placeholder.
 *
 * Every active probe runs from lib/scanner/active-probes/ (invoked via
 * lib/scanner/async-checks.ts) because each submits real HTTP requests
 * carrying a canary value, not something a synchronous (url, headers, body)
 * detector can do against an already-fetched response. The corresponding
 * entry in checks-data/active-probes.json documents what each probe checks
 * for; the inline detectors below are placeholders so the registry's
 * coverage test can map every JSON id to a known name (see
 * ASYNC_ONLY_CATEGORIES in tests/lib/scanner/registry.test.ts, which
 * currently skips this category before ever reading these -- kept in sync
 * anyway as documentation of intent, and in case that test ever tightens).
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
  "os-command-injection": () => null,
  "confirmed-open-redirect": () => null,
};
