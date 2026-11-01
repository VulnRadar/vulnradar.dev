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

/** What a bounded read returns when the caller needs to know it was cut. */
export interface BoundedBody {
  text: string;
  /**
   * True when the read stopped before the body ended: the byte cap was
   * crossed, the timeout fired or the stream failed. `text` is then a prefix.
   */
  truncated: boolean;
}

/**
 * Read a response body with a size limit and a hard read timeout.
 *
 * safeFetch's own deadline now survives the header phase (see safe-fetch.ts,
 * ref AUDIT-012#ssrf-01), but that deadline is the whole-request one; this
 * reader is the caller-side bound, and it is what guarantees a slow stream
 * cannot outlive the caller regardless of how the response was obtained. The
 * timeout calls `reader.cancel()`, which settles the pending `reader.read()`
 * (as `done`, or as a rejection on some stream implementations, caught below),
 * so the caller still gets whatever arrived before the cut-off rather than an
 * exception.
 */
export async function safeReadBody(
  response: Response,
  maxBytes: number,
  timeoutMs = 10_000,
): Promise<string> {
  return (await readBoundedBody(response, maxBytes, timeoutMs)).text;
}

/** safeReadBody, plus whether the body was cut short. */
export async function readBoundedBody(
  response: Response,
  maxBytes: number,
  timeoutMs = 10_000,
): Promise<BoundedBody> {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let totalBytes = 0;
  let truncated = true;
  // A cancel resolves the pending read as `done`, which looks exactly like
  // the body ending, so the timer has to say that it was the one that fired.
  let timedOut = false;

  const cancelTimer = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // A body that ends partway through a multi-byte character leaves
        // those bytes held in the streaming decoder. Flushing turns them into
        // U+FFFD, as res.text() does, instead of dropping them silently.
        chunks.push(decoder.decode());
        truncated = timedOut;
        break;
      }

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

  return { text: chunks.join(""), truncated };
}
