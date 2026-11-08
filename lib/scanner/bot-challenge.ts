/**
 * A site that answers the scanner with a bot challenge instead of its page.
 *
 * Behind Cloudflare's bot protection (and similar services) an automated
 * request gets a "Just a moment..." interstitial with a 403, and every check
 * that reads the response was grading that interstitial as the site. A scan
 * of such a site reported Cloudflare's missing Vary header and Cloudflare's
 * Server-Timing as the site's own findings, which an AI re-check that got
 * through to the real page then marked as false positives. None of it was
 * about the site.
 *
 * The response is only treated as a challenge on a signal that means exactly
 * that: a header or element only the challenge itself produces, or a blocking
 * status together with a challenge page's title, bootstrap or shape. Cloudflare
 * injects /cdn-cgi/challenge-platform/ scripts into ordinary pages it serves,
 * so that path alone is not a challenge and is deliberately not a marker here.
 *
 * Vendor markers are the ones the vendor documents or ships in its own source.
 * A vendor left out here still loses nothing that matters: its block page
 * arrives with a refusal status, which response-classifier.ts does not grade
 * either, and is reported as blocked rather than as a challenge.
 */

import { tokenize } from "./html/tokenizer";

/** The area a challenged scan lists as not checked (lib/scanner/incomplete-labels.ts). */
export const BOT_CHALLENGE_INCOMPLETE = "bot-challenge";

/** Titles challenge interstitials are served with. Shared with the login flow. */
export const CHALLENGE_TITLE_MARKERS: readonly RegExp[] = [
  /just a moment/i,
  /attention required.*cloudflare/i,
  /checking your browser/i,
  /verifying you are human/i,
  /one more step/i,
  /please wait.*redirecting/i,
];

/**
 * Titles that only mean a challenge on a blocking status, kept out of the list
 * above because auth/browser-login.ts matches that one with no status check:
 * an SSO hand-off titled "Please wait" would fail a login as a bot wall.
 */
const BLOCKING_STATUS_TITLE_MARKERS: readonly RegExp[] = [
  ...CHALLENGE_TITLE_MARKERS,
  /^\s*please wait\b/i,
  /vercel security checkpoint/i,
];

/**
 * Headers a challenge sets and nothing else does, so they count on any status.
 * AWS WAF is why that matters: it answers a challenge with 202 and a CAPTCHA
 * with 405, and neither is a blocking status.
 */
const CHALLENGE_HEADERS: readonly {
  name: string;
  value: RegExp;
  reason: string;
}[] = [
  {
    name: "cf-mitigated",
    value: /challenge/i,
    reason: "cf-mitigated: challenge",
  },
  {
    name: "x-amzn-waf-action",
    value: /^(?:challenge|captcha)$/i,
    reason: "x-amzn-waf-action: challenge or captcha",
  },
];

/**
 * Anubis renders this element on its own pages only, and can be configured to
 * send its gate with a 200. Matching the literal start tag means an article
 * showing the markup, which has it escaped, does not count.
 */
const ANUBIS_CHALLENGE_ELEMENT =
  /<script\b[^>]{0,200}\bid=["']?anubis_challenge\b/i;

/** Markup only a Cloudflare challenge page's bootstrap contains. */
const CHALLENGE_BOOTSTRAP =
  /cf_chl_opt|window\._cf_chl|cf-browser-verification/i;

/** Block-page markup, only meaningful on a blocking status. */
const VENDOR_BODY_MARKERS: readonly { vendor: string; marker: RegExp }[] = [
  { vendor: "DataDome", marker: /captcha-delivery\.com/i },
  { vendor: "HUMAN", marker: /\bid=["']?px-captcha\b/i },
];

const BLOCKING_STATUSES = new Set([403, 429, 503]);

/**
 * The shape of a proof-of-work gate whose title says nothing: one long inline
 * script and next to no words. Measured on recorded gates (6 to 7 KB of script
 * around a "Loading..." spinner); a maintenance page has words, and a single
 * page app's shell is served with a 200 and never reaches this check.
 */
const MIN_GATE_SCRIPT_CHARS = 1_500;
const MAX_GATE_VISIBLE_CHARS = 60;

/**
 * Elements whose text a visitor running the gate never reads. `noscript` is
 * here because the gate's own "please enable JavaScript" must not count as the
 * words that would make it a real page.
 */
const HIDDEN_TEXT_TAGS = new Set(["script", "style", "title", "noscript"]);

/**
 * Whether an inline script is code. The test is loose on purpose: Rocket
 * Loader rewrites `type` to `<hash>-text/javascript`, and a JSON state blob
 * is the thing to exclude.
 */
function isExecutableScriptType(type: string | undefined): boolean {
  return !type || /javascript|ecmascript|module/i.test(type);
}

function isScriptOnlyPage(head: string): boolean {
  let longestScript = 0;
  let visibleChars = 0;
  let inScript = false;
  let hiddenDepth = 0;

  for (const token of tokenize(head)) {
    if (token.kind === "start") {
      if (token.tag === "script") {
        inScript =
          token.attrs.src === undefined &&
          isExecutableScriptType(token.attrs.type);
      }
      if (HIDDEN_TEXT_TAGS.has(token.tag) && !token.selfClosing) hiddenDepth++;
    } else if (token.kind === "end") {
      if (token.tag === "script") inScript = false;
      if (HIDDEN_TEXT_TAGS.has(token.tag) && hiddenDepth > 0) hiddenDepth--;
    } else if (token.kind === "text") {
      if (inScript) longestScript = Math.max(longestScript, token.text.length);
      else if (hiddenDepth === 0) visibleChars += token.text.trim().length;
    }
  }
  return (
    longestScript >= MIN_GATE_SCRIPT_CHARS &&
    visibleChars < MAX_GATE_VISIBLE_CHARS
  );
}

/**
 * The signal that identified a bot challenge, or null when the response looks
 * like the site's own page.
 */
export function detectBotChallenge(
  status: number,
  headers: Headers,
  body: string,
): string | null {
  for (const { name, value, reason } of CHALLENGE_HEADERS) {
    const sent = headers.get(name);
    if (sent && value.test(sent.trim())) return reason;
  }

  const head = body.slice(0, 32_768);
  if (ANUBIS_CHALLENGE_ELEMENT.test(head)) return "Anubis challenge page";
  if (!BLOCKING_STATUSES.has(status)) return null;

  // Lazy and not `[^<]`: a real gate is titled "Please wait... <3", and
  // stopping at that "<" read the whole title as empty.
  const title =
    /<title[^>]{0,200}>([\s\S]{0,200}?)<\/title>/i.exec(head)?.[1] ?? "";
  if (BLOCKING_STATUS_TITLE_MARKERS.some((re) => re.test(title))) {
    return `HTTP ${status} with a challenge page title`;
  }
  if (CHALLENGE_BOOTSTRAP.test(head)) {
    return `HTTP ${status} with a challenge page script`;
  }
  if (headers.has("x-dd-b")) return `HTTP ${status} with a DataDome header`;
  for (const { vendor, marker } of VENDOR_BODY_MARKERS) {
    if (marker.test(head)) return `HTTP ${status} with a ${vendor} block page`;
  }
  if (isScriptOnlyPage(head)) return `HTTP ${status} with a script-only page`;
  return null;
}
