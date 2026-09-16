import { randomBytes } from "node:crypto";
import { safeFetch } from "../safe-fetch";
import { stripTagElements } from "../checks/_tag-scan";
import type { Vulnerability } from "../types";
import {
  buildFinding,
  buildProbeRequest,
  discoverProbableForms,
} from "./shared";

/**
 * Elements whose content the HTML parser reads as text, or parses but never
 * renders, so a `<canary>` inside one is not a tag: textarea and title are
 * RCDATA, script, style, xmp and noscript (with scripting on) are raw text,
 * and template content is inert.
 */
const INERT_ELEMENTS = [
  "textarea",
  "title",
  "script",
  "style",
  "xmp",
  "noscript",
  "template",
];

/**
 * Whether `marker` appears where a browser would parse it as a tag.
 *
 * `includes` alone reported a critical XSS for a canary echoed into a
 * textarea (the normal way a form redisplays what was typed), a page title
 * ("Search results for <canary>"), an HTML comment, or a quoted attribute
 * value, none of which executes. Those are the most common reflections there
 * are, and none of them is cross-site scripting.
 */
export function reflectsAsMarkup(html: string, marker: string): boolean {
  let body = stripTagElements(html, INERT_ELEMENTS);
  // Comments, one forward pass.
  const parts: string[] = [];
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf("<!--", i);
    if (open === -1) {
      parts.push(body.slice(i));
      break;
    }
    parts.push(body.slice(i, open));
    const close = body.indexOf("-->", open + 4);
    if (close === -1) break;
    i = close + 3;
  }
  body = parts.join("");
  let at = body.indexOf(marker);
  while (at !== -1) {
    // Inside another tag's attributes: the last "<" before it is later than
    // the last ">", so the marker is part of an attribute value.
    const insideTag =
      body.lastIndexOf("<", at - 1) > body.lastIndexOf(">", at - 1);
    if (!insideTag) return true;
    at = body.indexOf(marker, at + marker.length);
  }
  return false;
}

/**
 * Fetches `url`, finds every form on the page, and submits each one (up to
 * MAX_FORMS_TO_PROBE) with a unique per-form canary value in every testable
 * field. A form is flagged when the canary comes back in the response
 * unescaped -- proof the target reflects that input without sanitizing it.
 *
 * Fails open (returns []) on any error at any stage: a missing page, an
 * unreachable target, a form whose action fails safeFetch's hostname/SSRF
 * checks, or a submission that errors out. A failure here must never crash
 * the scan or produce a false positive; the worst outcome of an outage is
 * an under-report (this form wasn't probed), never a wrong finding.
 */
export async function checkActiveProbes(
  url: string,
  cancelSignal?: AbortSignal,
): Promise<Vulnerability[]> {
  const discovered = await discoverProbableForms(url, cancelSignal);
  if (!discovered) return [];
  const { hostname, forms } = discovered;

  const findings: Vulnerability[] = [];

  for (const [formIndex, form] of forms.entries()) {
    // Cancellation must stop new submissions from going out, not just abort
    // whichever one is already in flight (that part is handled inside
    // buildProbeRequest/probeSignal).
    if (cancelSignal?.aborted) break;
    // Unique per form: two forms flagged on the same page must not collide
    // on the literal marker one contains showing up in the other's probe.
    const canary = `vr${randomBytes(4).toString("hex")}xss`;
    const marker = `<${canary}>`;

    try {
      const { url: probeUrl, init } = buildProbeRequest(
        form.action,
        form.method,
        form.hiddenFields,
        form.testableFields,
        marker,
        cancelSignal,
      );
      const res = await safeFetch(probeUrl, init, [hostname]);
      // A JSON/plaintext API response can contain the literal marker (JSON
      // string encoding doesn't escape < or >) without it ever being parsed
      // as HTML by a browser, so only treat this as confirmed reflected XSS
      // when the response is actually HTML.
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType && !/^text\/html/i.test(contentType)) {
        continue;
      }
      const responseText = await res.text();
      // No Content-Type at all is a real, common backend misconfiguration
      // (not hypothetical) -- trusting that as "possibly HTML" let a JSON
      // API omitting the header (e.g. {"error":"invalid value for field:
      // <canary>"}) get "confirmed" as reflected XSS even though a
      // browser's MIME-sniffing would never render/execute it. Sniff the
      // body's own shape instead of guessing: a response beginning with
      // `{` or `[` (after whitespace) is JSON-shaped, not HTML, regardless
      // of what header (or lack of one) it came with.
      if (!contentType && /^\s*[{[]/.test(responseText)) {
        continue;
      }
      if (reflectsAsMarkup(responseText, marker)) {
        // form.action alone isn't a unique distinguisher: two different
        // forms on the same page (a header search box and a body search
        // form, say) can share the same action URL, which would collapse
        // both findings onto the same generateId() hash -- see _helpers.ts.
        // Folding in the form's index and field set keeps them distinct
        // even when the action and the fields are both identical.
        const distinguisher = `${form.action}#${formIndex}:${form.testableFields.join(",")}`;
        const finding = buildFinding(
          "reflected-input-xss",
          url,
          distinguisher,
          `A canary value submitted through the form at ${form.action} was reflected unescaped in the response.`,
        );
        if (finding) findings.push(finding);
      }
    } catch {
      continue; // this form's probe failed -- move on to the next candidate
    }
  }

  return findings;
}
