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
 * Decode the entity forms that appear in attribute values often enough to
 * change a security verdict. Full entity tables are not worth the weight: a
 * URL written as `http&#58;//x` is the only realistic evasion and numeric
 * references cover it.
 */
export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#(\d+);?/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : _m;
    })
    .replace(/&quot;?/gi, '"')
    .replace(/&apos;?/gi, "'")
    .replace(/&lt;?/gi, "<")
    .replace(/&gt;?/gi, ">")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;?/gi, "&");
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
 * Two things below are O(open elements) per token: building `ancestors`, and
 * attributing text to every open element. Without a cap, a body of
 * `"<div>x".repeat(n)` makes both O(n) at every one of n tokens, so the whole
 * pass is quadratic in TIME and in RETAINED MEMORY. Measured on the real
 * function: 6 KB took 57 ms / 33 MB, 12 KB took 148 ms / 109 MB, and 24 KB
 * took 924 ms / 391 MB. Around 96 KB it exhausts the heap and kills the
 * process, and since this runs in one synchronous call, the engine's
 * between-check yielding cannot help and the scan watchdog's timer cannot
 * fire: every concurrent scan and unrelated request dies with it. A page can
 * do this to us with no crafted payload, just nested divs.
 *
 * 256 is well past anything real (browsers cap around 512, and genuine pages
 * sit under 50), so the bound is invisible to real documents and only ever
 * binds on markup built to hurt us. Past it, elements are still emitted with
 * correct tags and offsets; they just stop collecting descendant text and
 * stop extending `ancestors`.
 */
const MAX_OPEN_DEPTH = 256;

/**
 * Cap on the text accumulated onto any single element.
 *
 * Depth alone does not bound memory: one deep chain with a large body still
 * copies the whole tail into every open element. Only the inline-script case
 * is actually read downstream (page-context.ts reads `el.text` for scripts
 * with no src), and a script larger than this is already far past anything a
 * check meaningfully inspects.
 */
const MAX_ELEMENT_TEXT = 128 * 1024;

/**
 * Flatten a token stream into an element index.
 *
 * Depth tracking uses a stack that pops on a matching end tag and unwinds to
 * the nearest match when tags are crossed, which is what browsers do for the
 * mis-nesting that occurs in real pages. Elements are returned in document
 * order.
 *
 * Bounded by MAX_OPEN_DEPTH and MAX_ELEMENT_TEXT above; see those for why.
 */
export function toElements(tokens: Token[]): Element[] {
  const out: Element[] = [];
  const stack: { tag: string; index: number }[] = [];
  /** Depth actually seen, including frames past the cap that were not pushed,
   *  so `el.depth` keeps reporting the document's real nesting. */
  let depth = 0;

  for (const t of tokens) {
    if (t.kind === "start") {
      const el: Element = {
        tag: t.tag,
        attrs: t.attrs,
        text: "",
        raw: t.raw,
        start: t.start,
        end: t.end,
        // The document's real depth, not the stack's, so this stays truthful
        // past the cap.
        depth,
        // stack is bounded by MAX_OPEN_DEPTH, so this copy is bounded too. It
        // was the other half of the quadratic memory.
        ancestors: stack.map((s) => s.tag),
      };
      out.push(el);
      if (!t.selfClosing) {
        depth++;
        // Past the cap the element is still emitted, it just stops being an
        // open container: it collects no descendant text and encloses nothing.
        if (stack.length < MAX_OPEN_DEPTH) {
          stack.push({ tag: t.tag, index: out.length - 1 });
        }
      }
      continue;
    }

    if (t.kind === "text") {
      // Attribute text to every currently open element so a check can ask for
      // the text of a <form> or the source of a <script> without a tree walk.
      // Bounded twice over: the stack cannot exceed MAX_OPEN_DEPTH, and an
      // element stops accumulating at MAX_ELEMENT_TEXT. Without both, one text
      // token is copied into every open element, and deep nesting makes the
      // pass quadratic in time and in retained memory.
      for (const frame of stack) {
        const el = out[frame.index];
        if (el.text.length >= MAX_ELEMENT_TEXT) continue;
        el.text += t.text;
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
