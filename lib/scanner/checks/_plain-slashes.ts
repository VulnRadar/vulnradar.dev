/**
 * A body with its JSON-escaped slashes (`https:\/\/`, from json_encode and
 * WordPress settings blobs) read as plain ones, for detectors whose patterns
 * spell a URL with `/`. Without this such a URL is invisible to them.
 *
 * Only the matching can use this view. Whatever then asks about the page has
 * to be given the body as served, through rawOffset: an escaped `<\/script>`
 * read as a plain one ends the script early, so the tag walk behind a doc-block
 * judgement would see a different page.
 */
export interface PlainSlashView {
  text: string;
  /** Where offset `index` of `text` sits in the body as served. */
  rawOffset: (index: number) => number;
}

export function plainSlashView(body: string): PlainSlashView {
  if (!body.includes("\\/")) return { text: body, rawOffset: (i) => i };

  // Offsets in `text` of each slash that lost its backslash, ascending.
  const unescaped: number[] = [];
  const text = body.replace(/\\\//g, (_match, offset: number) => {
    unescaped.push(offset - unescaped.length);
    return "/";
  });

  return {
    text,
    rawOffset: (index) => {
      let low = 0;
      let high = unescaped.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (unescaped[mid] < index) low = mid + 1;
        else high = mid;
      }
      return index + low;
    },
  };
}
