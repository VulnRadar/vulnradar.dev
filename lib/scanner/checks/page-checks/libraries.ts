/**
 * Known-vulnerable client-side library detection, offline.
 *
 * osv-check.ts asks OSV.dev live about every library a page loads, and when
 * it runs it is the authority: it knows every advisory, including the ones
 * published after this file was last touched. This check is the fallback for
 * when it cannot run, a self-hosted instance with no outbound internet being
 * the usual reason, and it answers from a small snapshot of well-known
 * advisories instead. Both checks set the same `component` and share a dedupe
 * group, and dedupe keeps the live finding, so a scan that reached OSV.dev
 * shows one finding per library rather than two.
 *
 * The snapshot is recorded the way OSV records it, as affected intervals per
 * advisory with that advisory's own CVSS 3.1 base score. It used to be one
 * "fixed in" version and one CVE list per library, which was wrong wherever a
 * library maintains more than one line: Bootstrap 3.4.1 and Underscore 1.12.1
 * were reported for the CVEs those very releases fixed, TinyMCE 6.7.1 was not
 * reported for the advisory fixed in 6.7.3, and Moment.js 2.29.2 was blamed
 * for a CVE fixed in 2.29.2. Every finding was also "high", including a Handlebars
 * template RCE scored 9.8 and a jQuery XSS scored 6.9.
 *
 * Detection is filename-based (library-fingerprints.ts), passive and safe by
 * construction: it never executes the fetched script.
 */

import type { PageCheck, CheckHit } from "../../check-types";
import { excerpt } from "../../check-types";
import type { ScriptRef } from "../../page-context";
import type { Severity } from "../../types";
import { severityFromCvssScore } from "../../cvss";
import { SEVERITY_PRIORITY } from "@/lib/config/client-constants";
import {
  detectLibrary,
  libraryComponent,
  versionBelow,
} from "../../library-fingerprints";

interface KnownAdvisory {
  cve: string;
  /** [introduced, fixed) intervals; "0" means from the first release. */
  affected: ReadonlyArray<readonly [string, string]>;
  /** The advisory's own CVSS 3.1 base score, as published with it. */
  cvss: number;
  summary: string;
}

/**
 * Advisory data as recorded by OSV.dev (GitHub Security Advisories) in
 * September 2026, keyed by npm package. Deliberately small: these are the
 * widely exploited or widely cited ones, not a mirror, which is the live
 * check's job.
 */
const KNOWN_ADVISORIES: Readonly<Record<string, readonly KnownAdvisory[]>> = {
  dompurify: [
    {
      cve: "CVE-2024-47875",
      affected: [
        ["0", "2.5.0"],
        ["3.0.0", "3.1.3"],
      ],
      cvss: 10.0,
      summary:
        "nesting-based mutation XSS: markup that survives sanitisation is re-parsed into something executable once inserted",
    },
    {
      cve: "CVE-2024-45801",
      affected: [
        ["0", "2.5.4"],
        ["3.0.0", "3.1.3"],
      ],
      cvss: 7.0,
      summary:
        "prototype pollution lets other script on the page weaken the sanitizer's configuration",
    },
    {
      cve: "CVE-2025-26791",
      affected: [["0", "3.2.4"]],
      cvss: 4.5,
      summary:
        "a template-literal regular expression lets mutation XSS through when SAFE_FOR_TEMPLATES is on",
    },
  ],
  marked: [
    {
      cve: "CVE-2022-21680",
      affected: [["0", "4.0.10"]],
      cvss: 7.5,
      summary:
        "a block-definition regular expression backtracks catastrophically, so one crafted comment can hang the renderer",
    },
    {
      cve: "CVE-2022-21681",
      affected: [["0", "4.0.10"]],
      cvss: 7.5,
      summary:
        "an inline-text regular expression backtracks catastrophically on crafted markdown",
    },
  ],
  tinymce: [
    {
      cve: "CVE-2023-45818",
      affected: [
        ["0", "5.10.8"],
        ["6.0.0", "6.7.1"],
      ],
      cvss: 6.1,
      summary:
        "mutation XSS through the undo/redo stack and the getContent and resetContent APIs",
    },
    {
      cve: "CVE-2023-48219",
      affected: [
        ["0", "5.10.9"],
        ["6.0.0", "6.7.3"],
      ],
      cvss: 6.1,
      summary:
        "mutation XSS through special characters in unescaped text nodes",
    },
  ],
  prismjs: [
    {
      cve: "CVE-2022-23647",
      affected: [["1.14.0", "1.27.0"]],
      cvss: 7.5,
      summary:
        "the command-line plugin writes attacker-influenced markup into the page",
    },
  ],
  "jquery-ui": [
    {
      cve: "CVE-2021-41182",
      affected: [["0", "1.13.0"]],
      cvss: 6.5,
      summary: "XSS through the Datepicker altField option",
    },
    {
      cve: "CVE-2021-41183",
      affected: [["0", "1.13.0"]],
      cvss: 6.5,
      summary: "XSS through the Datepicker *Text options",
    },
    {
      cve: "CVE-2021-41184",
      affected: [["0", "1.13.0"]],
      cvss: 6.5,
      summary: "XSS through the of option of .position()",
    },
    {
      cve: "CVE-2022-31160",
      affected: [["0", "1.13.2"]],
      cvss: 6.1,
      summary:
        "XSS when a checkboxradio is refreshed on a label containing HTML",
    },
  ],
  jquery: [
    {
      cve: "CVE-2020-11022",
      affected: [["1.12.0", "3.5.0"]],
      cvss: 6.9,
      summary:
        "HTML passed to .html(), .append() and similar methods can execute script even after sanitising",
    },
    {
      cve: "CVE-2020-11023",
      affected: [["1.0.3", "3.5.0"]],
      cvss: 6.9,
      summary:
        "HTML containing option elements passed to DOM manipulation methods can execute script, and it is on CISA's known-exploited list",
    },
    {
      cve: "CVE-2019-11358",
      affected: [["1.1.4", "3.4.0"]],
      cvss: 6.1,
      summary:
        "jQuery.extend(true, ...) on untrusted input pollutes Object.prototype",
    },
  ],
  bootstrap: [
    {
      cve: "CVE-2019-8331",
      affected: [
        ["3.0.0", "3.4.1"],
        ["4.0.0", "4.3.1"],
      ],
      cvss: 6.1,
      summary:
        "XSS through the tooltip and popover data-template, data-content and data-title options",
    },
  ],
  lodash: [
    {
      cve: "CVE-2020-8203",
      affected: [["3.7.0", "4.17.19"]],
      cvss: 7.4,
      summary: "prototype pollution through zipObjectDeep",
    },
    {
      cve: "CVE-2021-23337",
      affected: [["0", "4.17.21"]],
      cvss: 7.2,
      summary: "command injection through the template function",
    },
  ],
  moment: [
    {
      cve: "CVE-2022-24785",
      affected: [["0", "2.29.2"]],
      cvss: 7.5,
      summary:
        "path traversal when a user-controlled locale string is passed to moment.locale()",
    },
    {
      cve: "CVE-2022-31129",
      affected: [["2.18.0", "2.29.4"]],
      cvss: 7.5,
      summary:
        "quadratic-time RFC 2822 date parsing, so a long crafted date string stalls the thread",
    },
  ],
  handlebars: [
    {
      cve: "CVE-2021-23369",
      affected: [["0", "4.7.7"]],
      cvss: 9.8,
      summary:
        "remote code execution when compiling templates from an untrusted source",
    },
    {
      cve: "CVE-2021-23383",
      affected: [["0", "4.7.7"]],
      cvss: 9.8,
      summary: "prototype pollution when compiling untrusted templates",
    },
  ],
  underscore: [
    {
      cve: "CVE-2021-23358",
      affected: [["1.3.2", "1.12.1"]],
      cvss: 9.8,
      summary:
        "arbitrary code execution through the variable option of _.template",
    },
  ],
  axios: [
    {
      cve: "CVE-2021-3749",
      affected: [["0", "0.21.2"]],
      cvss: 7.5,
      summary:
        "a regular expression in the header trim function backtracks catastrophically",
    },
    {
      cve: "CVE-2023-45857",
      affected: [
        ["0.8.1", "0.28.0"],
        ["1.0.0", "1.6.0"],
      ],
      cvss: 6.5,
      summary:
        "the XSRF-TOKEN cookie value is sent to every host a request goes to, not only the site's own",
    },
  ],
};

/** The release that fixes `version` for this advisory, or null when the
 *  advisory does not affect it. */
function fixedFor(advisory: KnownAdvisory, version: string): string | null {
  for (const [introduced, fixed] of advisory.affected) {
    if (introduced !== "0" && versionBelow(version, introduced)) continue;
    if (versionBelow(version, fixed)) return fixed;
  }
  return null;
}

function scanScript(script: ScriptRef): CheckHit | null {
  const src = script.resolved ?? script.src ?? "";
  if (!src) return null;
  const lib = detectLibrary(src);
  if (!lib) return null;

  const matched = (KNOWN_ADVISORIES[lib.npmPackage] ?? [])
    .map((advisory) => ({ advisory, fixed: fixedFor(advisory, lib.version) }))
    .filter(
      (m): m is { advisory: KnownAdvisory; fixed: string } => m.fixed !== null,
    )
    .sort((a, b) => b.advisory.cvss - a.advisory.cvss);
  if (matched.length === 0) return null;

  const severity: Severity = matched
    .map((m) => severityFromCvssScore(m.advisory.cvss))
    .reduce((worst, s) =>
      SEVERITY_PRIORITY[s] > SEVERITY_PRIORITY[worst] ? s : worst,
    );
  const upgradeTo = matched
    .map((m) => m.fixed)
    .reduce((highest, v) => (versionBelow(highest, v) ? v : highest));
  const listed = matched
    .map(
      (m) =>
        `${m.advisory.cve} (CVSS ${m.advisory.cvss.toFixed(1)}): ${m.advisory.summary}`,
    )
    .join("; ");
  const one = matched.length === 1;

  return {
    evidence: `${lib.name} ${lib.version} is loaded, and ${one ? "a known advisory affects" : `${matched.length} known advisories affect`} that version. ${listed}. ${upgradeTo} or later fixes ${one ? "it" : "all of them"}.`,
    excerpts: [excerpt("script src", src)],
    severity,
    component: libraryComponent(lib),
  };
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
      "A script tag loads a specific version of a known JavaScript library that a published advisory affects, identified from the library's own versioned filename.",
    riskImpact:
      "Depends on the advisory, and the finding's severity follows that advisory's own CVSS score: from cross-site scripting through a sanitizer or a DOM method, to prototype pollution and code execution when templates are compiled.",
    explanation:
      "The version is read from the script's filename or CDN path, which is how CDNs and typical build output name versioned library files; a library served without a version in its URL is not covered. This check answers from a small built-in list of well-known advisories so it works with no internet access. When the live OSV.dev check also runs, it knows every published advisory, and its finding is kept in place of this one.",
    fixSteps: [
      "Upgrade the library to at least the version named in the finding, which fixes every advisory it lists.",
      "If the library is bundled rather than loaded from a CDN, update it in the project's dependency manifest and rebuild.",
    ],
    codeExamples: [],
    references: ["https://osv.dev/"],
    needs: ["scripts"],
    dedupeGroup: "vulnerable-library",
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
