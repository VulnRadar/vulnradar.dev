/**
 * Known-vulnerable client-side library detection.
 *
 * `checks/content.ts` already flags a handful of libraries as generically
 * "outdated" by matching a version number inside the raw `<script src=...>`
 * substring. This module instead resolves each `<script>` tag's `src` through
 * the tokenizer (`ctx.scripts`), extracts a version where the filename
 * carries one, and compares it against a specific vulnerable range with a
 * CVE attached, so the finding says what is actually wrong rather than just
 * "old".
 *
 * Detection is filename-based (CDN URLs and typical build output both encode
 * the version in the path, e.g. `jquery-1.12.4.min.js`), which is a passive,
 * safe-by-construction technique: it never executes the fetched script.
 */

import type { PageCheck, CheckHit } from "../../check-types";
import { excerpt } from "../../check-types";
import type { ScriptRef } from "../../page-context";

interface VulnRange {
  name: string;
  /** Matches the library's filename segment, case-insensitively. */
  filePattern: RegExp;
  /** Extracts the dotted version number from the matched filename. */
  versionPattern: RegExp;
  /** Inclusive: versions strictly below this are vulnerable. */
  fixedIn: string;
  cve: string[];
  summary: string;
}

const RANGES: VulnRange[] = [
  {
    name: "jQuery",
    filePattern: /jquery(?!-ui)/i,
    versionPattern: /jquery[-.]?(\d+\.\d+\.\d+)/i,
    fixedIn: "3.5.0",
    cve: ["CVE-2020-11022", "CVE-2020-11023"],
    summary:
      "jQuery before 3.5.0 can execute attacker-controlled HTML passed to .html(), .append() and similar methods without sanitizing <option> and other elements, enabling XSS.",
  },
  {
    name: "jQuery UI",
    filePattern: /jquery-ui/i,
    versionPattern: /jquery-ui[-.]?(\d+\.\d+\.\d+)/i,
    fixedIn: "1.13.2",
    cve: ["CVE-2021-41182", "CVE-2021-41183", "CVE-2021-41184"],
    summary:
      "jQuery UI before 1.13.2 is vulnerable to XSS via the .datepicker(), .selectmenu() and .altField options.",
  },
  {
    name: "Bootstrap",
    filePattern: /bootstrap/i,
    versionPattern: /bootstrap[-.]?(\d+\.\d+\.\d+)/i,
    fixedIn: "4.3.1",
    cve: ["CVE-2019-8331"],
    summary:
      "Bootstrap before 4.3.1 is vulnerable to XSS via the data-target attribute of tooltip/popover/carousel components.",
  },
  {
    name: "Lodash",
    filePattern: /lodash/i,
    versionPattern: /lodash[-.]?(\d+\.\d+\.\d+)/i,
    fixedIn: "4.17.21",
    cve: ["CVE-2020-8203", "CVE-2021-23337"],
    summary:
      "Lodash before 4.17.21 is vulnerable to prototype pollution and command injection via the template function.",
  },
  {
    name: "Moment.js",
    filePattern: /moment/i,
    versionPattern: /moment[-.]?(\d+\.\d+\.\d+)/i,
    fixedIn: "2.29.4",
    cve: ["CVE-2022-24785"],
    summary:
      "Moment.js before 2.29.4 is vulnerable to path traversal when a user-controlled locale string is passed to moment().",
  },
  {
    name: "Handlebars",
    filePattern: /handlebars/i,
    versionPattern: /handlebars[-.]?(\d+\.\d+\.\d+)/i,
    fixedIn: "4.7.7",
    cve: ["CVE-2021-23383"],
    summary:
      "Handlebars before 4.7.7 is vulnerable to prototype pollution when compiling untrusted templates.",
  },
  {
    name: "Underscore.js",
    filePattern: /underscore/i,
    versionPattern: /underscore[-.]?(\d+\.\d+\.\d+)/i,
    fixedIn: "1.13.0-2",
    cve: ["CVE-2021-23358"],
    summary:
      "Underscore.js before 1.13.0-2 is vulnerable to arbitrary code execution via the template function.",
  },
  {
    name: "Axios",
    filePattern: /axios/i,
    versionPattern: /axios[-.]?(\d+\.\d+\.\d+)/i,
    fixedIn: "0.21.2",
    cve: ["CVE-2021-3749"],
    summary:
      "Axios before 0.21.2 is vulnerable to ReDoS via the trim function applied to response headers.",
  },
];

/**
 * Exported so other version-aware checks (e.g. `framework-fingerprint.ts`,
 * which compares CMS core versions rather than library filenames) reuse the
 * same comparison instead of reimplementing it.
 */
export function versionBelow(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

function scanScript(script: ScriptRef): CheckHit | null {
  const filename = script.src ?? "";
  if (!filename) return null;
  for (const range of RANGES) {
    if (!range.filePattern.test(filename)) continue;
    const m = filename.match(range.versionPattern);
    if (!m) continue;
    const version = m[1];
    if (!versionBelow(version, range.fixedIn)) continue;
    return {
      evidence: `${range.name} ${version} is loaded (fixed in ${range.fixedIn}). ${range.summary} ${range.cve.join(", ")}.`,
      excerpts: [excerpt("script src", script.resolved ?? script.src ?? "")],
      severity: "high",
    };
  }
  return null;
}

export const libraryChecks: PageCheck[] = [
  {
    id: "page-outdated-vulnerable-library",
    title: "Outdated JavaScript library with a known vulnerability",
    category: "supply-chain",
    severity: "high",
    method: "url-pattern",
    confidence: 82,
    description:
      "A script tag loads a specific version of a known JavaScript library that has a published vulnerability, identified from the library's own versioned filename.",
    riskImpact:
      "Depends on the specific CVE; ranges from stored/DOM XSS to prototype pollution and remote code execution in build tooling. See the finding evidence for the CVE identifiers.",
    explanation:
      "The version is read from the script's filename, which is how CDNs and typical build output name versioned library files. A library served without a version in its filename is not covered by this check.",
    fixSteps: [
      "Upgrade the library to at least the fixed version named in the finding.",
      "If the library is bundled rather than loaded from a CDN, update it in the project's dependency manifest and rebuild.",
    ],
    codeExamples: [],
    references: ["https://nvd.nist.gov/"],
    needs: ["scripts"],
    run(ctx) {
      const hits: CheckHit[] = [];
      const seen = new Set<string>();
      for (const script of ctx.scripts) {
        const hit = scanScript(script);
        if (!hit) continue;
        const key = hit.excerpts![0].value;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push(hit);
      }
      return hits.length > 0 ? hits : null;
    },
  },

  {
    id: "page-angularjs-legacy-detected",
    title: "AngularJS (1.x) detected, end of life since January 2022",
    category: "supply-chain",
    severity: "medium",
    method: "url-pattern",
    confidence: 80,
    description:
      "The page loads AngularJS (the 1.x branch, distinct from modern Angular), which reached end of life in January 2022 and receives no further security patches.",
    riskImpact:
      "Any vulnerability discovered in AngularJS after its end-of-life date will not be patched upstream. Known issues include sandbox escapes leading to XSS.",
    explanation:
      "AngularJS 1.x is detected by its characteristic script filename. Angular 2+ (the rewritten framework) is unaffected and not flagged by this check.",
    fixSteps: [
      "Migrate to a maintained framework (Angular 2+, React, Vue) or a community-maintained AngularJS fork if migration is not immediately feasible.",
    ],
    codeExamples: [],
    references: [
      "https://blog.angular.io/discontinued-long-term-support-for-angularjs-cc066b82e65a",
    ],
    needs: ["scripts"],
    run(ctx) {
      const offending = ctx.scripts.filter(
        (s) =>
          s.src &&
          /(?:^|\/)angular(?:\.min)?\.js/i.test(s.src) &&
          !/angular\/\d{2}\./i.test(s.src),
      );
      if (offending.length === 0) return null;
      return {
        evidence:
          "AngularJS (1.x) script detected, end of life since January 2022.",
        excerpts: offending.map((s) =>
          excerpt("script src", s.resolved ?? s.src ?? ""),
        ),
      };
    },
  },
];
