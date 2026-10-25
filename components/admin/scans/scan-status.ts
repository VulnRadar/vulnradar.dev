import {
  FAILURE_KIND_LABELS,
  isEngineFailure,
  isFailureKind,
} from "@/lib/scanner/failure-kinds";
import type { AdminStatusTone } from "@/components/admin/shared/status-pill";

/**
 * How the admin panel names a scan's state.
 *
 * `failed` is one status for six different outcomes (see
 * lib/scanner/failure-kinds.ts), and a pending or cancelled scan has 0
 * findings exactly like a clean one, so a list that printed "0 findings" for
 * all of them told an operator investigating "my scans keep failing" that
 * everything was fine. The reason beside a failed row is what the operator
 * reads, and its tone separates the engine breaking (red) from a down target
 * (amber) from somebody pressing Cancel (grey).
 */
export interface ScanStatusPill {
  tone: AdminStatusTone;
  label: string;
}

export function scanStatusPill(scan: {
  status: string;
  failure_kind?: string | null;
}): ScanStatusPill {
  switch (scan.status) {
    case "pending":
      return { tone: "info", label: "Queued" };
    case "running":
      return { tone: "info", label: "Running" };
    case "completed":
      return { tone: "ok", label: "Completed" };
    case "failed": {
      const kind = scan.failure_kind;
      if (isEngineFailure(kind)) {
        return {
          tone: "crit",
          label: isFailureKind(kind) ? FAILURE_KIND_LABELS[kind] : "Failed",
        };
      }
      // Not an engine failure, so it is one of the kinds the user, a limit or
      // the target caused. A down target is worth a glance; a cancel is not.
      const label = isFailureKind(kind) ? FAILURE_KIND_LABELS[kind] : "Failed";
      return {
        tone: kind?.startsWith("target_") ? "warn" : "neutral",
        label,
      };
    }
    default:
      return { tone: "neutral", label: scan.status };
  }
}
