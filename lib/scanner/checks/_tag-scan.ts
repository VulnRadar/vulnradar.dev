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

/** `\w` as a code-point test, so the name scan below does not build a
 *  one-character string per `<` in the document. */
function isWordCharCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
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
 * document order, non-overlapping, in ONE forward pass.
 *
 * This is the linear replacement for `<tag\b[^>]*>[\s\S]*?</tag\s*>`. That
 * shape rescans the whole remainder of the document from every opening tag
 * that never closes, so a body of `"<code>x"` repeated is quadratic: measured
 * at 15 ms for 16 KB and 996 ms for 128 KB, four times the cost for twice the
 * input. Here the `<` cursor, the `>` cursor and the closing-tag cursor only
 * ever move forward, so the whole sweep costs one pass over the body no
 * matter how the tags nest or fail to close.
 *
 * Matching rules are deliberately identical to the pattern this replaces, so
 * routing a stripper through it cannot change what any detector sees:
 *
 * - The element name is read as `\w+` immediately after the `<`, which is
 *   exactly what `<code\b` accepts: `<code-foo>` is a `code` tag (`\b` sits
 *   between `e` and `-`) and `<codex>` is not.
 * - The opening tag ends at the first `>` after the name, which is what
 *   `[^>]*>` means.
 * - The closing tag is the first `</name\s*>` for ANY name in `tags` after
 *   that, which is what a lazy `[\s\S]*?` bridge into an alternation does.
 * - An opening tag with no closing tag after it ends the sweep, the same
 *   result the old pattern reached far more expensively.
 */
function tagRegions(body: string, tags: readonly string[]): TagRegion[] {
  const names = new Set(tags.map((t) => t.toLowerCase()));
  let longestName = 0;
  for (const n of names) longestName = Math.max(longestName, n.length);

  const close = new RegExp(`</(?:${tags.join("|")})\\s*>`, "gi");
  const out: TagRegion[] = [];
  let i = 0;

  while (i < body.length) {
    const lt = body.indexOf("<", i);
    if (lt === -1) break;

    let nameEnd = lt + 1;
    while (
      nameEnd < body.length &&
      nameEnd - lt - 1 <= longestName &&
      isWordCharCode(body.charCodeAt(nameEnd))
    ) {
      nameEnd++;
    }
    if (!names.has(body.slice(lt + 1, nameEnd).toLowerCase())) {
      i = lt + 1;
      continue;
    }

    const gt = body.indexOf(">", nameEnd);
    if (gt === -1) break;

    close.lastIndex = gt + 1;
    const c = close.exec(body);
    if (!c) break;

    const end = c.index + c[0].length;
    out.push({
      start: lt,
      contentStart: gt + 1,
      contentEnd: c.index,
      end,
    });
    i = end;
  }

  return out;
}

/**
 * `body` with every `<tag ...>...</tag>` element removed, for any name in
 * `tags`. Linear in the body length: see {@link tagRegions}.
 */
export function stripTagElements(
  body: string,
  tags: readonly string[],
): string {
  if (!body) return body;
  const regions = tagRegions(body, tags);
  if (regions.length === 0) return body;
  const parts: string[] = [];
  let cursor = 0;
  for (const r of regions) {
    parts.push(body.slice(cursor, r.start));
    cursor = r.end;
  }
  parts.push(body.slice(cursor));
  return parts.join("");
}

/**
 * The inner text of every `<tag ...>...</tag>` element in `body`, for any
 * name in `tags`. Linear in the body length: see {@link tagRegions}.
 */
export function tagElementContents(
  body: string,
  tags: readonly string[],
): string[] {
  if (!body) return [];
  return tagRegions(body, tags).map((r) =>
    body.slice(r.contentStart, r.contentEnd),
  );
}

/**
 * Every opening `<name ...>` element in `body`, whatever the name, as raw tag
 * text including the angle brackets, in one forward pass.
 *
 * {@link openTags} needs a name because it compiles the name into its
 * pattern. A detector that cares about an attribute on ANY element used to
 * express that as `<[a-z][a-z0-9]*[^>]{0,2000}ATTR`, whose leading name run
 * and bounded attribute run both match the same characters: on markup where
 * the tag never closes, every `<` pays the full 2000-character run and back.
 * Linear in the body length, but with a 2000x constant that measured 5.5
 * SECONDS on a 1 MB body of `"<a"` repeated. Here the `<` cursor and the `>`
 * cursor only ever move forward, so a document of unterminated tags costs one
 * scan in total rather than one per `<`.
 */
export function anyOpenTags(body: string): string[] {
  if (!body) return [];
  const out: string[] = [];
  let i = 0;

  while (i < body.length) {
    const lt = body.indexOf("<", i);
    if (lt === -1) break;
    // A name has to start with a letter, which is what `<[a-z]` required and
    // what keeps `</div>`, `<!-- -->` and `<!doctype>` out. Skipping those
    // costs one character, never a `>` search, so a document that is nothing
    // but `<` never pays for a scan it cannot use.
    const first = body.charCodeAt(lt + 1);
    if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) {
      i = lt + 1;
      continue;
    }
    const gt = body.indexOf(">", lt + 1);
    if (gt === -1) break;
    out.push(body.slice(lt, gt + 1));
    // Past the `>`, so no region of the body is ever scanned twice.
    i = gt + 1;
  }

  return out;
}
