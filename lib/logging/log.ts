/**
 * The one way to log a failure. See STYLE.md, "Logging".
 *
 * Every console.error is persisted to system_error_logs by
 * lib/database/error-log-capture.ts, and that capture keeps a stack trace only
 * when one of the arguments IS an Error. Around ninety call sites passed
 * `err instanceof Error ? err.message : err` instead, so the row an operator
 * opened said "connection terminated" and nothing about where. Others put the
 * scan or user id nowhere, or nowhere consistent.
 *
 * This fixes the shape rather than the call sites one by one:
 *
 *   logError("scan", "scan failed", err, { scanId, userId, url });
 *
 * prints `[scan] scan failed { scanId: 12, ... } Error: ...` and stores the
 * same, with the stack. The context comes before the error so it survives the
 * capture's 2,000-character message cut even when the stack does not.
 */

/** Ids and short facts about the failure. Never an address, token or body. */
export type LogContext = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * @param scope   Short area tag, written as `[scope]`: "scan", "billing".
 * @param message What failed, in words. Ids go in `ctx`, not in here.
 * @param err     The thing that was thrown, passed through unchanged. An
 *                Error keeps its stack; never pass `err.message`.
 * @param ctx     Ids that let the row be found again: scanId, userId, ...
 */
export function logError(
  scope: string,
  message: string,
  err?: unknown,
  ctx?: LogContext,
): void {
  const args: unknown[] = [`[${scope}] ${message}`];
  const context = compact(ctx);
  if (context) args.push(context);
  if (err !== undefined) args.push(err);
  console.error(...args);
}

/** Drop undefined entries, and the whole object when nothing is left. */
function compact(ctx: LogContext | undefined): LogContext | null {
  if (!ctx) return null;
  const out: LogContext = {};
  let any = false;
  for (const [key, value] of Object.entries(ctx)) {
    if (value === undefined) continue;
    out[key] = value;
    any = true;
  }
  return any ? out : null;
}
