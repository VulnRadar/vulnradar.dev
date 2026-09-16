/**
 * Shared helpers for detector functions.
 *
 * Lives at lib/scanner/_helpers.ts so both the registry and the per-
 * category detector modules can import the same primitives.
 */

// checks/_tag-scan.ts is the one place that knows how to walk HTML tags in a
// single forward pass. The strippers below used to carry their own
// `<tag\b[^>]*>[\s\S]*?</tag\s*>` copies of the exact shape it was written to
// replace, which is why they stayed quadratic after every detector that used
// that shape had been fixed.
import {
  openTags,
  stripTagElements,
  tagElementContents,
} from "./checks/_tag-scan";

/**
 * FNV-1a 32-bit hash → base-36 string.
 * Used so that the same check fired against the same URL always produces
 * the same finding ID, making two scans of the same site directly comparable.
 */
function fnvHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

/**
 * Stable, deterministic finding ID: `<checkId>--<hash>`.
 * Two scans of the same URL produce the same IDs for the same findings,
 * enabling reliable diffing between scans.
 *
 * `distinguisher`, when given, is folded into the hash alongside `url`. A
 * check's `run()` is allowed to return more than one `CheckHit` for a single
 * page (see check-types.ts's `CheckHit | CheckHit[] | null`), and without a
 * per-hit distinguisher every hit from that check on that page would
 * collapse onto the exact same id: a React list key collision, and a
 * false_positive mark on one hit (scan_finding_feedback is keyed on this id)
 * silently suppressing the other, unrelated hit too. Leaving it undefined
 * (every single-hit check, which is the overwhelming majority) reproduces
 * the exact id this function has always produced, so existing feedback rows
 * and regression-alert baselines keyed on the old id stay valid.
 */
export function generateId(
  checkId: string,
  url: string,
  distinguisher?: string,
): string {
  const hashInput = distinguisher ? `${url} ${distinguisher}` : url;
  return `${checkId}--${fnvHash(hashInput)}`;
}

export function getHeader(headers: Headers, key: string): string | null {
  // Headers.get() throws TypeError for forbidden header names (those
  // starting with ":" — pseudo-headers — and any name containing
  // non-token characters). Detectors occasionally probe for these
  // (e.g. http-no-redirect checks for ":status"); swallow the error
  // and return null so the detector can fall back to a regular
  // header check rather than crashing the scan.
  try {
    return headers.get(key);
  } catch {
    return null;
  }
}

export function hasHeader(headers: Headers, key: string): boolean {
  // Same forbidden-name protection as getHeader: detect() will throw
  // TypeError for keys starting with ":" or containing non-token
  // characters, which would crash a scan mid-flight. Treat as absent.
  try {
    return headers.has(key);
  } catch {
    return false;
  }
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The CSP header string plus any <meta http-equiv="Content-Security-Policy">
 * content, concatenated. A meta-tag CSP is exactly as binding on the
 * browser as the header (a page can carry one and not the other, or
 * different directives in each -- both apply), so "is directive X present"
 * checks need to see both, not just the header. Was previously only done
 * ad hoc in csp-frame-src-missing (lib/scanner/checks/headers.ts); every
 * other CSP check silently ignored a meta-only CSP, either wrongly
 * reporting "no CSP at all" (csp-missing) or wrongly skipping a directive
 * check entirely, since the header string alone was empty.
 */
export function getEffectiveCsp(headers: Headers, body: string): string {
  const headerCsp = getHeader(headers, "content-security-policy") || "";
  // `<meta\b[^>]*ATTR[^>]*>` is the spliced shape checks/_tag-scan.ts exists
  // to replace, and this helper is on the hot path of the whole CSP family:
  // on a 256 KB body of unterminated <meta> tags each of csp-missing,
  // csp-no-default-src, csp-base-uri-missing, csp-frame-src-missing and
  // csp-form-action-missing measured about 3.1 SECONDS, all of it here.
  // Unbounded on purpose, which is what the pattern this replaces was: a
  // strict policy with a long source list or a set of hashes runs past 2000
  // characters, and missing it here would report "no CSP at all" on a page
  // that has a perfectly good one.
  const metaTag = openTags(body, "meta", Infinity).find((t) =>
    /http-equiv=["']?content-security-policy["']?/i.test(t),
  );
  // A real CSP value is full of single quotes ('self', 'unsafe-inline',
  // ...), so a shared [^"']* class terminates at the FIRST one -- e.g.
  // content="default-src 'self'; form-action 'self'" would capture only
  // "default-src " and silently drop everything after it. Match
  // double-quoted and single-quoted attribute forms separately instead,
  // each only stopping at ITS OWN quote character.
  const metaCsp =
    metaTag?.match(/content="([^"]*)"/i)?.[1] ??
    metaTag?.match(/content='([^']*)'/i)?.[1] ??
    "";
  if (headerCsp && metaCsp) return `${headerCsp}; ${metaCsp}`;
  return headerCsp || metaCsp;
}

/**
 * Cookie parsing helpers.
 */
export function getSetCookies(headers: Headers): string[] {
  // `Headers.getSetCookie()` is the standard API; fall back to scanning
  // comma-joined values if the runtime doesn't support it.
  if (
    typeof (headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie === "function"
  ) {
    return (
      headers as unknown as { getSetCookie: () => string[] }
    ).getSetCookie();
  }
  const all: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") all.push(value);
  });
  return all;
}

export function parseCookieName(cookie: string): string {
  return cookie.split("=")[0]?.trim() ?? "";
}

/**
 * True when a single Set-Cookie string carries the given attribute
 * (e.g. "Secure", "HttpOnly", "SameSite"). Splits on ';' and matches the
 * attribute TOKEN, skipping the leading name=value segment -- a naive
 * `cookie.includes("secure")` treats `sid=x; Domain=secure.example.com` (the
 * word "secure" is in the domain) or a `__Secure-`/`session` NAME as having the
 * flag, which silently suppressed missing-Secure/HttpOnly/SameSite findings on
 * real session cookies. Matches both boolean flags ("secure") and valued
 * attributes ("samesite=lax").
 */
export function cookieHasAttribute(cookie: string, attribute: string): boolean {
  const attr = attribute.toLowerCase();
  const parts = cookie.split(";").slice(1); // drop name=value; keep attributes
  for (const part of parts) {
    const token = part.trim().toLowerCase();
    if (token === attr || token.startsWith(`${attr}=`)) return true;
  }
  return false;
}

export type EvidenceFn = (
  url: string,
  headers: Headers,
  body: string,
) => string | null;

/** Tags a documentation or tutorial page uses to render example code as
 *  literal text. */
const DOC_BLOCK_TAGS = ["code", "pre", "kbd", "samp"] as const;

/**
 * Strip `<script>` and code/example regions (`<code>`, `<pre>`, `<kbd>`,
 * `<samp>`, `<template>`) from a response body for regex matching.
 *
 * Does NOT strip `<style>` or HTML comments, because secrets/PII detectors
 * intentionally still scan those regions (e.g. a leaked token left in an
 * HTML comment is a real finding). It DOES strip `<code>/<pre>/<kbd>/<samp>`
 * so that documentation pages showing example payloads, IPs, or credit-card
 * numbers as sample text don't self-trigger the same detectors.
 *
 * The result is never treated as sanitized HTML or rendered anywhere, so an
 * incomplete strip changes detection accuracy, not security.
 */
export function stripExampleContent(input: string): string {
  return stripTagElements(stripTagElements(input, ["script"]), [
    ...DOC_BLOCK_TAGS,
    "template",
  ]);
}

/**
 * Strip documentation/example rendering regions (`<code>`, `<pre>`, `<kbd>`,
 * `<samp>`) from a response body, WITHOUT touching `<script>` content.
 *
 * Distinct from `stripExampleContent` above: that helper also removes
 * `<script>` blocks, which is wrong for detectors that specifically need
 * to inspect real inline script content (e.g. vibe-code.ts's patterns look
 * for eval(), SQL string concatenation, etc. inside actual <script> tags,
 * not inside a documentation page's <pre> block). This helper only removes
 * the tags a documentation/tutorial page uses to display example code as
 * text, so a page that *talks about* a vulnerable pattern -- this
 * product's own /docs pages included, which render every check's
 * `codeExamples` as literal "Bad (AI-generated)" snippets -- doesn't
 * self-trigger a detector meant to catch the pattern actually shipped in a
 * site's live script.
 */
export function stripDocBlocks(input: string): string {
  return stripTagElements(input, DOC_BLOCK_TAGS);
}

/**
 * `stripDocBlocks` memoised on the body it was last given.
 *
 * Three detector modules (api.ts, supply-chain.ts, vibe-code.ts) wrap EVERY
 * detector they export in a `stripDocBlocks(body)` call, which is roughly 150
 * strips of the same body per scan. Making the strip linear (see
 * `stripTagElements`) fixes the shape of the cost but not the multiplier: 150
 * linear strips of a 1 MB body is still 150 MB of copying that produces the
 * same string every time. The engine hands every detector the same body
 * string object, so a one-entry memo collapses all of it to one strip per
 * scan, across all three modules rather than one each.
 *
 * It holds one body (the 1 MB execute-scan caps at, at most) until the next
 * scan replaces it. That is deliberate and is the whole mechanism: the entry
 * has to outlive the individual detector call to be worth anything.
 */
let lastStripInput: string | null = null;
let lastStripOutput = "";

/**
 * Wrap a raw detector map so every detector sees the body with
 * documentation/example regions already removed, stripping ONCE per body
 * rather than once per detector.
 */
export function withDocBlocksStripped(
  raw: Record<string, EvidenceFn>,
): Record<string, EvidenceFn> {
  return Object.fromEntries(
    Object.entries(raw).map(([id, fn]) => [
      id,
      ((url, headers, body) => {
        if (body !== lastStripInput) {
          lastStripOutput = stripDocBlocks(body);
          lastStripInput = body;
        }
        return fn(url, headers, lastStripOutput);
      }) as EvidenceFn,
    ]),
  );
}

/**
 * A `<script>` element that holds data rather than code.
 *
 * JSON-LD is structured metadata a search engine reads, and a site's own
 * description text routinely ends up inside it. Speculation rules are a JSON
 * document too. Neither is source the site executes.
 */
const DATA_SCRIPT_TYPES =
  "application\\/(?:ld\\+)?json|speculationrules|text\\/template|text\\/x-template";
const DATA_SCRIPT_TYPE = new RegExp(
  `\\btype\\s*=\\s*["']?(?:${DATA_SCRIPT_TYPES})["']?`,
  "i",
);
const DATA_SCRIPT_TYPE_VALUE = new RegExp(
  `^\\s*(?:${DATA_SCRIPT_TYPES})\\s*$`,
  "i",
);

/**
 * Whether an inline script, given its `type` attribute and its content, is
 * source the site wrote, by the same rules {@link extractScriptContents}
 * applies. For callers that have already parsed the element.
 */
export function isAuthoredInlineScript(
  type: string | null,
  content: string,
): boolean {
  if (type && DATA_SCRIPT_TYPE_VALUE.test(type)) return false;
  return isAuthoredScriptContent(content);
}

/**
 * Every authored inline `<script>` element in a response body.
 *
 * "Authored" is the whole point, and it is what this used to get wrong. It was
 * a bare tagElementContents(input, ["script"]), so three kinds of non-source
 * reached every detector that called it.
 *
 * Next.js streams a server-rendered page back as RSC flight data through
 * self.__next_f.push(...), which carries the page's own prose serialized as a
 * JavaScript string literal. Any page that so much as mentions eval( in a
 * paragraph therefore contains eval( inside a <script> tag, and roughly twenty
 * detectors read that as the site calling eval. This product's own check
 * reference pages are the clearest case, since their entire purpose is to
 * quote dangerous code, but it applies to every documentation page, security
 * blog and framework tutorial on the internet: writing about a vulnerability
 * scored as having one.
 *
 * Cloudflare's __CF$cv$params bootstrap is injected at the edge after the
 * origin has already responded, so the site owner did not write it and cannot
 * remove it from application code.
 *
 * checks/code.ts has carried exactly this filter privately, as
 * inlineScriptContent, since those false positives were first traced there.
 * Everything else calling this helper was still reading flight payloads as
 * authored script, which is the shape of bug this codebase keeps finding: one
 * file fixed, its siblings left on the old behaviour.
 */
export function extractScriptContents(input: string): string[] {
  return tagElementContents(input, ["script"], (openingTag) => {
    return !DATA_SCRIPT_TYPE.test(openingTag) && !/\bsrc\s*=/i.test(openingTag);
  }).filter(isAuthoredScriptContent);
}

function isAuthoredScriptContent(content: string): boolean {
  return (
    !/self\.__next_f\.push\s*\(/.test(content) &&
    !/__CF\$cv\$params/.test(content)
  );
}

/**
 * Attributes whose value is written for a reader rather than a browser to
 * act on. `data-src` and `data-href` are exempt because lazy loaders put a
 * real URL there. `value` is included: on a form it is prefilled text.
 */
const PROSE_ATTRIBUTE =
  /(\s)(title|alt|placeholder|content|label|summary|value|aria-[\w-]+|data-(?!src\b|href\b)[\w-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+)/gi;

/** Regions whose content is displayed as text: examples, and form text. */
const TEXT_REGION_TAGS = [...DOC_BLOCK_TAGS, "template", "textarea"] as const;

function isTagStartCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 47 || // `</`
    code === 33 // `<!doctype`
  );
}

/**
 * A page reduced to what a browser would execute or act on: every tag with
 * its behavioural attributes, authored inline scripts and style blocks, and
 * nothing written for a reader.
 *
 * Detectors that look for a code pattern (eval(, document.write(, an HMAC
 * compared with ===, a PHP create_function() call) used to search the whole
 * response, so they matched the pattern wherever it was written down. On a
 * page ABOUT that pattern it is written down everywhere: in the headings, the
 * paragraphs, link text, a `data-*` attribute used for filtering, the page's
 * meta description, and, on a Next.js site, a second time inside the flight
 * payload that carries the page's text to the client. Stripping `<pre>` and
 * `<code>` removed only the examples. Measured on this product's own public
 * pages, over 120 checks still fired, a dozen of them at critical, on pages
 * that contain no script of their own at all, and every security blog,
 * documentation site and OWASP cheat sheet on the internet reads the same way.
 *
 * What is removed: text between tags, HTML comments, the example and text
 * regions (pre, code, kbd, samp, template, textarea), script elements that
 * hold data or somebody else's code (JSON-LD, speculation rules, templates,
 * Next.js flight payloads, Cloudflare's edge bootstrap), and the values of
 * prose attributes (title, alt, placeholder, content, label, value, aria-*,
 * data-*). What is kept, unchanged: every tag and its remaining attributes,
 * which is where inline event handlers, javascript: URLs, form actions and
 * script sources live, authored inline script, and style.
 *
 * A response that is not markup (a JavaScript file, JSON, a served source
 * file) is returned as it is, because all of it is the code.
 *
 * Detectors that need page text (error pages, stack traces, debug output,
 * secrets printed into the page) must NOT read this view: for them the text is
 * the evidence. Each module states which of its detectors those are.
 *
 * One forward pass whose cursors never move back, the same rule as
 * checks/_tag-scan.ts, so a hostile page costs linear time.
 */
export function stripProse(body: string): string {
  if (body === lastProseInput) return lastProseOutput;
  lastProseOutput = buildProseView(body);
  lastProseInput = body;
  return lastProseOutput;
}

let lastProseInput: string | null = null;
let lastProseOutput = "";

const HTML_ELEMENT_START =
  /^<(?:!doctype\s+html|html|head|body|meta|link|script|style|title|base|noscript|div|span|p|a|main|section|article|header|footer|nav|aside|form|input|button|table|ul|ol|li|img|svg|iframe|h[1-6]|br|hr|pre|code|template)\b/i;

/**
 * An HTML document or fragment: optional whitespace and comments, then an
 * HTML element. XML is not, however much it looks like markup: a served
 * pom.xml, WSDL or sitemap carries its evidence in text nodes, and the prose
 * view would drop exactly that.
 *
 * Written as a loop rather than one regex. The regex it replaced wrapped a
 * lazy comment body in a repeated group, and a comment body can itself
 * contain "-->", so a page opening with a run of comments and then no
 * element had exponentially many ways to fail: 22 comments took 117ms and
 * each two more quadrupled it, on a body the scanned site controls. Each
 * comment here is skipped with one indexOf, so the cost is linear.
 */
function looksLikeHtml(head: string): boolean {
  let i = 0;
  for (;;) {
    while (i < head.length && /\s/.test(head[i])) i++;
    if (!head.startsWith("<!--", i)) break;
    const end = head.indexOf("-->", i + 4);
    if (end === -1) return false;
    i = end + 3;
  }
  return HTML_ELEMENT_START.test(head.slice(i, i + 64));
}

function buildProseView(body: string): string {
  if (!body || !looksLikeHtml(body.slice(0, 4096))) return body;
  const input = stripTagElements(body, TEXT_REGION_TAGS);
  const out: string[] = [];
  const closers: Record<string, RegExp> = {
    script: /<\/script\s*>/gi,
    style: /<\/style\s*>/gi,
  };
  let i = 0;
  let gt = -1;

  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt === -1) break;
    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    if (!isTagStartCode(input.charCodeAt(lt + 1))) {
      i = lt + 1;
      continue;
    }
    if (gt <= lt) {
      gt = input.indexOf(">", lt);
      if (gt === -1) break;
    }
    const tag = input.slice(lt, gt + 1);
    i = gt + 1;

    const raw = /^<(script|style)\b/i.exec(tag);
    if (raw) {
      const name = raw[1].toLowerCase();
      const closer = closers[name];
      closer.lastIndex = i;
      const close = closer.exec(input);
      const contentEnd = close ? close.index : input.length;
      const content = input.slice(i, contentEnd);
      i = close ? close.index + close[0].length : input.length;
      // One piece per element, so the element reads exactly as it was served.
      if (name === "style") {
        out.push(`${tag}${content}</style>`);
      } else if (/\bsrc\s*=/i.test(tag)) {
        out.push(`${tag}</script>`);
      } else if (
        !DATA_SCRIPT_TYPE.test(tag) &&
        isAuthoredScriptContent(content)
      ) {
        out.push(`${tag}${content}</script>`);
      }
      continue;
    }

    PROSE_ATTRIBUTE.lastIndex = 0;
    out.push(tag.replace(PROSE_ATTRIBUTE, '$1$2$3""'));
  }

  return out.join("\n");
}

/**
 * Wrap a raw detector map so every detector sees {@link stripProse}'s view of
 * the body, computed once per body however many detectors read it: the view
 * is memoised on the body, the same way {@link withDocBlocksStripped} is.
 */
export function withProseStripped(
  raw: Record<string, EvidenceFn>,
): Record<string, EvidenceFn> {
  return Object.fromEntries(
    Object.entries(raw).map(([id, fn]) => [
      id,
      ((url, headers, body) =>
        fn(url, headers, stripProse(body))) as EvidenceFn,
    ]),
  );
}

interface ExampleJudge {
  body: string;
  /** The page with example blocks and flight payloads removed. */
  outside: string;
  /** Example block text, with the entities a renderer escapes decoded. */
  examples: string;
  /** Next.js flight payload script text. */
  payload: string;
}
let lastJudge: ExampleJudge | null = null;

function exampleJudge(body: string): ExampleJudge {
  if (lastJudge?.body === body) return lastJudge;
  const payloadScripts = tagElementContents(body, ["script"]).filter((c) =>
    /self\.__next_f\.push\s*\(/.test(c),
  );
  let withoutPayload = body;
  for (const p of payloadScripts)
    withoutPayload = withoutPayload.split(p).join("");
  lastJudge = {
    body,
    outside: stripDocBlocks(withoutPayload),
    examples: tagElementContents(body, DOC_BLOCK_TAGS)
      .join("\n")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
    payload: payloadScripts.join("\n"),
  };
  return lastJudge;
}

/**
 * Whether a secret-shaped string matched somewhere in `body` is being shown as
 * an example rather than leaked.
 *
 * Shown anywhere outside <code>, <pre>, <kbd> and <samp>, it is a finding.
 * Inside only those, it is an example. The case that needed this helper is
 * the third place a Next.js page carries text: the flight payload, which
 * repeats every code example as a JSON string literal. Its copy sat outside
 * the example blocks, so a connection string shown in a setup guide was
 * reported as a critical leak. A value found only in the payload is therefore
 * an example when the same value, up to the first JSON escape, is in an
 * example block, and a finding otherwise, because a server component passing
 * a secret to a client component puts it in the payload and nowhere else.
 */
export function isDemonstratedExample(body: string, match: string): boolean {
  const judge = exampleJudge(body);
  if (judge.outside.includes(match)) return false;
  if (!judge.payload.includes(match)) return true;
  const core = match.split("\\")[0];
  return core.length >= 8 && judge.examples.includes(core);
}

/**
 * Detect whether the response body belongs to a SPA framework page.
 *
 * Used to suppress body-regex detectors that would over-fire on
 * framework-emitted JS or hydration markup.
 */
export function isFrameworkPage(body: string): boolean {
  return (
    body.includes("__NEXT_DATA__") ||
    body.includes("__nuxt") ||
    body.includes("/_next/") ||
    body.includes("/_nuxt/") ||
    body.includes("__REACT") ||
    body.includes("data-reactroot") ||
    body.includes("ng-version") ||
    body.includes('id="__svelte')
  );
}

/**
 * Redact a secret value to `prefix****suffix` shape, preserving only
 * the first `prefixLen` and last `suffixLen` characters. Used by
 * secret-detection checks so scan logs and the `evidence` field never
 * contain the full secret.
 */
export function redactSecret(
  value: string,
  prefixLen = 4,
  suffixLen = 4,
): string {
  if (value.length <= prefixLen + suffixLen + 4) {
    return value.slice(0, 2) + "****";
  }
  return (
    value.slice(0, prefixLen) + "****" + value.slice(value.length - suffixLen)
  );
}
