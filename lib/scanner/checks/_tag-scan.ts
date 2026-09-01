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
 * `<tag\b[^>]{0,2000}>` has no splice point: the run either reaches a `>` or
 * it does not, so the worst case is one bounded scan per tag occurrence and
 * the cost stays linear in the body. Match the tag first, then test the
 * attributes against that tag's own text, which is also where an attribute
 * genuinely belongs: the old single pattern happily paired a tag with an
 * `ATTR` from a completely different element further down the document
 * whenever the first tag was unterminated.
 *
 * ref: tests/lib/scanner/checks/_tag-scan-perf.test.ts, and the same defect
 * class already guarded by tests/lib/scanner/_perf-budget.test.ts.
 *
 * Regexes are built per call rather than cached at module scope: these run
 * inside detectors that call each other, and a shared `g` regex carries
 * `lastIndex` between them.
 */

/** Matches one opening `<tag ...>`, bounded so an unterminated tag cannot
 *  scan to the end of the document. */
function openTagRe(tag: string): RegExp {
  return new RegExp(`<${tag}\\b[^>]{0,2000}>`, "gi");
}

/**
 * Every opening `<tag ...>` in `body`, as raw tag text including the angle
 * brackets. Use this when the caller needs a captured attribute value.
 */
export function openTags(body: string, tag: string): string[] {
  if (!body) return [];
  return body.match(openTagRe(tag)) || [];
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

/**
 * Whole `<tag ...>...</tag>` elements, non-overlapping, in document order.
 *
 * Replaces `<tag[^>]{0,2000}...>[\s\S]*?<\/tag\s*>`, whose lazy middle rescans
 * to the end of the document from every opening tag when the document never
 * closes one. Both scans here only ever move forward, so the whole sweep is a
 * single pass. An opening tag with no closing tag after it ends the sweep, the
 * same result the old pattern reached far more expensively.
 */
export function tagElements(body: string, tag: string): string[] {
  if (!body) return [];
  const open = openTagRe(tag);
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = open.exec(body)) !== null) {
    close.lastIndex = open.lastIndex;
    const c = close.exec(body);
    if (!c) break;
    const end = c.index + c[0].length;
    out.push(body.slice(m.index, end));
    open.lastIndex = end;
  }
  return out;
}

/** The opening tag of an element returned by {@link tagElements}. */
export function openingTagOf(element: string): string {
  const end = element.indexOf(">");
  return end === -1 ? element : element.slice(0, end + 1);
}
