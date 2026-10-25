/**
 * The two things every scan LIST endpoint has to do to a scan_history row
 * before it leaves the server, shared by GET /api/v3/history and GET
 * /api/v3/dashboard so the two cannot disagree about one scan.
 *
 * 1. Say whether the scan finished all of its work. `result_meta.incomplete`
 *    lists the areas that never ran (a timed-out TLS branch, a bot challenge,
 *    an unreachable page), and a scan with nothing found AND an area never
 *    read is not a clean result. The list SELECTs used to leave result_meta
 *    out, so the row had no way to know, and drew a green "Clean" for a scan
 *    that had looked at part of the host.
 *
 * 2. Never hand back the stored error string unmodified. The column can hold
 *    a pg driver error naming an internal table or a socket error naming a
 *    private IP and port, which is why GET /api/v3/scan/status/[id] already
 *    routes it through publicScanErrorMessage. The list endpoints, which
 *    accept API keys too, did not.
 */
import { publicScanErrorMessage } from "@/lib/api/scan-error-message";

/**
 * SQL for a boolean "this scan did not look at everything", read off the
 * `incomplete` array in a result_meta column.
 *
 * Only a non-empty array counts. An absent key, a null column (rows from
 * before result_meta existed) and an empty array are all "finished". The CASE
 * keeps jsonb_array_length from ever seeing a non-array, which would raise
 * rather than return false: PostgreSQL does not promise to short-circuit an
 * AND.
 *
 * `column` is a column reference written by the caller (`sh.result_meta`),
 * never user input, so it is interpolated.
 */
export function incompleteFlagSql(column: string): string {
  return `CASE WHEN jsonb_typeof(${column} -> 'incomplete') = 'array'
              THEN jsonb_array_length(${column} -> 'incomplete') > 0
              ELSE false END`;
}

/**
 * The row with its error_message made safe to show the person who ran the
 * scan.
 *
 * A row with no error_message (the common case: a scan that worked) is
 * returned untouched. publicScanErrorMessage turns a missing value into "The
 * scan failed.", which is right for a failed row and wrong for a completed
 * one, and adding the key to every row would change the shape of the list for
 * every consumer that never asked for it.
 */
export function withPublicErrorMessage<T extends object>(row: T): T {
  const stored = (row as { error_message?: unknown }).error_message;
  if (typeof stored !== "string") return row;
  return { ...row, error_message: publicScanErrorMessage(stored) };
}
