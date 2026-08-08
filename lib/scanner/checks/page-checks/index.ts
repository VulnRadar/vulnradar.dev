/**
 * Aggregates every check written against the `PageCheck` interface
 * (`lib/scanner/check-types.ts`). Adding a new detection under this
 * architecture means writing one `PageCheck` object and adding its module's
 * array to `pageChecks` below: no JSON file, no registry edit, no separate
 * detector map to keep in sync.
 */

import type { PageCheck } from "../../check-types";
import { cspChecks } from "./csp";
import { formChecks } from "./forms";
import { cookieChecks } from "./cookies";
import { scriptChecks } from "./scripts";
import { libraryChecks } from "./libraries";
import { leakedSecretChecks } from "./leaked-secrets";
import { mixedContentChecks } from "./mixed-content";
import { frameworkFingerprintChecks } from "./framework-fingerprint";
import { jwtChecks } from "./jwt";
import { linkChecks } from "./links";
import { disclosureChecks } from "./disclosure";

export const pageChecks: PageCheck[] = [
  ...cspChecks,
  ...formChecks,
  ...cookieChecks,
  ...scriptChecks,
  ...libraryChecks,
  ...leakedSecretChecks,
  ...mixedContentChecks,
  ...frameworkFingerprintChecks,
  ...jwtChecks,
  ...linkChecks,
  ...disclosureChecks,
];

// Fail fast in development if a copy-pasted check ever ships a duplicate ID:
// the legacy detector map's silent last-write-wins behaviour is exactly the
// defect this architecture exists to avoid repeating.
const seen = new Set<string>();
for (const check of pageChecks) {
  if (seen.has(check.id)) {
    throw new Error(`Duplicate PageCheck id: ${check.id}`);
  }
  seen.add(check.id);
}

/** `{ checkId -> dedupeGroup }` for every check that declared one. */
export const pageCheckGroups: Record<string, string> = Object.fromEntries(
  pageChecks
    .filter((c): c is PageCheck & { dedupeGroup: string } => !!c.dedupeGroup)
    .map((c) => [c.id, c.dedupeGroup]),
);
