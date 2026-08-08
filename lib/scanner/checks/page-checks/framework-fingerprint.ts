/**
 * CMS/platform fingerprinting with version-aware outdated detection.
 *
 * The legacy `cms-fingerprinting` detector (`checks/content.ts`) reports
 * whatever a generator meta tag or version-carrying header says, with no
 * comparison against anything: it cannot tell a current install from one
 * several years stale. These checks read the same signals through the
 * parsed `ctx.metas` list rather than a body-wide regex, and add a second,
 * separate check that compares a captured version number against a
 * conservative threshold using the same `versionBelow` comparison the
 * known-vulnerable-library check already uses (`libraries.ts`).
 *
 * Thresholds are deliberately conservative and, where possible, tied to
 * multi-year-old release lines rather than "behind the current release",
 * so the check stays true regardless of what the latest version happens to
 * be when it runs.
 */

import type { PageCheck, CheckHit } from "../../check-types";
import { excerpt } from "../../check-types";
import type { PageContext } from "../../page-context";
import { versionBelow } from "./libraries";

interface CmsDetection {
  name: string;
  version: string | null;
  source: string;
  raw: string;
}

const CMS_VERSION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "WordPress", re: /^WordPress\s+(\d+(?:\.\d+){1,2})/i },
  { name: "Drupal", re: /^Drupal\s+(\d+(?:\.\d+)?)/i },
  { name: "Joomla", re: /Joomla!?\s+(\d+(?:\.\d+){1,2})/i },
  { name: "TYPO3", re: /^TYPO3(?:\s+CMS)?\s+(\d+(?:\.\d+){0,2})/i },
  { name: "MediaWiki", re: /^MediaWiki\s+(\d+(?:\.\d+){1,2})/i },
  { name: "Ghost", re: /^Ghost\s+(\d+(?:\.\d+){1,2})/i },
  { name: "Magento", re: /^Magento\s+(\d+(?:\.\d+){1,2})/i },
];

function safeHeader(ctx: PageContext, name: string): string | null {
  try {
    return ctx.headers.get(name);
  } catch {
    return null;
  }
}

function detectCms(ctx: PageContext): CmsDetection | null {
  const candidates: { value: string; source: string }[] = [];
  const generator = ctx.metas.find((m) => m.name === "generator")?.content;
  if (generator)
    candidates.push({ value: generator, source: "meta generator" });
  const xGenerator = safeHeader(ctx, "x-generator");
  if (xGenerator)
    candidates.push({ value: xGenerator, source: "X-Generator header" });

  for (const { value, source } of candidates) {
    for (const { name, re } of CMS_VERSION_PATTERNS) {
      const m = value.match(re);
      if (m) return { name, version: m[1] ?? null, source, raw: value };
    }
  }
  return null;
}

/**
 * Conservative "meaningfully outdated" thresholds. Versions strictly below
 * `fixedIn` are flagged. Wording avoids claiming an official end-of-life
 * date where that date isn't a stable, well-documented fact (WordPress
 * backports security fixes to old branches, so no EOL claim is made for
 * it); Drupal and Joomla have clearly documented EOL dates for the ranges
 * below.
 */
const OUTDATED_THRESHOLDS: Record<
  string,
  {
    fixedIn: string;
    severity: CheckHit["severity"];
    confidence: number;
    note: string;
  }
> = {
  WordPress: {
    fixedIn: "6.0.0",
    severity: "medium",
    confidence: 55,
    note: "several major releases behind the current line. WordPress backports some security fixes to older branches, but feature and hardening improvements since this release are missing.",
  },
  Drupal: {
    fixedIn: "9.0.0",
    severity: "high",
    confidence: 68,
    note: "on the Drupal 7 or 8 line, both of which have passed their official end-of-life date and no longer receive security support from the Drupal Security Team.",
  },
  Joomla: {
    fixedIn: "4.0.0",
    severity: "high",
    confidence: 65,
    note: "on the Joomla 3.x line, which reached end of life in August 2023 and no longer receives official security patches.",
  },
};

export const frameworkFingerprintChecks: PageCheck[] = [
  {
    id: "page-cms-version-disclosed",
    title: "CMS or platform version disclosed in page markup",
    category: "information-disclosure",
    severity: "info",
    method: "dom-structure",
    confidence: 92,
    description:
      "The page discloses the exact version of the content management system or platform generating it, via a generator meta tag or an X-Generator response header.",
    riskImpact:
      "A disclosed version narrows an attacker's search to only the vulnerabilities known to affect that specific release, rather than probing blind.",
    explanation:
      'Most CMS platforms emit a <meta name="generator"> tag or an X-Generator header by default. Disclosure alone is not a vulnerability, but most hardening guides for these platforms recommend removing it.',
    fixSteps: [
      "Remove or blank the generator meta tag in the theme or template layer.",
      "Strip the X-Generator response header at the web server or reverse proxy.",
    ],
    codeExamples: [
      {
        label: "WordPress: remove the generator tag",
        language: "php",
        code: "remove_action('wp_head', 'wp_generator');",
      },
    ],
    needs: ["html"],
    run(ctx) {
      const detected = detectCms(ctx);
      if (!detected) return null;
      return {
        evidence: `${detected.name}${detected.version ? " " + detected.version : ""} disclosed via ${detected.source}.`,
        excerpts: [excerpt(detected.source, detected.raw)],
      };
    },
  },

  {
    id: "page-cms-core-severely-outdated",
    title: "CMS core is running a severely outdated major version",
    category: "supply-chain",
    severity: "high",
    method: "dom-structure",
    confidence: 60,
    description:
      "The disclosed CMS core version is significantly behind current, actively supported release lines.",
    riskImpact:
      "An old CMS core misses years of accumulated security hardening and, for platforms with a documented end-of-life policy, may no longer receive security patches for newly discovered vulnerabilities at all.",
    explanation:
      "The version is read from the same generator meta tag or X-Generator header as the disclosure check, then compared against a conservative per-platform threshold. This does not enumerate specific CVEs affecting the exact version; it flags the release line as worth a dedicated review.",
    fixSteps: [
      "Upgrade the CMS core to a currently supported major version.",
      "If upgrading immediately isn't possible, confirm a vendor or community security-only backport is in place for this specific version.",
    ],
    codeExamples: [],
    references: [
      "https://www.drupal.org/psa-2023-01-11",
      "https://www.joomla.org/announcements/release-news/5854-joomla-3-10-13-and-end-of-life.html",
    ],
    needs: ["html"],
    run(ctx) {
      const detected = detectCms(ctx);
      if (!detected || !detected.version) return null;
      const threshold = OUTDATED_THRESHOLDS[detected.name];
      if (!threshold) return null;
      if (!versionBelow(detected.version, threshold.fixedIn)) return null;
      return {
        evidence: `${detected.name} ${detected.version} is ${threshold.note}`,
        excerpts: [excerpt(detected.source, detected.raw)],
        severity: threshold.severity,
        confidence: threshold.confidence,
      };
    },
  },
];
