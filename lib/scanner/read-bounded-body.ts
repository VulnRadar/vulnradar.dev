/**
 * The one bounded response-body reader.
 *
 * This exact loop (getReader, byte counter, trim-on-overshoot, decoder,
 * reader.cancel in a finally) used to exist verbatim in five places, and only
 * one of them, execute-scan.ts's, carried the read timeout that the comment
 * below explains is mandatory. The other four took `(response, maxBytes)`
 * only, so the crawl, page-discovery, bulk and anonymous demo-scan paths had
 * no time bound on the body at all: a target that answers with headers and
 * then emits one byte every thirty seconds never reaches `maxBytes` and never
 * finishes, so `await reader.read()` never settles and the task (plus, on the
 * crawl and bulk paths, a pooled DB connection and a concurrency slot) is
 * pinned for as long as the attacker keeps the socket open.
 *
 * Both bounds matter and neither substitutes for the other: `maxBytes` stops
 * a fast flood, `timeoutMs` stops a slow trickle.
 *
 * ref: AUDIT-013#dup-01
 */

/**
 * Read a response body with a size limit and a hard read timeout.
 *
 * safeFetch's own deadline now survives the header phase (see safe-fetch.ts,
 * ref AUDIT-012#ssrf-01), but that deadline is the whole-request one; this
 * reader is the caller-side bound, and it is what guarantees a slow stream
 * cannot outlive the caller regardless of how the response was obtained. The
 * timeout calls `reader.cancel()`, which makes the pending `reader.read()`
 * reject with an AbortError, caught below so the caller still gets whatever
 * arrived before the cut-off rather than an exception.
 */
export async function safeReadBody(
  response: Response,
  maxBytes: number,
  timeoutMs = 10_000,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let totalBytes = 0;

  const cancelTimer = setTimeout(() => {
    reader.cancel().catch(() => {});
  }, timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        // Decode the partial chunk up to the limit
        const overshoot = totalBytes - maxBytes;
        const trimmed = value.slice(0, value.byteLength - overshoot);
        if (trimmed.byteLength > 0) {
          chunks.push(decoder.decode(trimmed, { stream: false }));
        }
        break;
      }

      chunks.push(decoder.decode(value, { stream: true }));
    }
  } catch {
    // Stream error or reader.cancel() from the timeout: return what we have
  } finally {
    clearTimeout(cancelTimer);
    // cancel() is async, so a sync try/catch never sees its rejection and it
    // escaped as an unhandled rejection. Awaiting would delay every caller on
    // the read path, so the handler is attached to the promise instead.
    void reader.cancel().catch(() => {});
  }

  return chunks.join("");
}
