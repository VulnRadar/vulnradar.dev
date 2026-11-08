/**
 * Request-shape limits that have to be enforced in two places at once.
 *
 * These live in their own module, with no imports, specifically so
 * `middleware.ts` can use them: it runs on the edge runtime, and
 * lib/api/api-utils.ts (where the body cap used to be a private const) pulls
 * in the database pool and the session helpers, neither of which can be
 * loaded there.
 */

/**
 * Hard cap on request bodies. Without one, a client can send a multi-GB JSON
 * body that the server buffers before rejecting. 1 MiB is more than enough for
 * every route shape in this app (the largest legitimate payload is a few KB).
 *
 * Enforced in middleware for every /api/ request that declares a body length.
 * A chunked body declares none and gets past that check, so what actually
 * bounds it is readBodyBounded below, which parseBody and readJsonObject read
 * through. A route that still calls request.json() itself is capped by the
 * middleware check alone: the cap was documented as a property of the API but
 * only some of the body-reading routes ever went through parseBody.
 * ref: AUDIT-013#dup-04
 */
export const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024;

/** HTTP methods that may carry a request body. */
export const BODY_CARRYING_METHODS = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

export type BoundedBody = { ok: true; text: string } | { ok: false };

/**
 * Read a request body as text, stopping as soon as it passes `maxBytes`.
 *
 * Content-Length is the client's own claim and a chunked request does not make
 * one, so `request.json()` on such a body buffers all of it before anything
 * can refuse it. Counting the bytes as they arrive and cancelling the stream
 * is the only check that holds for every request.
 *
 * TextDecoder because request.json() decodes the same way, a leading BOM
 * included, so a body that parsed before still parses. A stream that fails
 * midway rejects; the caller decides what that means.
 */
export async function readBodyBounded(
  request: Pick<Request, "body">,
  maxBytes: number = MAX_REQUEST_BODY_BYTES,
): Promise<BoundedBody> {
  const stream = request.body;
  if (!stream) return { ok: true, text: "" };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}
