import Link from "next/link";
import { X } from "lucide-react";
import { ROUTES } from "@/lib/config/constants";

interface DashboardBulkResultProps {
  result: {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
  };
  onDismiss: () => void;
}

export function DashboardBulkResult({
  result,
  onDismiss,
}: DashboardBulkResultProps) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-card px-4 py-3">
      <p className="min-w-0 text-sm text-foreground">
        Bulk run finished.{" "}
        <span className="font-semibold tabular-nums">{result.successful}</span>{" "}
        of <span className="tabular-nums">{result.total}</span> scanned.
        {result.failed > 0 && (
          <>
            {" "}
            <span className="font-semibold tabular-nums text-destructive">
              {result.failed}
            </span>{" "}
            <span className="text-muted-foreground">failed.</span>
          </>
        )}
        {result.skipped > 0 && (
          <>
            {" "}
            <span className="font-semibold tabular-nums text-[hsl(var(--severity-medium))]">
              {result.skipped}
            </span>{" "}
            <span className="text-muted-foreground">
              skipped, you hit the scan limit.
            </span>
          </>
        )}
      </p>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {result.successful > 0 && (
          <Link
            href={ROUTES.HISTORY}
            className="rounded px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open in history
          </Link>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Dismiss bulk scan summary"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
