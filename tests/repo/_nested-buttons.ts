/**
 * Finds `<Link>`, `<NextLink>` and `<a>` elements whose first child is a
 * `<Button>` or `<button>`. See no-button-inside-link.test.ts for why that
 * shape is banned.
 *
 * A scanner and not a one-line regex because the obvious regex
 * (`<Link[^>]*>\s*<Button`) misses any link whose attributes contain a `>`,
 * and `onClick={() => setOpen(false)}` is exactly that: the landing nav's menu
 * panel had one, and the regex walked straight past it.
 *
 * Only the FIRST child is checked. A button further down inside a link is a
 * different shape of the same mistake, but it is not one this repo writes, and
 * a scanner that tried to cover it would need a real JSX parser.
 */

/** Tags that render an anchor. `<article>` and `<aside>` do not match. */
const ANCHOR_TAG = /<(?:Link|NextLink|a)(?=[\s>])/g;
/** What must not come first inside one. */
const BUTTON_START = /^<(?:Button|button)(?=[\s>/])/;

/**
 * Index of the `>` that closes the opening tag whose `<` is at `start`, or -1.
 * Walks past attribute strings and `{...}` expressions so a `>` inside either
 * (an arrow function, a comparison) is not mistaken for the end of the tag.
 */
function endOfOpeningTag(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    } else if (c === ">" && depth === 0) {
      return i;
    }
  }
  return -1;
}

/** Skips whitespace and JSX comments (`{` slash-star ... star-slash `}`), which render nothing. */
function skipInsignificant(source: string, from: number): number {
  let i = from;
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i++;
    const comment = /^\{\s*\/\*[\s\S]*?\*\/\s*\}/.exec(source.slice(i));
    if (!comment) return i;
    i += comment[0].length;
  }
}

export interface NestedButton {
  /** `Link`, `NextLink` or `a`. */
  tag: string;
  /** 1-based line the anchor opens on. */
  line: number;
}

export function nestedButtons(source: string): NestedButton[] {
  const found: NestedButton[] = [];
  for (const match of source.matchAll(ANCHOR_TAG)) {
    const open = match.index;
    const close = endOfOpeningTag(source, open);
    if (close === -1 || source[close - 1] === "/") continue;
    const next = skipInsignificant(source, close + 1);
    if (BUTTON_START.test(source.slice(next, next + 10))) {
      found.push({
        tag: match[0].slice(1),
        line: source.slice(0, open).split("\n").length,
      });
    }
  }
  return found;
}
