/**
 * Link and anchor-based checks built on the parsed anchor/form structure.
 *
 * All three checks here read `ctx.anchors` and `ctx.forms` (resolved by the
 * tokenizer in `page-context.ts`) rather than regexing the raw body, which
 * is what let the legacy `open-redirect` and `sensitive-files` detectors in
 * `checks/content.ts` fire on text that merely looks like a URL and on a
 * footer link to a GitHub repository ending in `.git` respectively (see the
 * engine audit, section 4d, for both measured false positives). Restricting
 * matches to actual, resolved link targets fixes both.
 */

import type { PageCheck } from "../../check-types";
import { excerpt } from "../../check-types";

const REDIRECT_PARAM_NAMES = new Set([
  "next",
  "return",
  "returnurl",
  "returnto",
  "redirect",
  "redirecturl",
  "redirecturi",
  "redir",
  "continue",
  "forward",
  "forwardurl",
  "destination",
  "dest",
  "goto",
  "callbackurl",
  "successurl",
  "checkouturl",
  "targeturl",
  "returnpath",
  "backurl",
]);

function normalizeParamName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, "");
}

function findRedirectParams(url: string): string[] {
  try {
    const u = new URL(url);
    const hits: string[] = [];
    for (const key of u.searchParams.keys()) {
      if (REDIRECT_PARAM_NAMES.has(normalizeParamName(key))) hits.push(key);
    }
    return hits;
  } catch {
    return [];
  }
}

const SENSITIVE_FILE_EXT =
  /\.(git|env|sql|bak|backup|old|orig|swp|zip|tar\.gz|tgz|dump|pem|key|sqlite|sqlite3|db)$/i;
const SENSITIVE_FILE_NAME =
  /(?:^|\/)(?:\.env(?:\.\w+)?|\.git|wp-config\.php\.bak|web\.config\.bak|config\.php\.bak|\.htpasswd|id_rsa)$/i;

function pathnameOf(resolved: string | null): string | null {
  if (!resolved) return null;
  try {
    return new URL(resolved).pathname;
  } catch {
    return null;
  }
}

export const linkChecks: PageCheck[] = [
  {
    id: "page-open-redirect-param-shape",
    title: "Link or form parameter shaped like an open-redirect target",
    category: "content",
    severity: "low",
    method: "dom-structure",
    confidence: 45,
    description:
      "A link or form action carries a query parameter whose name is commonly used to redirect the browser after an action (login, logout, checkout) completes.",
    riskImpact:
      "If the endpoint reads this parameter and redirects to it without validating the destination, an attacker can craft a link on the site's own domain that bounces the victim to an attacker-controlled page, effective for phishing because the initial URL is the trusted domain.",
    explanation:
      "This flags the shape of the parameter name only (next=, returnUrl=, redirect=, and similar) found in the page's own links and form actions. It does not submit a redirect payload or confirm the target endpoint is actually vulnerable; this is a pattern worth a manual look, not a confirmed finding. Active testing of the endpoint is a separate, opt-in feature.",
    fixSteps: [
      "On the endpoint that reads this parameter, validate the destination against an allowlist of paths or origins before redirecting.",
      "Prefer a relative path or an opaque token that maps server-side to a destination, rather than accepting an arbitrary URL.",
    ],
    codeExamples: [],
    references: [
      "https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards",
    ],
    needs: ["html"],
    run(ctx) {
      const hits: { url: string; params: string[] }[] = [];
      for (const a of ctx.anchors) {
        if (!a.resolved) continue;
        const params = findRedirectParams(a.resolved);
        if (params.length > 0) hits.push({ url: a.resolved, params });
      }
      for (const f of ctx.forms) {
        if (!f.resolvedAction) continue;
        const params = findRedirectParams(f.resolvedAction);
        if (params.length > 0) hits.push({ url: f.resolvedAction, params });
      }
      if (hits.length === 0) return null;
      const seen = new Set<string>();
      const excerpts: ReturnType<typeof excerpt>[] = [];
      for (const h of hits) {
        if (seen.has(h.url)) continue;
        seen.add(h.url);
        excerpts.push(
          excerpt("URL", `${h.url} (param: ${h.params.join(", ")})`),
        );
        if (excerpts.length >= 8) break;
      }
      return {
        evidence: `${excerpts.length} link(s)/form(s) carry a redirect-shaped parameter; worth confirming the destination is validated server-side.`,
        excerpts,
      };
    },
  },

  {
    id: "page-anchor-target-blank-no-noopener",
    title: 'Link opens in a new tab without rel="noopener"',
    category: "content",
    severity: "low",
    method: "dom-structure",
    confidence: 85,
    description:
      'A link to a different origin sets target="_blank" without rel="noopener" (or "noreferrer").',
    riskImpact:
      "The opened page runs in a separate process but can still reach back through window.opener to navigate the original tab to a phishing page (reverse tabnabbing), and can read the referring URL via window.opener.location.",
    explanation:
      'Current Chromium and Firefox versions implicitly apply noopener behavior to target="_blank" links, which limits this in up-to-date browsers, but older browsers, embedded WebViews, and code that opens the link programmatically via window.open may not get that protection. Declaring it explicitly removes the ambiguity.',
    fixSteps: [
      'Add rel="noopener" (or "noreferrer" if the Referer header should also be suppressed) to every target="_blank" anchor pointing off-site.',
    ],
    codeExamples: [
      {
        label: "Safe external link",
        language: "html",
        code: '<a href="https://example.org" target="_blank" rel="noopener">External</a>',
      },
    ],
    references: [
      "https://developer.mozilla.org/en-US/docs/Web/API/Window/open#noopener",
    ],
    needs: ["html"],
    dedupeGroup: "anchor-target-blank-no-noopener",
    run(ctx) {
      const offending = ctx.anchors.filter((a) => {
        if ((a.target ?? "").toLowerCase() !== "_blank") return false;
        if (!a.thirdParty) return false;
        const rel = (a.rel ?? "").toLowerCase().split(/\s+/);
        return !rel.includes("noopener") && !rel.includes("noreferrer");
      });
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} cross-origin target="_blank" link(s) without rel="noopener".`,
        excerpts: offending
          .slice(0, 10)
          .map((a) => excerpt("a href", a.resolved ?? a.href)),
      };
    },
  },

  {
    id: "page-sensitive-file-link-same-origin",
    title: "Same-origin link points at a backup, config, or VCS file",
    category: "information-disclosure",
    severity: "medium",
    method: "url-pattern",
    confidence: 62,
    description:
      "A link on the page, resolved to the site's own origin, points at a path shaped like a backup, configuration, or version-control file rather than an application page.",
    riskImpact:
      "These file types typically contain source code, credentials, or database dumps rather than visitor-facing content. A reachable link to one is a strong signal the file itself may also be directly downloadable.",
    explanation:
      "Restricted to links resolving to the page's own origin, so a footer link to a project's GitHub repository (which commonly ends in .git) is not flagged; that was a measured false positive in the previous body-wide regex version of this check. Does not fetch the link to confirm the file is actually served: treat this as 'verify this path is not exposed,' not confirmation that it is.",
    fixSteps: [
      "Remove the link if it is a leftover reference to a build artifact.",
      "Confirm the file itself returns 404 or is blocked at the web server level, not just unlinked from the page.",
    ],
    codeExamples: [],
    needs: ["html"],
    run(ctx) {
      const offending = ctx.anchors.filter((a) => {
        if (a.thirdParty) return false;
        const pathname = pathnameOf(a.resolved);
        if (!pathname) return false;
        return (
          SENSITIVE_FILE_EXT.test(pathname) ||
          SENSITIVE_FILE_NAME.test(pathname)
        );
      });
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} same-origin link(s) point at a backup/config/VCS-shaped path.`,
        excerpts: offending
          .slice(0, 10)
          .map((a) => excerpt("a href", a.resolved ?? a.href)),
      };
    },
  },
];
