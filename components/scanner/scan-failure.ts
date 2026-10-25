import { isFailureKind, type FailureKind } from "@/lib/scanner/failure-kinds";
import type { ErrorKind } from "@/components/scanner/dashboard-error-state";

/**
 * Which failure screen a scan_history.failure_kind gets.
 *
 * The status route names why a scan ended `failed` (see
 * lib/scanner/failure-kinds.ts), and the dashboard used to ignore it and guess
 * from the sentence, which put a scan the user cancelled and a scan that ran
 * out of time under the same "The scan did not finish". Typed as a Record so
 * a kind added to FAILURE_KINDS fails the build here until it has a screen.
 *
 * Reuses the existing screens wherever their copy is true for the cause. The
 * target ones that have none of their own (a TLS failure, an off-host
 * redirect) fall to "generic", whose copy points at the scanner's own message
 * below it, which does name the cause.
 */
const KIND_FOR_FAILURE: Record<FailureKind, ErrorKind> = {
  cancelled: "cancelled",
  admin_cancelled: "cancelled",
  quota_refused: "rate_limit",
  not_run: "generic",
  interrupted: "server",
  stale: "server",
  timeout: "timeout",
  target_unreachable: "network",
  target_timeout: "network",
  target_tls: "generic",
  target_redirect_offhost: "generic",
  target_blocked: "blocked",
  internal: "server",
};

/**
 * The screen for a failure kind the status route sent, or undefined when it
 * sent none (a deployment that predates the field, or a row the backfill has
 * not reached) so the caller falls back to classifying the message.
 */
export function errorKindForFailure(
  failureKind: unknown,
): ErrorKind | undefined {
  return isFailureKind(failureKind) ? KIND_FOR_FAILURE[failureKind] : undefined;
}
