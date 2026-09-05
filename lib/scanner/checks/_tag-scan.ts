/**
 * Linear-time HTML tag scanning for the markup detectors.
 *
 * Detectors used to look for a tag and one of its attributes in a single
 * pattern shaped `<tag[^>]{0,2000}ATTR[^>]{0,2000}>`. That shape has a splice
 * point: the attribute can sit at any offset inside the first bounded run, and
 * for every offset where it matches, the trailing run scans its full 2000
 * characters and back looking for a `>`. On markup where the tag never closes
 * (a page emitting `<input type="password" ` or `<meta name="viewport"
 * content="` over and over, which any scanned site can serve, including
 * through the unauthenticated demo scan) the two runs multiply. Measured on a
 * 24 KB body: sensitive-meta-tags 24 SECONDS, sri-stylesheet-missing 10.6 s,
 * and a dozen more between 0.4 s and 1 s each, against the 1 MB body
 * execute-scan allows.
 *
 * Match the tag first, then test the attributes against that tag's own text,
 * which is also where an attribute genuinely belongs: the old single pattern
 * happily paired a tag with an `ATTR` from a completely different element
 * further down the document whenever the first tag was unterminated.
 *
 * `<tag\b[^>]{0,2000}>` has no splice point, and that was the first fix here.
 * It is not enough on its own. Its worst case is still one full bounded scan
 * per `<` in the document, so a body of `"<a"` repeated, which never contains
 * a `>` at all, costs 2000 steps for every one of them: linear, but with a
 * 2000x constant that measured 5.5 SECONDS on a 1 MB body through
 * inline-style-attr, and roughly a second each at 256 KB through
 * target-blank-no-noopener and code-clickjack-target-blank-js-href. Everything
 * below is therefore built on one hand-written scan whose cursors only move
 * forward, so no character of the body is ever examined twice, whatever the
 * markup does.
 *
 * ref: the budgets in tests/lib/scanner/_perf-budget.test.ts, which measure
 * both the per-detector cost and the cost of one whole sweep.
 */

/**
 * How far past the element name an opening tag's `>` may sit, mirroring the
 * `[^>]{0,2000}` the patterns here replaced. It is a cap on attribute text,
 * not a performance guard: nothing below rescans, so a larger value would
 * cost nothing. Keeping it means a tag carrying more than 2000 characters of
 * attributes stays invisible to these helpers, exactly as it was before,
 * rather than quietly turning into new findings on real pages that inline a
 * long data: URI.
 */
const MAX_ATTR_CHARS = 2000;

/** Longest element name worth reading, so the per-`<` name read is a constant.
 *  Anything longer cannot equal a name a caller asks for. */
const MAX_NAME_CHARS = 32;

/** `\w` as a code-point test, so the name scan does not build a
 *  one-character string per `<` in the document. */
function isWordCharCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

/** Offsets of one opening tag. */
interface OpenTag {
  /** Offset of the `<`. */
  start: number;
  /** Offset just past the element name, where attribute text begins. */
  nameEnd: number;
  /** Offset just past the `>`. */
  end: number;
}

/**
 * Every opening tag in `body` whose element name satisfies `accept`, in one
 * forward pass. This is the linear core the rest of the file is built on.
 *
 * The `<` cursor and the `>` cursor both only move forward and neither ever
 * revisits a character. The `>` cursor in particular is kept ACROSS
 * iterations: a run of `<` with a single far-away `>` would otherwise rescan
 * the whole gap from every one of them, which is the quadratic this file
 * exists to avoid.
 *
 * Matching rules are deliberately identical to the patterns this replaces, so
 * routing a detector through it cannot change what that detector sees:
 *
 * - The element name is read as `\w+` immediately after the `<`, which is
 *   exactly what `<code\b` accepts: `<code-foo>` is a `code` tag (the `\b`
 *   sits between `e` and `-`) and `<codex>` is not. A `</close>`, a
 *   `<!-- comment -->` and a `<!doctype>` all read as an empty name.
 * - The opening tag ends at the first `>` after the name, which is what
 *   `[^>]*>` means.
 * - `maxAttrChars` reproduces the old `{0,2000}` bound. Pass `Infinity` for
 *   the callers whose pattern was the unbounded `[^>]*`.
 */
function scanOpenTags(
  body: string,
  accept: (name: string) => boolean,
  maxAttrChars: number,
): OpenTag[] {
  const out: OpenTag[] = [];
  let i = 0;
  let gt = -1;

  while (i < body.length) {
    const lt = body.indexOf("<", i);
    if (lt === -1) break;

    let nameEnd = lt + 1;
    while (
      nameEnd < body.length &&
      nameEnd - lt <= MAX_NAME_CHARS &&
      isWordCharCode(body.charCodeAt(nameEnd))
    ) {
      nameEnd++;
    }
    if (!accept(body.slice(lt + 1, nameEnd))) {
      // Costs one character and never a `>` search, so a document that is
      // nothing but `<` never pays for a scan it cannot use.
      i = lt + 1;
      continue;
    }

    if (gt < nameEnd) {
      gt = body.indexOf(">", nameEnd);
      if (gt === -1) break;
    }
    if (gt - nameEnd > maxAttrChars) {
      i = lt + 1;
      continue;
    }

    out.push({ start: lt, nameEnd, end: gt + 1 });
    i = gt + 1;
  }

  return out;
}

/**
 * Every opening `<tag ...>` in `body`, as raw tag text including the angle
 * brackets. Use this when the caller needs a captured attribute value.
 */
export function openTags(
  body: string,
  tag: string,
  maxAttrChars: number = MAX_ATTR_CHARS,
): string[] {
  if (!body) return [];
  const wanted = tag.toLowerCase();
  return scanOpenTags(
    body,
    (name) => name.toLowerCase() === wanted,
    maxAttrChars,
  ).map((t) => body.slice(t.start, t.end));
}

/**
 * Every opening `<name ...>` element in `body`, whatever the name.
 *
 * {@link openTags} needs a name because the caller knows it. A detector that
 * cares about an attribute on ANY element used to express that as
 * `<[a-z][a-z0-9]*[^>]{0,2000}ATTR`, whose leading name run and bounded
 * attribute run both match the same characters. Ask for the tags instead and
 * test the attribute against each tag's own text.
 */
export function anyOpenTags(body: string): string[] {
  if (!body) return [];
  return scanOpenTags(
    body,
    // A name has to start with a letter, which is what `<[a-z]` required.
    (name) => /^[a-z]/i.test(name),
    MAX_ATTR_CHARS,
  ).map((t) => body.slice(t.start, t.end));
}

/**
 * Opening `<tag ...>` elements whose own text matches every pattern in
 * `attrs`. Attribute patterns supply their own flags, so pass them
 * case-insensitive; the tag name is always matched case-insensitively.
 */
export function tagsWith(
  body: string,
  tag: string,
  ...attrs: RegExp[]
): string[] {
  return openTags(body, tag).filter((t) =>
    attrs.every((a) => {
      // A caller's pattern may carry /g (copied from the pattern it replaced)
      // and RegExp.test on a global regex advances lastIndex, so the next tag
      // would be tested from a stale offset.
      a.lastIndex = 0;
      return a.test(t);
    }),
  );
}

/** Whether `body` holds at least one `<tag ...>` matching every `attrs`. */
export function hasTagWith(
  body: string,
  tag: string,
  ...attrs: RegExp[]
): boolean {
  return tagsWith(body, tag, ...attrs).length > 0;
}

interface TagRegion {
  /** Offset of the `<` that opens the element. */
  start: number;
  /** Offset just past the opening tag's `>`. */
  contentStart: number;
  /** Offset of the `<` that begins the closing tag. */
  contentEnd: number;
  /** Offset just past the closing tag's `>`. */
  end: number;
}

/**
 * Every `<tag ...>...</tag>` region in `body` for any name in `tags`, in
 * document order and non-overlapping.
 *
 * This is the linear replacement for `<tag\b[^>]*>[\s\S]*?</tag\s*>`, whose
 * lazy middle rescans the whole remainder of the document from every opening
 * tag that never closes: a body of `"<code>x"` repeated measured 15 ms at
 * 16 KB and 996 ms at 128 KB, four times the cost for twice the input. The
 * closing-tag cursor here only moves forward, like the two in
 * {@link scanOpenTags}, so the whole sweep is one pass however the tags nest
 * or fail to close.
 *
 * The closing tag is the first `</name\s*>` for ANY name in `tags` after the
 * opening one, which is what a lazy bridge into an alternation does, and an
 * opening tag with no closing tag after it ends the sweep, which is the same
 * result the old pattern reached far more expensively.
 */
function tagRegions(
  body: string,
  tags: readonly string[],
  maxAttrChars: number,
): TagRegion[] {
  if (!body) return [];
  const names = new Set(tags.map((t) => t.toLowerCase()));
  const close = new RegExp(`</(?:${tags.join("|")})\\s*>`, "gi");
  const out: TagRegion[] = [];

  // A region runs to its CLOSING tag, so opening tags the previous region
  // already swallowed must not start a region of their own. Skipping them
  // keeps every cursor monotonic and the whole thing one pass.
  let consumedTo = 0;
  for (const open of scanOpenTags(
    body,
    (name) => names.has(name.toLowerCase()),
    maxAttrChars,
  )) {
    if (open.start < consumedTo) continue;
    close.lastIndex = open.end;
    const c = close.exec(body);
    if (!c) break;
    const end = c.index + c[0].length;
    out.push({
      start: open.start,
      contentStart: open.end,
      contentEnd: c.index,
      end,
    });
    consumedTo = end;
  }

  return out;
}

/**
 * Whole `<tag ...>...</tag>` elements, non-overlapping, in document order.
 */
export function tagElements(body: string, tag: string): string[] {
  return tagRegions(body, [tag], MAX_ATTR_CHARS).map((r) =>
    body.slice(r.start, r.end),
  );
}

/**
 * `body` with every `<tag ...>...</tag>` element replaced by `replacement`,
 * for any name in `tags`.
 *
 * The opening tag is matched with the unbounded `[^>]*` rule rather than the
 * 2000-character one, because that is what the strippers this replaces used,
 * and a stripper that silently keeps a region is a false positive waiting to
 * happen.
 */
export function stripTagElements(
  body: string,
  tags: readonly string[],
  replacement = "",
): string {
  if (!body) return body;
  const regions = tagRegions(body, tags, Infinity);
  if (regions.length === 0) return body;
  const parts: string[] = [];
  let cursor = 0;
  for (const r of regions) {
    parts.push(body.slice(cursor, r.start), replacement);
    cursor = r.end;
  }
  parts.push(body.slice(cursor));
  return parts.join("");
}

/**
 * The inner text of every `<tag ...>...</tag>` element in `body`, for any
 * name in `tags`. Same unbounded opening-tag rule as
 * {@link stripTagElements}.
 */
export function tagElementContents(
  body: string,
  tags: readonly string[],
): string[] {
  return tagRegions(body, tags, Infinity).map((r) =>
    body.slice(r.contentStart, r.contentEnd),
  );
}

/** The opening tag of an element returned by {@link tagElements}. */
export function openingTagOf(element: string): string {
  const end = element.indexOf(">");
  return end === -1 ? element : element.slice(0, end + 1);
}
