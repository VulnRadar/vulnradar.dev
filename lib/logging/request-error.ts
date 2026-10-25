/**
 * What instrumentation.ts's onRequestError records.
 *
 * Next.js calls that hook for every error nothing caught: a route handler that
 * throws outside withErrorHandling (most of them do, see the note in
 * lib/database/request-context.ts), a server component that fails to render, a
 * server action. Without it such an error reached the log as a bare stack with
 * nothing saying which URL, route or request it belonged to, and with a
 * NULL request_id, because the request context is only entered by the wrapper.
 *
 * Kept out of instrumentation.ts so it can be unit tested and so the edge
 * bundle of that file never pulls in node:async_hooks.
 */
import { logError } from "@/lib/logging/log";
import { redactPathTokens } from "@/lib/logging/redact-path";
import {
  REQUEST_ID_HEADER,
  normalizeRequestId,
  runWithRequestId,
} from "@/lib/database/request-context";

/** The slice of Next's request-error arguments this reads. */
export interface RequestErrorRequest {
  path: string;
  method: string;
  headers: NodeJS.Dict<string | string[]>;
}

export interface RequestErrorContext {
  routePath: string;
  routeType: string;
  renderSource?: string;
}

export function reportRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
): void {
  const header = request.headers[REQUEST_ID_HEADER];
  const requestId = normalizeRequestId(
    Array.isArray(header) ? header[0] : header,
  );
  // The path without its query string: that is where reset tokens, OAuth
  // codes and email addresses end up, and a row an admin can read should not
  // carry them. A token in the path itself (/staff-invite/[token]) is masked
  // too; routePath, below, still says which route it was.
  const path = redactPathTokens(request.path.split("?")[0]);
  const digest =
    error && typeof error === "object" && "digest" in error
      ? String((error as { digest?: unknown }).digest ?? "")
      : "";

  const write = () =>
    logError("route-error", `${request.method} ${path} threw`, error, {
      method: request.method,
      path,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
      requestId: requestId ?? undefined,
      digest: digest || undefined,
    });

  // Entered here so the row's request_id column is set as well as the printed
  // line, which is what the Error Logs filter matches on.
  if (requestId) runWithRequestId(requestId, write);
  else write();
}
