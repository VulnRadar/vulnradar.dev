/**
 * Per-request correlation id, carried across the Edge -> Node boundary.
 *
 * AUDIT-012#obs-07: nothing in the app produced a request id, so the rows
 * one failing request writes to system_error_logs (route -> executeScan ->
 * a check -> safeFetch, each with its own console.error) arrived as several
 * unrelated-looking lines of free-text English with nothing tying them
 * together.
 *
 * The trap is the runtime split. middleware.ts runs on the Edge runtime and
 * route handlers run on Node; the two never share a module instance, so an
 * AsyncLocalStorage entered in middleware is simply invisible to a handler.
 * The id therefore travels as the `x-request-id` REQUEST header middleware
 * sets on the forwarded request, and is re-entered into a Node-side store
 * here by withErrorHandling in lib/api/api-utils.ts, the one wrapper every
 * API route already goes through.
 *
 * This lives next to lib/database/error-log-capture.ts because that is the
 * only reader: the console.error wrapper cannot be handed an id by its ~330
 * call sites, so it asks the ambient context instead. Keeping the
 * `node:async_hooks` import in a Node-only module is also what stops it
 * being pulled into the edge bundle middleware.ts compiles to.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Shapes accepted from the header. Deliberately narrow: the value is
 * written verbatim into an admin-facing table, so anything that is not a
 * plain opaque token is dropped rather than stored. middleware.ts always
 * overwrites whatever a client sent, so a value only reaches here unvetted
 * on a path the middleware matcher does not cover.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

const storage = new AsyncLocalStorage<string>();

/** The header middleware.ts sets on the request and echoes on the response. */
export const REQUEST_ID_HEADER = "x-request-id";

/** The header value if it is a usable id, otherwise null. */
export function normalizeRequestId(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** Run `fn` with `requestId` as the ambient id for everything it awaits. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run(requestId, fn);
}

/** The ambient id, or null outside a request (boot, cron, worker tick). */
export function currentRequestId(): string | null {
  return storage.getStore() ?? null;
}
