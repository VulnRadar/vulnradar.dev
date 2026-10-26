/**
 * The plain-text part of an HTML message.
 *
 * A broadcast is written as HTML (the campaign templates and the composer's
 * textarea both produce it), and its text/plain alternative used to be made by
 * deleting every `<...>` run. That left a text part that was not the same
 * message as the HTML one:
 *
 *   - entities stayed encoded, so "We didn&#39;t break anything" was sent as
 *     written, and the inbox preview derived from it was escaped a second time
 *     on the way into the hidden preheader;
 *   - adjacent list items ran together, because `</li><li>` has no whitespace
 *     in it;
 *   - a button's label appeared twice, once in the VML fallback that only
 *     Outlook renders and once in the anchor;
 *   - every URL was gone, because a URL lives in an href and an href is a tag.
 *
 * A text part that disagrees with the HTML part is something spam filters
 * score, and broadcasts are the one class of mail they judge hardest. This
 * produces the text a person reading only that part would want: entities
 * decoded, conditional comments skipped, a line break at each block element
 * and each list item, and the address of every link written after its label.
 *
 * Hand-rolled for the reason the tag stripper this replaced was: the input is
 * a message an admin typed, and a regex that rescans on a run of unclosed
 * brackets is a polynomial-time trap (CodeQL js/polynomial-redos). Every loop
 * here moves forward and the one scan that could run long, for the end of a
 * tag, is capped.
 */

/** A tag longer than this is not a tag, so a stray "<a" cannot rescan the
 *  rest of the document. Real inline styles in the email shell stay far under. */
const MAX_TAG_CHARS = 2048;

/** Elements whose children are never part of the message. */
const SKIPPED_ELEMENTS = new Set([
  "head",
  "style",
  "script",
  "title",
  "noscript",
  "template",
]);

/** Open and close each end a paragraph: a blank line on either side. */
const PARAGRAPH_ELEMENTS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "ul",
  "ol",
  "dl",
  "blockquote",
  "pre",
  "hr",
  "figure",
]);

/** Open and close each end a line. */
const LINE_ELEMENTS = new Set([
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "tr",
  "li",
  "dt",
  "dd",
  "center",
  "form",
  "fieldset",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201A",
  ldquo: "\u201C",
  rdquo: "\u201D",
  bdquo: "\u201E",
  bull: "\u2022",
  middot: "\u00B7",
  copy: "\u00A9",
  reg: "\u00AE",
  trade: "\u2122",
  times: "\u00D7",
  rarr: "\u2192",
  larr: "\u2190",
  check: "\u2713",
};

/** Characters that render as nothing. The preheader filler is made of them. */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});/gi,
    (whole, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        const usable =
          Number.isInteger(code) &&
          code >= 0x20 &&
          code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff);
        return usable ? String.fromCodePoint(code) : "";
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}

interface ParsedTag {
  name: string;
  closing: boolean;
  attributes: string;
  /** Index of the ">" that ends the tag. */
  end: number;
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * Read the tag that starts at `open` (a "<"), null when it is not one, or
 * "unterminated" when it starts like a tag and is still open MAX_TAG_CHARS
 * later. Quote-aware, because a ">" inside an attribute value does not end the
 * tag. One that runs into the end of the document instead is not a tag, just
 * text, the same as `price < 10`.
 */
function readTag(
  html: string,
  open: number,
): ParsedTag | null | "unterminated" {
  let cursor = open + 1;
  const closing = html.charCodeAt(cursor) === 47; // "/"
  if (closing) cursor += 1;
  if (!isLetter(html.charCodeAt(cursor))) return null;

  const nameStart = cursor;
  while (cursor < html.length && /[A-Za-z0-9:-]/.test(html[cursor]))
    cursor += 1;
  const name = html.slice(nameStart, cursor).toLowerCase();

  const limit = Math.min(html.length, cursor + MAX_TAG_CHARS);
  let quote = "";
  let end = -1;
  for (let j = cursor; j < limit; j += 1) {
    const ch = html[j];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      end = j;
      break;
    }
  }
  if (end === -1) return limit < html.length ? "unterminated" : null;
  return { name, closing, attributes: html.slice(cursor, end), end };
}

function hrefOf(attributes: string): string | null {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(
    attributes,
  );
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
}

/** The address worth printing after a link's label, or null for none. */
function printableLink(href: string | null): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^mailto:/i.test(href)) {
    const address = href.slice(7).split("?")[0].trim();
    return address || null;
  }
  return null;
}

/** "https://x.test/a/" and "x.test/a" are the same thing to a reader. */
function bareUrl(value: string): string {
  return value
    .trim()
    .replace(/^(?:https?:\/\/|mailto:)/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function htmlToText(html: string): string {
  const parts: string[] = [];
  /** Newlines at the very end of the output so far, capped at two. */
  let trailingNewlines = 0;
  let pendingSpace = false;
  let hasContent = false;

  const writeText = (raw: string) => {
    const collapsed = raw.replace(INVISIBLE, "").replace(/\s+/g, " ");
    if (collapsed === "") return;
    const body = collapsed.trim();
    if (body === "") {
      pendingSpace = true;
      return;
    }
    if (collapsed.startsWith(" ")) pendingSpace = true;
    if (pendingSpace && hasContent && trailingNewlines === 0) parts.push(" ");
    parts.push(body);
    hasContent = true;
    trailingNewlines = 0;
    pendingSpace = collapsed.endsWith(" ");
  };

  const writeBreak = (newlines: 1 | 2) => {
    if (!hasContent) return;
    pendingSpace = false;
    const needed = newlines - trailingNewlines;
    if (needed > 0) {
      parts.push("\n".repeat(needed));
      trailingNewlines = newlines;
    }
  };

  /** Links being read: the text that came before them, and where they point. */
  const links: { startIndex: number; href: string | null }[] = [];

  let cursor = 0;
  let textStart = 0;
  const flushText = (until: number) => {
    if (until > textStart) {
      writeText(decodeEntities(html.slice(textStart, until)));
    }
  };

  while (cursor < html.length) {
    const open = html.indexOf("<", cursor);
    if (open === -1) break;

    // A comment, which is also how Outlook's conditional blocks are written:
    // `<!--[if mso]> ...VML... <![endif]-->` ends at its first "-->".
    if (html.startsWith("<!--", open)) {
      flushText(open);
      const close = html.indexOf("-->", open + 4);
      if (close === -1) return finish();
      cursor = textStart = close + 3;
      continue;
    }
    // A doctype, a CDATA section, a processing instruction.
    if (html[open + 1] === "!" || html[open + 1] === "?") {
      flushText(open);
      const close = html.indexOf(">", open + 2);
      if (close === -1) return finish();
      cursor = textStart = close + 1;
      continue;
    }

    const tag = readTag(html, open);
    // A tag still open after MAX_TAG_CHARS is the end of the message, like an
    // unterminated comment. Reading on from the next "<" instead rescanned up
    // to MAX_TAG_CHARS for every one of them, so a body of thousands of broken
    // tags took seconds.
    if (tag === "unterminated") {
      flushText(open);
      return finish();
    }
    if (!tag) {
      // A "<" that opens nothing (`price < 10`) is just a character.
      cursor = open + 1;
      continue;
    }

    flushText(open);
    cursor = textStart = tag.end + 1;

    if (SKIPPED_ELEMENTS.has(tag.name)) {
      if (tag.closing) continue;
      const closer = new RegExp(`</${tag.name}\\b`, "gi");
      closer.lastIndex = cursor;
      const found = closer.exec(html);
      if (!found) return finish();
      const closeEnd = html.indexOf(">", found.index);
      if (closeEnd === -1) return finish();
      cursor = textStart = closeEnd + 1;
      continue;
    }

    if (tag.name === "br") {
      writeBreak(1);
      continue;
    }

    if (tag.name === "a") {
      if (!tag.closing) {
        links.push({
          startIndex: parts.length,
          href: hrefOf(tag.attributes),
        });
      } else {
        const link = links.pop();
        const url = link ? printableLink(link.href) : null;
        if (link && url) {
          const label = parts
            .slice(link.startIndex)
            .join("")
            .replace(/\s+/g, " ")
            .trim();
          if (label === "") {
            writeText(url);
          } else if (bareUrl(label) !== bareUrl(url)) {
            parts.push(` (${url})`);
            trailingNewlines = 0;
            pendingSpace = false;
          }
        }
      }
      continue;
    }

    if (tag.name === "td" || tag.name === "th") {
      // Cells are columns of one row: keep "Name" and "Sam" apart.
      if (tag.closing) pendingSpace = true;
      continue;
    }

    if (PARAGRAPH_ELEMENTS.has(tag.name)) {
      writeBreak(2);
      continue;
    }

    if (LINE_ELEMENTS.has(tag.name)) {
      writeBreak(1);
      if (tag.name === "li" && !tag.closing) {
        parts.push("- ");
        hasContent = true;
        trailingNewlines = 0;
        pendingSpace = false;
      }
      continue;
    }
    // Anything else (span, strong, em, font, img, ...) is inline: its text
    // is already part of the surrounding run.
  }

  flushText(html.length);
  return finish();

  function finish(): string {
    return parts
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}
