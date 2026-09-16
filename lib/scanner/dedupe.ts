/**
 * Finding deduplication.
 *
 * One missing `integrity` attribute used to produce three findings, because
 * `sri-missing`, `third-party-script-no-sri` and `supply-chain-sri-external-script`
 * all detect it independently. One POST form without a token produced two. On
 * an ordinary page that was five of thirty findings restating two problems,
 * which reads as noise and buries the rest.
 *
 * Findings that describe the same underlying issue are collapsed to the single
 * most authoritative one. Nothing is discarded silently: the survivor lists the
 * checks that agreed with it in `alsoReportedBy`, so the UI can show "also
 * detected by 2 other checks" and the count of distinct problems is honest.
 */

import type { Vulnerability } from "./types";
import { SEVERITY_PRIORITY } from "@/lib/config/client-constants";

/**
 * Groups of pre-existing check IDs that detect the same underlying issue.
 *
 * Derived from the duplicate families measured in the engine audit. Checks
 * written against the `PageCheck` interface declare their own `dedupeGroup`
 * instead of appearing here.
 */
export const LEGACY_DEDUPE_GROUPS: Record<string, string> = {
  // Subresource Integrity missing on an external resource.
  "sri-missing": "sri-missing",
  "third-party-script-no-sri": "sri-missing",
  "supply-chain-sri-external-script": "sri-missing",

  // Sensitive values written to localStorage / sessionStorage.
  "localstorage-sensitive": "client-storage-sensitive",
  "sessionstorage-tokens": "client-storage-sensitive",
  "code-local-storage-pii": "client-storage-sensitive",
  "code-auth-sessionstorage-passwords": "client-storage-sensitive",
  "localstorage-sensitive-data": "client-storage-sensitive",

  // document.write as an injection sink.
  "document-write-usage": "document-write-sink",
  "document-write-sink": "document-write-sink",
  "cs-document-write-usage": "document-write-sink",
  "code-xss-documentwrite-jsonparse": "document-write-sink",

  // eval() and equivalents.
  "eval-in-scripts": "eval-usage",
  "eval-in-client-script": "eval-usage",
  "vibe-eval-usage": "eval-usage",
  "code-deser-base64-eval": "eval-usage",

  // postMessage with a wildcard target origin.
  "postmessage-star-origin": "postmessage-wildcard",
  "postmessage-wildcard": "postmessage-wildcard",

  // Source map references shipped to production.
  "sourcemap-reference": "source-map-exposed",
  "source-map-exposed-production": "source-map-exposed",

  // document.domain writes.
  "cs-document-domain-relaxation": "document-domain",
  "document-domain-usage": "document-domain",

  // AWS access key material in the response.
  "aws-credentials-exposed": "secret-aws-key",
  "secret-aws-access-key-id": "secret-aws-key",
  "secret-aws-secret-key": "secret-aws-key",

  // PEM private key block in the response.
  "private-key-exposed": "secret-private-key",
  "secret-private-key-pem": "secret-private-key",

  // GitHub personal access token.
  "github-token-exposed": "secret-github-token",
  "secret-github-pat": "secret-github-token",

  // CSP script-src allows 'unsafe-inline'.
  "csp-unsafe-inline-script": "csp-unsafe-inline",
  "cs-csp-unsafe-inline-script": "csp-unsafe-inline",

  // CSP allows 'unsafe-eval'.
  "csp-unsafe-eval-detected": "csp-unsafe-eval",
  "csp-unsafe-eval-script": "csp-unsafe-eval",

  // POST form with no anti-CSRF token.
  "sensitive-form-no-csrf": "form-missing-csrf",
  "vibe-missing-csrf": "form-missing-csrf",

  // Form submitting over plaintext HTTP from an HTTPS page.
  "form-action-http": "form-over-http",
  "insecure-form-submission": "form-over-http",

  // Server software version disclosed in a response header.
  "server-header-disclosure": "server-version-disclosure",
  "server-version-detailed": "server-version-disclosure",

  // Timing-Allow-Origin set to a wildcard.
  "timing-allow-origin-wide": "timing-allow-origin-wildcard",
  "server-timing-allow-origin-public": "timing-allow-origin-wildcard",

  // Referrer-Policy weaker than strict-origin-when-cross-origin.
  "referrer-policy-unsafe": "referrer-policy-weak",
  "referrer-policy-no-referrer-strict-origin-when-cross-origin":
    "referrer-policy-weak",

  // Mixed content on an HTTPS page.
  "mixed-content": "mixed-content",
  "mixed-protocol-content": "mixed-content",
  "supply-chain-http-script-on-https": "mixed-content",

  // SQL error text rendered into the page.
  "sql-error-in-page": "sql-error-disclosure",
  "sql-error-exposure": "sql-error-disclosure",

  // The legacy half of families whose PageCheck half already declares a
  // dedupeGroup. A merge needs BOTH sides mapped to the same group, and only
  // the PageCheck side was, so the two never met: one session cookie with no
  // attributes on an HTTPS page produced nine findings, and a CSP with one
  // wildcard and one http: source produced four. The group names are the ones
  // the PageChecks already use in lib/scanner/checks/page-checks/.
  "cookie-secure-missing": "cookie-missing-secure",
  "cookie-httponly-missing": "cookie-missing-httponly",
  "cookie-jwt-value-not-httponly": "cookie-missing-httponly",
  "cookie-samesite-missing": "cookie-missing-samesite",
  // Fires only when a session cookie lacks SameSite=Lax/Strict, which is the
  // condition above restated as a CSRF risk. One fix, one finding.
  "cookie-no-csrf-token": "cookie-missing-samesite",
  "set-cookie-samesite-none-no-secure": "cookie-samesite-none-no-secure",
  "cookie-host-prefix-not-secure": "cookie-prefix-violation",
  "cookie-host-prefix-wrong-path": "cookie-prefix-violation",
  "cookie-secure-prefix-not-secure": "cookie-prefix-violation",
  "cookie-host-prefix-attribute-mismatch": "cookie-prefix-violation",
  "csp-wildcard-source": "csp-wildcard-source",
  "csp-allows-http-sources": "csp-http-sources",
  "csp-object-src-unsafe": "csp-object-src-unrestricted",
  // Page frameable by any site. code-clickjack-x-frame-options restates
  // clickjack-missing's condition word for word, and the meta-tag PageCheck
  // reports the same exposure with the reason the author thought it was fixed.
  "clickjack-missing": "clickjacking",
  "code-clickjack-x-frame-options": "clickjacking",
  "target-blank-no-noopener": "anchor-target-blank-no-noopener",
  // GraphQL introspection. Two passive keyword checks and the live query that
  // confirms it; the survivor is the confirmed one whenever it ran.
  "graphql-introspection": "graphql-introspection",
  "api-graphql-introspection-enabled": "graphql-introspection",
  "async-graphql-introspection-enabled": "graphql-introspection",

  // A library version with a published advisory: the live OSV.dev lookup and
  // the offline snapshot (page-outdated-vulnerable-library, which declares
  // this group itself). Scoped per component, so each library stays its own
  // finding.
  "osv-vulnerable-library": "vulnerable-library",
};

/**
 * Checks that establish an issue against a live source rather than infer it
 * from the page. In a group, one of these is kept over a check that inferred
 * the same issue whatever the two severities say, because its severity is
 * the measured one: OSV.dev scores each advisory, where the offline library
 * snapshot can only know the advisories it was given, and the live GraphQL
 * query proves what the keyword matches guess at.
 */
const CONFIRMING_CHECKS: ReadonlySet<string> = new Set([
  "osv-vulnerable-library",
  "async-graphql-introspection-enabled",
]);

/** The check ID a finding came from, recovered from its stable finding ID. */
export function checkIdOf(finding: Vulnerability): string {
  const sep = finding.id.lastIndexOf("--");
  return sep === -1 ? finding.id : finding.id.slice(0, sep);
}

/**
 * The key findings merge on: the check's group, narrowed to one component
 * when the finding names one. Without the narrowing, a group whose checks
 * report per library would fold two different outdated libraries into one.
 */
function groupOf(
  finding: Vulnerability,
  extra: Record<string, string>,
): string | null {
  const id = checkIdOf(finding);
  const group = extra[id] ?? LEGACY_DEDUPE_GROUPS[id] ?? null;
  if (!group) return null;
  return finding.component ? `${group}|${finding.component}` : group;
}

/**
 * Pick the survivor of a duplicate group: a confirming check over one that
 * inferred, then highest severity, then highest confidence, then lowest check
 * ID so the choice is stable across runs and two scans of the same target
 * stay diffable.
 */
function better(a: Vulnerability, b: Vulnerability): Vulnerability {
  const confirmsA = CONFIRMING_CHECKS.has(checkIdOf(a));
  const confirmsB = CONFIRMING_CHECKS.has(checkIdOf(b));
  if (confirmsA !== confirmsB) return confirmsA ? a : b;
  const sevA = SEVERITY_PRIORITY[a.severity] ?? 0;
  const sevB = SEVERITY_PRIORITY[b.severity] ?? 0;
  if (sevA !== sevB) return sevA > sevB ? a : b;
  const confA = a.confidence ?? 0;
  const confB = b.confidence ?? 0;
  if (confA !== confB) return confA > confB ? a : b;
  return checkIdOf(a) <= checkIdOf(b) ? a : b;
}

export interface DedupeResult {
  findings: Vulnerability[];
  /** How many findings were folded into another. */
  merged: number;
}

/**
 * Collapse findings that describe the same underlying issue.
 *
 * Document order is preserved for the survivors. `extraGroups` lets checks
 * declared through the `PageCheck` interface contribute their own groupings
 * without editing the legacy table.
 *
 * Safe to run again over its own output mixed with new findings, which is
 * how a scan uses it: once over the page checks, then over everything once
 * the live checks have answered. A survivor's `alsoReportedBy` carries into
 * the second pass, so a check merged in the first is still listed after it.
 */
export function dedupeFindings(
  findings: Vulnerability[],
  extraGroups: Record<string, string> = {},
): DedupeResult {
  const winners = new Map<string, Vulnerability>();
  const contributors = new Map<string, Set<string>>();

  for (const f of findings) {
    const group = groupOf(f, extraGroups);
    if (!group) continue;
    const existing = winners.get(group);
    winners.set(group, existing ? better(existing, f) : f);
    if (!contributors.has(group)) contributors.set(group, new Set());
    const ids = contributors.get(group)!;
    ids.add(checkIdOf(f));
    for (const id of f.alsoReportedBy ?? []) ids.add(id);
  }

  const out: Vulnerability[] = [];
  const emitted = new Set<string>();
  let merged = 0;

  for (const f of findings) {
    const group = groupOf(f, extraGroups);
    if (!group) {
      out.push(f);
      continue;
    }
    const winner = winners.get(group)!;
    if (winner !== f) {
      merged++;
      continue;
    }
    if (emitted.has(group)) {
      // Same check fired twice in one group; the first instance already won.
      merged++;
      continue;
    }
    emitted.add(group);
    const others = [...contributors.get(group)!]
      .filter((id) => id !== checkIdOf(f))
      .sort();
    out.push(others.length > 0 ? { ...f, alsoReportedBy: others } : f);
  }

  return { findings: out, merged };
}
