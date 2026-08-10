/**
 * Structured mixed-content detection.
 *
 * The legacy `mixed-content` detector (`checks/headers.ts`) regexes
 * `src=/href=/action="http://..."` across the whole raw body, so a JavaScript
 * string literal containing that text is indistinguishable from a real
 * attribute, and a script written as `src = "http://x"` via a template
 * literal or concatenation is missed entirely. This check reads the resolved
 * origin the tokenizer already computed for every script, stylesheet, and
 * frame, so it only fires on resources the browser will actually request
 * over plain HTTP.
 */

import type { PageCheck } from "../../check-types";
import { excerpt } from "../../check-types";
import type { Element } from "../../html/tokenizer";

function isHttp(resolved: string | null): boolean {
  return resolved !== null && resolved.startsWith("http://");
}

const PASSIVE_MEDIA_TAGS = new Set([
  "img",
  "video",
  "audio",
  "source",
  "embed",
  "object",
]);

function passiveMediaSrc(el: Element, pageUrl: string): string | null {
  const raw = el.attrs["src"] ?? el.attrs["data"];
  if (!raw) return null;
  try {
    return new URL(raw, pageUrl).href;
  } catch {
    return null;
  }
}

const SENSITIVE_FRAME_PATH =
  /\/(?:admin|wp-admin|administrator|account|accounts|dashboard|settings|billing|payment|checkout|login|signin|auth|internal)(?:\/|$)/i;

function pathnameOf(resolved: string | null): string | null {
  if (!resolved) return null;
  try {
    return new URL(resolved).pathname;
  } catch {
    return null;
  }
}

export const mixedContentChecks: PageCheck[] = [
  {
    id: "page-mixed-content-active",
    title: "Active mixed content: script or stylesheet loaded over HTTP",
    category: "content",
    severity: "high",
    method: "dom-structure",
    description: "An HTTPS page loads a script or stylesheet over plain HTTP.",
    riskImpact:
      "Scripts and stylesheets loaded over HTTP can be modified in transit by anyone on the network path, giving them the same execution capability as the page itself. Modern browsers block this outright, so the resource (and anything that depends on it) silently fails to load.",
    explanation:
      "'Active' mixed content is content capable of modifying the page (scripts, stylesheets, iframes). Browsers block it by default rather than merely warning, unlike 'passive' mixed content such as images.",
    fixSteps: [
      "Change the resource URL to https://.",
      "If the third party does not support HTTPS, self-host the resource instead.",
    ],
    codeExamples: [],
    needs: ["html", "https"],
    dedupeGroup: "mixed-content",
    run(ctx) {
      if (!ctx.isHttps) return null;
      const scripts = ctx.scripts.filter((s) => isHttp(s.resolved));
      const styles = ctx.stylesheets.filter((s) => isHttp(s.resolved));
      const frames = ctx.frames.filter((f) => isHttp(f.resolved));
      const total = scripts.length + styles.length + frames.length;
      if (total === 0) return null;
      const excerpts = [
        ...scripts.map((s) => excerpt("script src", s.resolved!)),
        ...styles.map((s) => excerpt("stylesheet href", s.resolved!)),
        ...frames.map((f) => excerpt("iframe src", f.resolved!)),
      ];
      return {
        evidence: `${total} active resource(s) loaded over HTTP on an HTTPS page (${scripts.length} script, ${styles.length} stylesheet, ${frames.length} frame).`,
        excerpts,
      };
    },
  },

  {
    id: "page-third-party-iframe-no-sandbox",
    title: "Third-party iframe without a sandbox attribute",
    category: "content",
    severity: "low",
    method: "dom-structure",
    confidence: 78,
    description:
      "A frame embeds a third-party origin without a sandbox attribute restricting what the embedded page can do.",
    riskImpact:
      "Without sandbox, the embedded page can run scripts, submit forms, open popups, and navigate the top-level page (unless separately restricted), all with the embedding page's implicit trust. Routine, legitimate embeds (video players, maps, payment widgets, chat widgets) commonly omit sandbox because it would break required functionality, so this fires on most sites that embed any third-party widget and is a hardening suggestion rather than a confirmed defect.",
    explanation:
      "The sandbox attribute, even with a permissive value, requires the embedder to explicitly opt in to each capability rather than granting all of them by default.",
    fixSteps: [
      "Add a sandbox attribute scoped to only the capabilities the embed needs.",
      "Combine with allow= for any specific permissions policy features that are required.",
    ],
    codeExamples: [
      {
        label: "Restricted iframe",
        language: "html",
        code: '<iframe src="https://widget.example.com" sandbox="allow-scripts allow-same-origin"></iframe>',
      },
    ],
    needs: ["html"],
    run(ctx) {
      const offending = ctx.frames.filter(
        (f) => f.thirdParty && f.sandbox === null,
      );
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} third-party iframe(s) without a sandbox attribute.`,
        excerpts: offending.map((f) =>
          excerpt("iframe src", f.resolved ?? f.src ?? ""),
        ),
      };
    },
  },

  {
    id: "page-mixed-content-passive",
    title: "Passive mixed content: image or media loaded over HTTP",
    category: "content",
    severity: "low",
    method: "dom-structure",
    confidence: 80,
    description:
      "An HTTPS page loads an image, video, audio, or embedded object over plain HTTP.",
    riskImpact:
      "Passive mixed content cannot modify the page the way an HTTP script or stylesheet can, but it is still visible to, and can be substituted by, anyone on the network path, and browsers show a degraded security indicator for it.",
    explanation:
      "'Passive' mixed content (images, video, audio, object/embed data) is not blocked by browsers by default the way active mixed content (scripts, stylesheets, covered by page-mixed-content-active) is; it is allowed to load with a weaker security indicator instead. This check resolves every <img>, <video>, <audio>, <source>, <embed>, and <object> element's src/data attribute against the page URL.",
    fixSteps: [
      "Change the resource URL to https://.",
      "Self-host the asset if the third party does not support HTTPS.",
    ],
    codeExamples: [],
    needs: ["html", "https"],
    dedupeGroup: "mixed-content-passive",
    run(ctx) {
      if (!ctx.isHttps) return null;
      const offending: string[] = [];
      for (const el of ctx.elements) {
        if (!PASSIVE_MEDIA_TAGS.has(el.tag)) continue;
        const resolved = passiveMediaSrc(el, ctx.url);
        if (resolved && isHttp(resolved)) offending.push(resolved);
      }
      if (offending.length === 0) return null;
      const unique = [...new Set(offending)];
      return {
        evidence: `${unique.length} image/media resource(s) loaded over HTTP on an HTTPS page.`,
        excerpts: unique.slice(0, 10).map((u) => excerpt("resource src", u)),
      };
    },
  },

  {
    id: "page-cross-origin-iframe-sensitive-path",
    title: "Cross-origin iframe embeds a sensitive-looking path",
    category: "content",
    severity: "medium",
    method: "url-pattern",
    confidence: 55,
    description:
      "An iframe embeds a third-party origin at a path that looks like an admin, account, billing, or authentication page rather than a widget or embed endpoint.",
    riskImpact:
      "Framing an authenticated, sensitive page opens it to UI-redress (clickjacking) techniques if the framed origin does not itself restrict framing, and is unusual enough on a legitimate page to be worth confirming was intentional.",
    explanation:
      "This is a path-naming heuristic only: some legitimate embeds (a support widget's own /dashboard route, for instance) will coincidentally match. Confirm the embed is an intended integration and that the framed origin restricts its own framing appropriately.",
    fixSteps: [
      "Confirm this iframe is an intended, first-party-controlled integration.",
      "If it embeds a page meant for a different, authenticated context, remove the embed or restrict access at the framed origin.",
    ],
    codeExamples: [],
    needs: ["html"],
    run(ctx) {
      const offending = ctx.frames.filter((f) => {
        if (!f.thirdParty) return false;
        const pathname = pathnameOf(f.resolved);
        return pathname !== null && SENSITIVE_FRAME_PATH.test(pathname);
      });
      if (offending.length === 0) return null;
      return {
        evidence: `${offending.length} cross-origin iframe(s) embed a sensitive-looking path.`,
        excerpts: offending.map((f) =>
          excerpt("iframe src", f.resolved ?? f.src ?? ""),
        ),
      };
    },
  },
];
