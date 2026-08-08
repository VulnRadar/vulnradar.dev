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

import type { Severity, Vulnerability } from "./types";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

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
  "external-script-no-sri": "sri-missing",
  "third-party-script-no-sri": "sri-missing",
  "supply-chain-sri-external-script": "sri-missing",

  // Sensitive values written to localStorage / sessionStorage.
  "local-storage-sensitive": "client-storage-sensitive",
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
  "source-maps": "source-map-exposed",
  "source-map-exposed-production": "source-map-exposed",

  // document.domain writes.
  "document-domain": "document-domain",
  "document-domain-usage": "document-domain",

  // AWS access key material in the response.
  "aws-credentials-exposed": "secret-aws-key",
  "secret-aws-access-key-id": "secret-aws-key",
  "secret-aws-secret-key": "secret-aws-key",

  // PEM private key block in the response.
  "private-key-exposed": "secret-private-key",
  "private-key-in-source": "secret-private-key",
  "secret-private-key-pem": "secret-private-key",

  // Stripe secret key.
  "stripe-key-exposed": "secret-stripe-key",
  "secret-stripe-secret-key": "secret-stripe-key",

  // GitHub personal access token.
  "github-token-exposed": "secret-github-token",
  "secret-github-pat": "secret-github-token",

  // Docker Hub token.
  "docker-hub-token-exposed": "secret-docker-hub-token",
  "secret-docker-hub-token": "secret-docker-hub-token",

  // CSP script-src allows 'unsafe-inline'.
  "csp-unsafe-inline-script": "csp-unsafe-inline",
  "cs-csp-unsafe-inline-script": "csp-unsafe-inline",

  // CSP allows 'unsafe-eval'.
  "csp-unsafe-eval-detected": "csp-unsafe-eval",
  "csp-unsafe-eval-script": "csp-unsafe-eval",

  // CSP present but missing frame-ancestors.
  "csp-frame-ancestors": "csp-frame-ancestors-missing",
  "csp-frame-ancestors-missing": "csp-frame-ancestors-missing",

  // POST form with no anti-CSRF token.
  "sensitive-form-no-csrf": "form-missing-csrf",
  "vibe-missing-csrf": "form-missing-csrf",

  // Form submitting over plaintext HTTP from an HTTPS page.
  "form-action-http": "form-over-http",
  "form-no-action-https": "form-over-http",
  "insecure-form-submission": "form-over-http",

  // Server software version disclosed in a response header.
  "server-header-disclosure": "server-version-disclosure",
  "server-version-detailed": "server-version-disclosure",

  // X-Content-Type-Options present but not 'nosniff'.
  "nosniff-incorrect": "nosniff-wrong-value",
  "x-content-type-options-not-nosniff": "nosniff-wrong-value",

  // ETag exposing filesystem inode data.
  "etag-inode": "etag-inode",
  "etag-inode-leak": "etag-inode",

  // Timing-Allow-Origin set to a wildcard.
  "timing-allow-origin-wide": "timing-allow-origin-wildcard",
  "server-timing-allow-origin-public": "timing-allow-origin-wildcard",

  // Server-Timing leaking internal operation names.
  "server-timing-exposure": "server-timing-leak",
  "server-timing-sensitive-key-leak": "server-timing-leak",

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

  // Cross-Origin-Resource-Policy header absent.
  "corp-missing": "corp-missing",
  "cross-origin-resource-policy-report-only-missing": "corp-missing",
};

/** The check ID a finding came from, recovered from its stable finding ID. */
export function checkIdOf(finding: Vulnerability): string {
  const sep = finding.id.lastIndexOf("--");
  return sep === -1 ? finding.id : finding.id.slice(0, sep);
}

function groupOf(
  finding: Vulnerability,
  extra: Record<string, string>,
): string | null {
  const id = checkIdOf(finding);
  return extra[id] ?? LEGACY_DEDUPE_GROUPS[id] ?? null;
}

/**
 * Pick the survivor of a duplicate group: highest severity, then highest
 * confidence, then lowest check ID so the choice is stable across runs and
 * two scans of the same target stay diffable.
 */
function better(a: Vulnerability, b: Vulnerability): Vulnerability {
  const sevA = SEVERITY_RANK[a.severity] ?? 0;
  const sevB = SEVERITY_RANK[b.severity] ?? 0;
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
    contributors.get(group)!.add(checkIdOf(f));
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
