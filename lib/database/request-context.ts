/**
 * Ambient correlation ids: the request a piece of work belongs to, and the
 * scan it is doing, carried across every `await` without being passed.
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
 * here by withErrorHandling in lib/api/api-utils.ts.
 *
 * Only the routes wrapped in withErrorHandling enter it. This comment used to
 * say every API route already went through that wrapper; most did not (the
 * scan, AI chat, billing and admin routes among them), and for those
 * currentRequestId() is null and their error rows carry no request id until
 * they are wrapped.
 *
 * The scan id is the second half for the same reason. A background scan
 * outlives the request that started it and a scheduled scan never had one,
 * so "every error scan 4812 produced" needs its own key. runWithScanId nests
 * inside a request context and keeps its request id, so a scan started by a
 * request carries both.
 *
 * This lives next to lib/database/error-log-capture.ts because that is the
 * main reader: the console.error wrapper cannot be handed an id by its ~400
 * call sites, so it asks the ambient context instead. Keeping the
 * `node:async_hooks` import in a Node-only module is also what stops it
 * being pulled into the edge bundle middleware.ts compiles to.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ApiVersion } from "@/lib/api/versions";

/**
 * Shapes accepted from the header. Deliberately narrow: the value is
 * written verbatim into an admin-facing table, so anything that is not a
 * plain opaque token is dropped rather than stored. middleware.ts always
 * overwrites whatever a client sent, so a value only reaches here unvetted
 * on a path the middleware matcher does not cover.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * What a first-party client may call itself ("extension/0.3.0", "cli/2.1.0").
 * The value comes straight from a request header and ends up on an API key's
 * row and in the admin panel, so anything outside this set is dropped, never
 * trimmed or truncated into something it did not say.
 */
const API_CLIENT_PATTERN = /^[A-Za-z0-9._/-]{1,64}$/;

interface CorrelationStore {
  requestId?: string;
  scanId?: number;
  apiVersion?: ApiVersion;
  client?: string;
}

const storage = new AsyncLocalStorage<CorrelationStore>();

/** The header middleware.ts sets on the request and echoes on the response. */
export const REQUEST_ID_HEADER = "x-request-id";

/** The header a first-party client names itself with. */
export const API_CLIENT_HEADER = "x-vulnradar-client";

/** The header value if it is a usable id, otherwise null. */
export function normalizeRequestId(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** The header value if it is a usable client name, otherwise null. */
export function normalizeApiClient(
  value: string | null | undefined,
): string | null {
  return value && API_CLIENT_PATTERN.test(value) ? value : null;
}

/** Run `fn` with `requestId` as the ambient id for everything it awaits. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ ...storage.getStore(), requestId }, fn);
}

/**
 * Run `fn` with `scanId` as the ambient scan for everything it awaits,
 * keeping any request id already in scope. A value that is not a positive
 * integer is ignored rather than stored, since it lands in an INTEGER column.
 */
export function runWithScanId<T>(scanId: number, fn: () => T): T {
  if (!Number.isSafeInteger(scanId) || scanId <= 0) return fn();
  return storage.run({ ...storage.getStore(), scanId }, fn);
}

/**
 * Run `fn` knowing which API version answers this request and which client
 * asked, keeping any ids already in scope.
 */
export function runWithApiContext<T>(
  context: { apiVersion: ApiVersion; client: string | null },
  fn: () => T,
): T {
  return storage.run(
    {
      ...storage.getStore(),
      apiVersion: context.apiVersion,
      client: context.client ?? undefined,
    },
    fn,
  );
}

/** The ambient id, or null outside a request (boot, cron, worker tick). */
export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

/** The ambient scan id, or null outside runWithScanId. */
export function currentScanId(): number | null {
  return storage.getStore()?.scanId ?? null;
}

/** The answering API version, or null outside versioned(). */
export function currentApiVersion(): ApiVersion | null {
  return storage.getStore()?.apiVersion ?? null;
}

/** The validated client name, or null when the request named none. */
export function currentApiClient(): string | null {
  return storage.getStore()?.client ?? null;
}
