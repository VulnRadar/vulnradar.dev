/**
 * Dependency-free tolerant HTML tokenizer.
 *
 * The scanner previously matched regexes against the raw response body. That
 * approach mis-reads any page where markup appears inside a JavaScript string
 * (`var t = "<form action=http://x>"`), where an attribute value contains `>`,
 * or where a tag spans several lines. Both directions of error show up in
 * practice: missed findings on minified pages, and false positives on pages
 * that merely talk about HTML.
 *
 * This tokenizer follows the parts of the HTML5 tokenizer that matter for
 * static analysis:
 *
 *   - raw-text elements (script, style, textarea, title, xmp, iframe,
 *     noembed, noframes) consume everything up to their matching end tag, so
 *     `</div>` inside a script body never closes an element,
 *   - attribute values may be double quoted, single quoted, or unquoted,
 *   - comments, doctypes and CDATA sections are recognised as their own
 *     token kinds rather than being stripped by a greedy regex,
 *   - void elements and self-closing syntax are both handled.
 *
 * It does not build a spec-compliant DOM: no implied end tags, no foster
 * parenting, no entity decoding beyond the handful in `decodeEntities`. A
 * flat token stream plus a shallow element index answers every question the
 * detection checks ask, and it cannot be tricked by content that merely looks
 * like markup.
 */

/** Elements whose content is text, never markup. */
const RAW_TEXT_TAGS = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "noembed",
  "noframes",
  "iframe",
]);

/** Elements that never have an end tag. */
export const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export interface StartTagToken {
  kind: "start";
  tag: string;
  attrs: Record<string, string>;
  /** Attribute names in source order, lowercased. */
  attrOrder: string[];
  selfClosing: boolean;
  /** Offset of the `<` in the source. */
  start: number;
  /** Offset just past the `>` in the source. */
  end: number;
  /** Raw source of the tag, e.g. `<a href="/x">`. */
  raw: string;
}

export interface EndTagToken {
  kind: "end";
  tag: string;
  start: number;
  end: number;
}

export interface TextToken {
  kind: "text";
  text: string;
  start: number;
  end: number;
}

export interface CommentToken {
  kind: "comment";
  text: string;
  start: number;
  end: number;
}

export interface DoctypeToken {
  kind: "doctype";
  text: string;
  start: number;
  end: number;
}

export type Token =
  StartTagToken | EndTagToken | TextToken | CommentToken | DoctypeToken;

const NAME_START = /[a-zA-Z]/;
const NAME_CHAR = /[^\s/>]/;

/**
 * The named references decodeEntities knows, spelled exactly as the HTML
 * table spells them: it has &QUOT; and &AMP; but no &Quot;.
 */
const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  QUOT: '"',
  apos: "'",
  lt: "<",
  LT: "<",
  gt: ">",
  GT: ">",
  nbsp: " ",
  amp: "&",
  AMP: "&",
};

/**
 * Decode the entity forms that appear in attribute values often enough to
 * change a security verdict. Full entity tables are not worth the weight: a
 * URL written as `http&#58;//x` is the only realistic evasion and numeric
 * references cover it.
 *
 * It follows the browser's attribute rules, because the authenticated scan
 * replays these values as a browser would submit them. One pass, so `&#38;lt;`
 * becomes `&lt;` and not `<`. A named reference without its semicolon is left
 * alone when a letter, digit or `=` follows, so `?tab=1&gtm=GTM-1` keeps its
 * `&gtm` parameter; `&apos` is never decoded without one.
 */
export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(
    /&(?:#x([0-9a-f]+);?|#(\d+);?|([a-z]+)(;?))/gi,
    (
      match: string,
      hex: string | undefined,
      dec: string | undefined,
      name: string | undefined,
      semicolon: string,
      offset: number,
      whole: string,
    ) => {
      if (name === undefined) {
        const code = hex !== undefined ? parseInt(hex, 16) : Number(dec);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
      }
      const value = NAMED_ENTITIES[name];
      if (value === undefined) return match;
      if (semicolon) return value;
      if (name === "apos") return match;
      const next = whole.charAt(offset + match.length);
      return /[A-Za-z0-9=]/.test(next) ? match : value;
    },
  );
}

interface ParsedTag {
  tag: string;
  attrs: Record<string, string>;
  attrOrder: string[];
  selfClosing: boolean;
  /** Index just past the closing `>`, or -1 when the tag never closes. */
  end: number;
}

/** Parse a start tag beginning at `i` (which points at `<`). */
function readStartTag(src: string, i: number): ParsedTag | null {
  let p = i + 1;
  if (p >= src.length || !NAME_START.test(src[p])) return null;
  let name = "";
  while (p < src.length && NAME_CHAR.test(src[p])) name += src[p++];
  const tag = name.toLowerCase();

  const attrs: Record<string, string> = {};
  const attrOrder: string[] = [];
  let selfClosing = false;

  for (;;) {
    while (p < src.length && /\s/.test(src[p])) p++;
    if (p >= src.length) return { tag, attrs, attrOrder, selfClosing, end: -1 };

    if (src[p] === ">") {
      p++;
      break;
    }
    if (src[p] === "/" && src[p + 1] === ">") {
      selfClosing = true;
      p += 2;
      break;
    }
    if (src[p] === "/") {
      p++;
      continue;
    }

    // Attribute name: everything up to whitespace, `=`, `/` or `>`.
    let attrName = "";
    while (p < src.length && !/[\s=/>]/.test(src[p])) attrName += src[p++];
    if (!attrName) {
      p++;
      continue;
    }
    const key = attrName.toLowerCase();

    while (p < src.length && /\s/.test(src[p])) p++;
    let value = "";
    if (src[p] === "=") {
      p++;
      while (p < src.length && /\s/.test(src[p])) p++;
      const quote = src[p];
      if (quote === '"' || quote === "'") {
        p++;
        const close = src.indexOf(quote, p);
        if (close === -1) {
          value = src.slice(p);
          p = src.length;
        } else {
          value = src.slice(p, close);
          p = close + 1;
        }
      } else {
        while (p < src.length && !/[\s>]/.test(src[p])) value += src[p++];
      }
    }

    if (!(key in attrs)) {
      // Duplicate attributes: the first wins, matching browser behaviour.
      attrs[key] = decodeEntities(value);
      attrOrder.push(key);
    }
  }

  return { tag, attrs, attrOrder, selfClosing, end: p };
}

/**
 * The attributes of one opening tag, parsed by the same rules as
 * {@link tokenize}: names are matched whole, so `data-type` is never `type`.
 */
export function startTagAttributes(tag: string): Record<string, string> {
  const lt = tag.indexOf("<");
  if (lt === -1) return {};
  return readStartTag(tag, lt)?.attrs ?? {};
}

/**
 * Tokenize an HTML document.
 *
 * Always returns; malformed input degrades to text tokens rather than
 * throwing, because a scanner must produce a result for whatever the target
 * actually served.
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let textStart = 0;

  const flushText = (upto: number): void => {
    if (upto > textStart) {
      tokens.push({
        kind: "text",
        text: src.slice(textStart, upto),
        start: textStart,
        end: upto,
      });
    }
  };

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) break;

    // Comment.
    if (src.startsWith("<!--", lt)) {
      const close = src.indexOf("-->", lt + 4);
      const end = close === -1 ? src.length : close + 3;
      flushText(lt);
      tokens.push({
        kind: "comment",
        text: src.slice(lt + 4, close === -1 ? src.length : close),
        start: lt,
        end,
      });
      i = end;
      textStart = end;
      continue;
    }

    // CDATA is treated as text so its contents stay searchable.
    if (src.startsWith("<![CDATA[", lt)) {
      const close = src.indexOf("]]>", lt + 9);
      const end = close === -1 ? src.length : close + 3;
      i = end;
      continue;
    }

    // Doctype or other bogus declaration.
    if (src.startsWith("<!", lt)) {
      const close = src.indexOf(">", lt + 2);
      const end = close === -1 ? src.length : close + 1;
      flushText(lt);
      tokens.push({
        kind: "doctype",
        text: src.slice(lt + 2, close === -1 ? src.length : close),
        start: lt,
        end,
      });
      i = end;
      textStart = end;
      continue;
    }

    // End tag.
    if (src[lt + 1] === "/") {
      let p = lt + 2;
      if (p >= src.length || !NAME_START.test(src[p])) {
        i = lt + 1;
        continue;
      }
      let name = "";
      while (p < src.length && NAME_CHAR.test(src[p])) name += src[p++];
      const close = src.indexOf(">", p);
      const end = close === -1 ? src.length : close + 1;
      flushText(lt);
      tokens.push({
        kind: "end",
        tag: name.toLowerCase(),
        start: lt,
        end,
      });
      i = end;
      textStart = end;
      continue;
    }

    // Start tag.
    const parsed = readStartTag(src, lt);
    if (!parsed) {
      i = lt + 1;
      continue;
    }
    const tagEnd = parsed.end === -1 ? src.length : parsed.end;
    flushText(lt);
    tokens.push({
      kind: "start",
      tag: parsed.tag,
      attrs: parsed.attrs,
      attrOrder: parsed.attrOrder,
      selfClosing: parsed.selfClosing || VOID_TAGS.has(parsed.tag),
      start: lt,
      end: tagEnd,
      raw: src.slice(lt, tagEnd),
    });
    i = tagEnd;
    textStart = tagEnd;

    // Raw-text element: consume to the matching end tag without tokenizing.
    if (
      RAW_TEXT_TAGS.has(parsed.tag) &&
      !parsed.selfClosing &&
      !VOID_TAGS.has(parsed.tag)
    ) {
      const closeRe = new RegExp(
        `</${parsed.tag}(?=[\\s/>])|</${parsed.tag}$`,
        "i",
      );
      const rest = src.slice(tagEnd);
      const m = closeRe.exec(rest);
      const contentEnd = m ? tagEnd + m.index : src.length;
      if (contentEnd > tagEnd) {
        tokens.push({
          kind: "text",
          text: src.slice(tagEnd, contentEnd),
          start: tagEnd,
          end: contentEnd,
        });
      }
      if (m) {
        const gt = src.indexOf(">", contentEnd);
        const end = gt === -1 ? src.length : gt + 1;
        tokens.push({
          kind: "end",
          tag: parsed.tag,
          start: contentEnd,
          end,
        });
        i = end;
        textStart = end;
      } else {
        i = src.length;
        textStart = src.length;
      }
    }
  }

  flushText(src.length);
  return tokens;
}

export interface Element {
  tag: string;
  attrs: Record<string, string>;
  /** Text content for raw-text elements, and concatenated text for others. */
  text: string;
  /** Raw source of the start tag. */
  raw: string;
  start: number;
  end: number;
  /** Nesting depth at the start tag, 0 for a root-level element. */
  depth: number;
  /** Lowercased tags of the open elements enclosing this one, outermost first. */
  ancestors: string[];
}

/**
 * Deepest element nesting that keeps a frame on the open-element stack.
 *
 * An element's `ancestors` and `text` both depend on the elements open around
 * it, so a body of `"<div>x".repeat(n)` has n elements each enclosed by up to
 * n others. Computing both eagerly (copying the open stack into every element
 * and appending every text token to every open element) was quadratic in TIME
 * and in RETAINED MEMORY: 24 KB took 924 ms / 391 MB, and around 96 KB the
 * heap ran out and killed the process. Since this runs in one synchronous
 * call, the engine's between-check yielding cannot help and the scan
 * watchdog's timer cannot fire: every concurrent scan and unrelated request
 * dies with it. A page can do this to us with no crafted payload, just
 * nested divs.
 *
 * 256 is well past anything real (browsers cap around 512, and genuine pages
 * sit under 50), so the bound is invisible to real documents and only ever
 * binds on markup built to hurt us. Past it, elements are still emitted with
 * correct tags and offsets; they just stop collecting descendant text and
 * stop extending `ancestors`.
 */
const MAX_OPEN_DEPTH = 256;

/**
 * Cap on the text read for any single element. Only the inline-script case is
 * actually read downstream (page-context.ts reads `el.text` for scripts with
 * no src), and a script larger than this is already far past anything a check
 * meaningfully inspects.
 */
const MAX_ELEMENT_TEXT = 128 * 1024;

/**
 * One open element. Frames are never changed once pushed, so an element can
 * keep the frame that was on top when it opened and read its ancestors from
 * the chain later, whatever the stack has done since.
 */
interface OpenFrame {
  tag: string;
  index: number;
  parent: OpenFrame | null;
  /** Tokens this element encloses: from just after its start tag to the
   *  token that closed it, or the end of the document. */
  range: { from: number; to: number };
}

/**
 * An element whose `text` and `ancestors` are read from the token stream and
 * the frame chain on first use instead of being built for every element up
 * front. Even with the depth cap, building them eagerly kept about 400 MB live
 * for 256 KB of unclosed `<code>x` and 1.4 GB for a full 1 MB page: every
 * element held its own copy of up to 256 ancestor tags, and every text token
 * was appended to up to 256 open elements. Nothing downstream reads either for
 * most elements, so the work is now paid only for the elements that are asked.
 */
class TokenElement implements Element {
  tag: string;
  attrs: Record<string, string>;
  raw: string;
  start: number;
  end: number;
  depth: number;
  private readonly tokens: Token[];
  private readonly enclosing: OpenFrame | null;
  private readonly range: OpenFrame["range"] | null;
  private cachedText: string | undefined;
  private cachedAncestors: string[] | undefined;

  constructor(
    token: StartTagToken,
    depth: number,
    tokens: Token[],
    enclosing: OpenFrame | null,
    range: OpenFrame["range"] | null,
  ) {
    this.tag = token.tag;
    this.attrs = token.attrs;
    this.raw = token.raw;
    this.start = token.start;
    this.end = token.end;
    this.depth = depth;
    this.tokens = tokens;
    this.enclosing = enclosing;
    this.range = range;
  }

  get text(): string {
    if (this.cachedText !== undefined) return this.cachedText;
    let text = "";
    const range = this.range;
    if (range) {
      for (
        let i = range.from;
        i < range.to && text.length < MAX_ELEMENT_TEXT;
        i++
      ) {
        const t = this.tokens[i];
        if (t.kind === "text") text += t.text;
      }
    }
    this.cachedText = text;
    return text;
  }

  get ancestors(): string[] {
    if (this.cachedAncestors) return this.cachedAncestors;
    const tags: string[] = [];
    for (let f = this.enclosing; f; f = f.parent) tags.push(f.tag);
    this.cachedAncestors = tags.reverse();
    return this.cachedAncestors;
  }
}

/**
 * Flatten a token stream into an element index.
 *
 * Depth tracking uses a stack that pops on a matching end tag and unwinds to
 * the nearest match when tags are crossed, which is what browsers do for the
 * mis-nesting that occurs in real pages. Elements are returned in document
 * order.
 *
 * Bounded by MAX_OPEN_DEPTH and MAX_ELEMENT_TEXT above, and linear in the
 * number of tokens; see TokenElement for why text and ancestors are lazy.
 */
export function toElements(tokens: Token[]): Element[] {
  const out: TokenElement[] = [];
  const stack: OpenFrame[] = [];
  /** Depth actually seen, including frames past the cap that were not pushed,
   *  so `el.depth` keeps reporting the document's real nesting. */
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "start") {
      const enclosing = stack.length > 0 ? stack[stack.length - 1] : null;
      // Past the cap the element is still emitted, it just stops being an
      // open container: it collects no descendant text and encloses nothing.
      const opens = !t.selfClosing && stack.length < MAX_OPEN_DEPTH;
      const range = opens ? { from: i + 1, to: tokens.length } : null;
      out.push(
        // The document's real depth, not the stack's, so this stays
        // truthful past the cap.
        new TokenElement(t, depth, tokens, enclosing, range),
      );
      if (!t.selfClosing) {
        depth++;
        if (range) {
          stack.push({
            tag: t.tag,
            index: out.length - 1,
            parent: enclosing,
            range,
          });
        }
      }
      continue;
    }

    if (t.kind === "end") {
      let found = -1;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].tag === t.tag) {
          found = s;
          break;
        }
      }
      if (found === -1) continue;
      for (let s = stack.length - 1; s >= found; s--) {
        out[stack[s].index].end = t.end;
        stack[s].range.to = i;
      }
      // Unwinding closes (stack.length - found) containers. depth also
      // counts frames that were never pushed because of the cap, so it is
      // decremented by that same amount and floored, never recomputed from
      // stack.length.
      depth = Math.max(0, depth - (stack.length - found));
      stack.length = found;
    }
  }

  return out;
}
