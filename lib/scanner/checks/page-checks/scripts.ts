/**
 * Script and resource-loading checks built on the parsed script/link list.
 *
 * `ctx.scripts` and `ctx.stylesheets` come from the tokenizer (`page-context.ts`),
 * so a `src` attribute value cannot be confused with markup that merely
 * appears inside a JavaScript string, and the resolved origin comparison
 * catches third-party CDNs correctly even for protocol-relative URLs.
 */

import type { PageCheck } from "../../check-types";
import { excerpt } from "../../check-types";
import type { ParsedCsp } from "../../page-context";

/** URL shorteners and paste sites are an unusual place to load a <script> from. */
const SUSPICIOUS_SCRIPT_HOSTS =
  /^(?:bit\.ly|tinyurl\.com|is\.gd|t\.co|goo\.gl|ow\.ly|pastebin\.com|paste\.ee|hastebin\.com|ngrok\.io|ngrok-free\.app|glitch\.me|repl\.co)$/i;

/**
 * Whether a CSP's script-src (or its default-src fallback) fails to
 * meaningfully restrict which origins may serve scripts: absent entirely,
 * report-only (so nothing is actually blocked), or a bare scheme/wildcard
 * source that admits any host.
 */
function scriptSrcIsUnconstrained(csp: ParsedCsp | null): boolean {
  if (!csp) return true;
  if (csp.reportOnly) return true;
  const list = csp.effective("script-src");
  if (!list || list.length === 0) return true;
  const lower = list.map((s) => s.toLowerCase());
  if (lower.includes("*")) return true;
  if (lower.includes("https:") || lower.includes("http:")) return true;
  return false;
}

export const scriptChecks: PageCheck[] = [
  {
    id: "page-script-missing-sri",
    title: "Third-party script loaded without Subresource Integrity",
    category: "supply-chain",
    severity: "low",
    method: "dom-structure",
    description:
      "One or more <script> tags load JavaScript from a third-party origin without an integrity attribute.",
    riskImpact:
      "If the third-party host is compromised, or the request is intercepted and modified, the browser executes whatever script is returned with no verification. SRI turns that into a blocked request instead. In practice SRI is structurally impractical for continuously-updated vendor scripts (analytics, ads, payment SDKs) that most production sites load, so this fires broadly and is not itself a sign of poor practice.",
    explanation:
      "The integrity attribute contains a cryptographic hash of the expected script content. The browser refuses to execute the script if the hash does not match, so a supply-chain compromise or MITM tampering does not silently execute.",
    fixSteps: [
      "Generate an SRI hash for each third-party script (most CDNs publish one alongside the script tag).",
      'Add integrity="sha384-..." and crossorigin="anonymous" to the tag.',
    ],
    codeExamples: [
      {
        label: "Script tag with SRI",
        language: "html",
        code: '<script src="https://cdn.example.com/lib.js" integrity="sha384-oqVuAf..." crossorigin="anonymous"></script>',
      },
    ],
    references: [
      "https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity",
    ],
    needs: ["scripts"],
    dedupeGroup: "sri-missing",
    run(ctx) {
      const offending = ctx.scripts.filter(
        (s) => s.thirdParty && s.src && !s.integrity,
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} third-party script(s) loaded without integrity: ${offending
          .map((s) => s.origin)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(", ")}.`,
        excerpts: offending.map((s) =>
          excerpt("script src", s.resolved ?? s.src ?? ""),
        ),
      };
    },
  },

  {
    id: "page-stylesheet-missing-sri",
    title: "Third-party stylesheet loaded without Subresource Integrity",
    category: "supply-chain",
    severity: "low",
    method: "dom-structure",
    description:
      'One or more <link rel="stylesheet"> tags load CSS from a third-party origin without an integrity attribute.',
    riskImpact:
      "CSS can exfiltrate data via attribute selectors and background-image requests, and a compromised stylesheet host can serve altered CSS with no verification.",
    explanation:
      "The integrity attribute lets the browser verify the fetched stylesheet against an expected hash before applying it, the same mechanism used for scripts.",
    fixSteps: [
      "Add an integrity attribute with the stylesheet's SRI hash.",
      'Add crossorigin="anonymous" alongside it.',
    ],
    codeExamples: [],
    dedupeGroup: "sri-missing",
    run(ctx) {
      const offending = ctx.stylesheets.filter(
        (s) => s.thirdParty && s.href && !s.integrity,
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} third-party stylesheet(s) loaded without integrity.`,
        excerpts: offending.map((s) =>
          excerpt("link href", s.resolved ?? s.href),
        ),
      };
    },
  },

  {
    id: "page-source-map-reference",
    title: "Source map reference in shipped JavaScript",
    category: "information-disclosure",
    severity: "low",
    method: "script-analysis",
    confidence: 80,
    description:
      "An inline script contains a sourceMappingURL comment pointing at a .map file.",
    riskImpact:
      "If the referenced .map file is deployed and publicly reachable, it reconstructs original, unminified source including comments and variable names, which meaningfully speeds up an attacker mapping the application's logic.",
    explanation:
      'This check only sees the reference in the script text; it does not fetch the .map file to confirm it exists (that would require the network layer this check does not own). Treat this as "verify whether the referenced map is publicly reachable," not as confirmation that it is.',
    fixSteps: [
      "Exclude .map files from the production deployment, or restrict access to authenticated internal users.",
      "Configure the build to omit sourceMappingURL comments from production bundles if maps are not needed publicly.",
    ],
    codeExamples: [],
    needs: ["scripts"],
    run(ctx) {
      const re = /sourceMappingURL\s*=\s*(\S+\.map)/i;
      const hits: { code: string; map: string }[] = [];
      for (const s of ctx.scripts) {
        if (s.src) continue;
        const m = s.code.match(re);
        if (m) hits.push({ code: s.code, map: m[1] });
      }
      if (hits.length === 0) return null;
      return {
        evidence: `${hits.length} inline script(s) reference a source map: ${hits.map((h) => h.map).join(", ")}.`,
        excerpts: hits.map((h) => excerpt("sourceMappingURL", h.map)),
      };
    },
  },

  {
    id: "page-script-from-suspicious-host",
    title: "Script loaded from a URL shortener or ephemeral hosting domain",
    category: "supply-chain",
    severity: "high",
    method: "url-pattern",
    confidence: 80,
    description:
      "A <script> tag loads JavaScript from a URL shortener, paste site, or ephemeral hosting domain rather than a conventional CDN or first-party path.",
    riskImpact:
      "These hosts are a common vector for injected or malicious script inclusion: the destination behind a shortened link can change after the page is reviewed, and paste/ephemeral hosts have no operational accountability.",
    explanation:
      "The script's resolved host matches a known URL-shortener, pastebin, or free ephemeral-hosting domain rather than an established CDN or the site's own origin.",
    fixSteps: [
      "Confirm this script inclusion is intentional.",
      "Host the script on a stable, first-party or well-known CDN origin instead.",
    ],
    codeExamples: [],
    needs: ["scripts"],
    run(ctx) {
      const offending = ctx.scripts.filter((s) => {
        if (!s.origin) return false;
        try {
          const host = new URL(s.origin).hostname;
          return SUSPICIOUS_SCRIPT_HOSTS.test(host);
        } catch {
          return false;
        }
      });
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} script(s) loaded from an unusual host: ${offending.map((s) => s.origin).join(", ")}.`,
        excerpts: offending.map((s) =>
          excerpt("script src", s.resolved ?? s.src ?? ""),
        ),
      };
    },
  },

  {
    id: "page-third-party-script-unconstrained-by-csp",
    title:
      "Third-party script has neither Subresource Integrity nor a restrictive CSP",
    category: "supply-chain",
    severity: "medium",
    method: "dom-structure",
    confidence: 75,
    description:
      "A third-party <script> tag has no integrity attribute, and the page's Content-Security-Policy does not meaningfully restrict which script origins are allowed, so neither of the two independent defenses against a compromised or substituted script is in place.",
    riskImpact:
      "SRI and a tight script-src allowlist are independent controls; either one alone would stop a compromised CDN or an in-transit modification from silently executing altered code. With neither present, a supply-chain compromise of the third-party host runs with the full trust of the page. This combination is nonetheless the default state for most production sites that load any analytics, ads, or marketing tag (SRI is impractical for those, and few sites lock down script-src that tightly), so treat this as worth tightening rather than as a confirmed defect.",
    explanation:
      "This is a combined-risk check: it only fires when both conditions hold at once. A page missing SRI but with a strict script-src allowlist is already reported, at lower severity, by the SRI-only check (page-script-missing-sri); this one is reserved for scripts with no defense at either layer, which is worse than either gap alone.",
    fixSteps: [
      "Add an integrity attribute to the script tag (the quickest fix).",
      "Or add/tighten script-src to name only the specific third-party origins the page actually loads from, removing any bare https: scheme source or wildcard.",
    ],
    codeExamples: [],
    needs: ["scripts"],
    run(ctx) {
      if (!scriptSrcIsUnconstrained(ctx.csp)) return null;
      const offending = ctx.scripts.filter(
        (s) => s.thirdParty && s.src && !s.integrity,
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} third-party script(s) have no SRI and no restrictive CSP script-src to fall back on.`,
        excerpts: offending.map((s) =>
          excerpt("script src", s.resolved ?? s.src ?? ""),
        ),
      };
    },
  },
];
