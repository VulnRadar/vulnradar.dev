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
import type { AnchorRef } from "../../page-context";
import { plural, pluralize } from "@/lib/ui/plural";
import { classifySubresource } from "../_subresource";

const NON_POPUP_TARGETS = new Set(["_blank", "_self", "_parent", "_top"]);

/**
 * Whether the link hands the opened page its window.opener. A plain
 * target="_blank" does not (implicit noopener, every current browser), so it
 * takes either an explicit rel="opener" on a _blank link or a named target,
 * which opens a window the page can be reached through.
 */
function keepsOpener(a: AnchorRef): boolean {
  const target = (a.target ?? "").trim().toLowerCase();
  if (!target) return false;
  const rel = (a.rel ?? "").toLowerCase().split(/s+/);
  if (rel.includes("noopener") || rel.includes("noreferrer")) return false;
  if (target === "_blank") return rel.includes("opener");
  return !NON_POPUP_TARGETS.has(target);
}

/** Another site: not the page's origin, and not its www or a subdomain of it. */
function isOtherSite(resolved: string | null, pageUrl: string): boolean {
  if (!resolved) return false;
  const cls = classifySubresource(resolved, pageUrl);
  return cls !== null && cls !== "same-origin" && cls !== "same-site";
}

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

/**
 * Whether a redirect-param's VALUE actually points somewhere off the
 * current page's origin, as opposed to a bare relative path.
 *
 * The param NAME alone (next=, returnUrl=, redirect=) is not evidence of
 * anything: `returnUrl=/account/delete-account` is a same-domain relative
 * path with no external destination in it at all, so it cannot be an
 * open-redirect vector regardless of how the endpoint validates it. Only a
 * value shaped like an absolute URL or a protocol-relative URL is worth
 * flagging, and even then only when it resolves to a different origin.
 */
function looksLikeExternalRedirectTarget(
  rawValue: string,
  pageOrigin: string,
): boolean {
  let value = rawValue;
  try {
    const decoded = decodeURIComponent(rawValue);
    if (decoded !== rawValue) value = decoded;
  } catch {
    // Not validly percent-encoded — fall back to the raw value.
  }
  const trimmed = value.trim();
  if (trimmed === "") return false;
  // Protocol-relative ("//evil.com") or the backslash variants some
  // browsers still normalize to protocol-relative ("\\evil.com", "/\evil.com").
  if (/^[/\\]{2}/.test(trimmed)) return true;
  // An absolute URL with an explicit scheme (http:, https:, or otherwise).
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    try {
      return new URL(trimmed).origin !== pageOrigin;
    } catch {
      // Scheme-shaped but not a parseable URL (e.g. "javascript:alert(1)")
      // — not a same-origin path either, still worth a look.
      return true;
    }
  }
  // A bare relative path ("/account/delete-account", "dashboard") — stays
  // on the current origin no matter what the server does with it.
  return false;
}

function findRedirectParams(url: string, pageOrigin: string): string[] {
  try {
    const u = new URL(url);
    const hits: string[] = [];
    for (const [key, value] of u.searchParams.entries()) {
      if (
        REDIRECT_PARAM_NAMES.has(normalizeParamName(key)) &&
        looksLikeExternalRedirectTarget(value, pageOrigin)
      ) {
        hits.push(key);
      }
    }
    return hits;
  } catch {
    return [];
  }
}

const SENSITIVE_FILE_EXT =
  /\.(git|env|sql|bak|backup|old|orig|swp|dump|pem|key|sqlite|sqlite3|db)$/i;
const SENSITIVE_FILE_NAME =
  /(?:^|\/)(?:\.env(?:\.\w+)?|\.git|wp-config\.php\.bak|web\.config\.bak|config\.php\.bak|\.htpasswd|id_rsa)$/i;
// An archive is how a download page, a press kit or a software release is
// handed out, which is why the sensitive-files detector dropped .zip outright.
// One is still worth reporting when its name or its directory says it is a
// backup or a dump of the site, so the extension alone is not enough here.
const ARCHIVE_EXT = /\.(?:zip|tar\.gz|tgz)$/i;
const BACKUP_SHAPED_PATH =
  /(?:^|[^a-z])(?:backups?|bak|dumps?|db|database|sql|www)(?:[^a-z]|$)/i;

function isBackupArchive(pathname: string): boolean {
  if (!ARCHIVE_EXT.test(pathname)) return false;
  return BACKUP_SHAPED_PATH.test(pathname.replace(ARCHIVE_EXT, ""));
}

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
        const params = findRedirectParams(a.resolved, ctx.origin);
        if (params.length > 0) hits.push({ url: a.resolved, params });
      }
      for (const f of ctx.forms) {
        if (!f.resolvedAction) continue;
        const params = findRedirectParams(f.resolvedAction, ctx.origin);
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
    title: "Link keeps window.opener",
    category: "content",
    severity: "low",
    method: "dom-structure",
    confidence: 85,
    description:
      'A link to another site opts back in to window.opener, either with rel="opener" on a target="_blank" link or with a named target such as target="help" that has no rel="noopener" or "noreferrer".',
    riskImpact:
      "The opened page can reach back through window.opener and navigate the original tab to a phishing page (reverse tabnabbing), so a compromised or hostile destination gets a handle on the page the visitor came from.",
    explanation:
      'A plain target="_blank" is already safe: Chrome 88, Firefox 79 and Safari 12.1 treat it as rel="noopener". This check only reports the two cases that still hand the opener over, an explicit rel="opener" and a named target that is not _blank, _self, _parent or _top. Links to the same site, including www and subdomains of it, are not reported.',
    fixSteps: [
      'Remove rel="opener" from the link, or add rel="noopener" to it.',
      'For a named target, add rel="noopener" (or "noreferrer" if the Referer header should also be suppressed), or use target="_blank" instead.',
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
      "https://html.spec.whatwg.org/multipage/links.html#link-type-opener",
    ],
    needs: ["html"],
    dedupeGroup: "anchor-target-blank-no-noopener",
    run(ctx) {
      const offending = ctx.anchors.filter(
        (a) => keepsOpener(a) && isOtherSite(a.resolved, ctx.url),
      );
      if (offending.length === 0) return null;
      const urls = [...new Set(offending.map((a) => a.resolved ?? a.href))];
      return {
        evidence: `${pluralize(offending.length, "link")} to ${pluralize(urls.length, "other address", "other addresses")} ${plural(offending.length, "keeps", "keep")} window.opener. Plain target=_blank is already safe in Chrome 88, Firefox 79 and Safari 12.1; ${plural(offending.length, "this link opts", "these links opt")} back in.`,
        excerpts: urls.slice(0, 5).map((u) => excerpt("a href", u)),
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
      "Restricted to links resolving to the page's own origin, so a footer link to a project's GitHub repository (which commonly ends in .git) is not flagged; that was a measured false positive in the previous body-wide regex version of this check. An archive (.zip, .tar.gz, .tgz) is reported only when its name or directory says it is a backup or a dump, such as backup.zip, db-dump.tar.gz or /backups/2024.zip, because a download page or a press kit links ordinary archives on purpose. Does not fetch the link to confirm the file is actually served: treat this as 'verify this path is not exposed,' not confirmation that it is.",
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
          SENSITIVE_FILE_NAME.test(pathname) ||
          isBackupArchive(pathname)
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
