/**
 * Display helpers for the finding metadata the exports have always carried
 * and the UI never showed.
 *
 * Three fields, three producers, no consumer on screen until now:
 *
 *   - `cwe` / `owasp`, hand-authored on 721 of the 852 check definitions and
 *     attached by lib/scanner/registry.ts. SARIF tagged them, CSV had columns
 *     for them, the compliance crosswalk resolved them. The panel a person
 *     actually reads showed neither.
 *   - `alsoReportedBy`, written by lib/scanner/dedupe.ts so a finding three
 *     checks agreed on could say so. Without it, corroboration made a finding
 *     read weaker than a single-source one, because the merge is invisible.
 *   - `location`, the file (and sometimes line) behind a repo-scan finding.
 *     "Hardcoded API key" with no file is not actionable.
 *
 * Everything here is defensive about its input for the same reason the
 * evidence panel is: a finding can come straight out of scan_history JSON
 * written by an older engine, and `location.file` in particular originates in
 * a third party's repository. Values are validated before a URL is built from
 * one, and bounded before they are rendered. Nothing here produces markup.
 */

/** Matches a normalized CWE id and nothing else. Anything that fails this is
 *  rendered as plain text rather than turned into a link. */
const CWE_ID = /^CWE-(\d{1,7})$/i;

/** "A03:2021", "A3:2021", "A03" all resolve; anything else does not. */
const OWASP_ID = /^A(\d{1,2})(?::2021)?$/i;

/** The OWASP Top 10 (2021), which is the revision every `owasp` tag in
 *  lib/scanner/checks-data/ is written against. Slug is the path segment
 *  owasp.org uses for that category's own page. */
const OWASP_TOP_TEN_2021: Record<string, { name: string; slug: string }> = {
  A01: {
    name: "Broken Access Control",
    slug: "A01_2021-Broken_Access_Control",
  },
  A02: {
    name: "Cryptographic Failures",
    slug: "A02_2021-Cryptographic_Failures",
  },
  A03: { name: "Injection", slug: "A03_2021-Injection" },
  A04: { name: "Insecure Design", slug: "A04_2021-Insecure_Design" },
  A05: {
    name: "Security Misconfiguration",
    slug: "A05_2021-Security_Misconfiguration",
  },
  A06: {
    name: "Vulnerable and Outdated Components",
    slug: "A06_2021-Vulnerable_and_Outdated_Components",
  },
  A07: {
    name: "Identification and Authentication Failures",
    slug: "A07_2021-Identification_and_Authentication_Failures",
  },
  A08: {
    name: "Software and Data Integrity Failures",
    slug: "A08_2021-Software_and_Data_Integrity_Failures",
  },
  A09: {
    name: "Security Logging and Monitoring Failures",
    slug: "A09_2021-Security_Logging_and_Monitoring_Failures",
  },
  A10: {
    name: "Server-Side Request Forgery",
    slug: "A10_2021-Server-Side_Request_Forgery_%28SSRF%29",
  },
};

export interface TaxonomyRef {
  /** What to print, e.g. "CWE-79" or "A03:2021". */
  label: string;
  /** Human name, e.g. "Injection". Empty for CWE, which has no local name. */
  name: string;
  /** Canonical reference page, or null when the id did not validate. */
  url: string | null;
}

/**
 * The CWE this finding maps to, ready to render. `url` points at MITRE's
 * definition page for the id, which is the only thing that makes a bare
 * "CWE-79" useful to a reader who does not have the catalogue memorized.
 */
export function cweRef(cwe: string | undefined | null): TaxonomyRef | null {
  if (typeof cwe !== "string") return null;
  const match = CWE_ID.exec(cwe.trim());
  if (!match) return null;
  const id = String(Number(match[1]));
  return {
    label: `CWE-${id}`,
    name: "",
    url: `https://cwe.mitre.org/data/definitions/${id}.html`,
  };
}

/**
 * The OWASP Top 10 (2021) category this finding maps to. Unknown or
 * malformed ids resolve to null rather than a guessed link.
 */
export function owaspRef(owasp: string | undefined | null): TaxonomyRef | null {
  if (typeof owasp !== "string") return null;
  const match = OWASP_ID.exec(owasp.trim());
  if (!match) return null;
  const key = `A${match[1].padStart(2, "0")}`.toUpperCase();
  const entry = OWASP_TOP_TEN_2021[key];
  if (!entry) return null;
  return {
    label: `${key}:2021`,
    name: entry.name,
    url: `https://owasp.org/Top10/${entry.slug}/`,
  };
}

/**
 * How many other checks independently reported this same issue before
 * dedupe folded them in. Zero when nothing was merged, which is the common
 * case and renders nothing at all.
 */
export function corroborationCount(
  alsoReportedBy: string[] | undefined | null,
): number {
  if (!Array.isArray(alsoReportedBy)) return 0;
  const ids = new Set<string>();
  for (const id of alsoReportedBy) {
    if (typeof id === "string" && id.trim()) ids.add(id.trim());
  }
  return ids.size;
}

/** "Also found by 2 other checks", or null when nothing was merged. */
export function corroborationLabel(
  alsoReportedBy: string[] | undefined | null,
): string | null {
  const count = corroborationCount(alsoReportedBy);
  if (count === 0) return null;
  return count === 1
    ? "Also found by 1 other check"
    : `Also found by ${count} other checks`;
}

/** Longest path we print before eliding. Long enough for a deep monorepo
 *  path, short enough that it cannot push a metadata row off a phone. */
const MAX_PATH_CHARS = 96;

/** Control characters, which a repository path has no business containing
 *  and which would otherwise reach the DOM verbatim. */
function stripControlChars(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

/**
 * "src/lib/keys.ts:42" for a finding that came from source rather than a
 * live response, or null when it has no location.
 *
 * The path is a third party's repository path, so control characters are
 * stripped and the value is bounded. Eliding keeps the tail, because the
 * filename is the part a reader needs and the leading directories are the
 * part they can infer.
 */
export function findingLocationLabel(
  location: { file?: unknown; line?: unknown } | undefined | null,
): string | null {
  if (!location || typeof location.file !== "string") return null;
  const cleaned = stripControlChars(location.file).trim();
  if (!cleaned) return null;
  const file =
    cleaned.length > MAX_PATH_CHARS
      ? `...${cleaned.slice(cleaned.length - (MAX_PATH_CHARS - 3))}`
      : cleaned;
  const line = location.line;
  const hasLine =
    typeof line === "number" && Number.isInteger(line) && line > 0;
  return hasLine ? `${file}:${line}` : file;
}
