import Link from "next/link";
import { X } from "lucide-react";
import { ROUTES } from "@/lib/config/constants";

interface DashboardBulkResultProps {
  result: {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
    /** Set when the whole batch was refused (bulk scanning switched off for
     *  the deployment, a rejected request, a server or network failure). The
     *  counts alone would report that as "0 of 10 queued, 10 were refused",
     *  which is true and says nothing about why. */
    error?: string;
  };
  onDismiss: () => void;
}

export function DashboardBulkResult({
  result,
  onDismiss,
}: DashboardBulkResultProps) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3">
      {/* "Scanned" was a lie. POST /api/v3/scan/bulk queues background jobs
          and returns immediately, so this count is scans accepted, not scans
          finished: it hit its total the instant the request was
          acknowledged, while every scan was still running server-side, and
          any that later failed was counted as a success. Say "queued", which
          is what the number actually is. */}
      <p className="min-w-0 text-sm text-foreground" role="status">
        {result.error ? (
          <span className="text-destructive">{result.error}</span>
        ) : (
          <>
            <span className="font-semibold tabular-nums">
              {result.successful}
            </span>{" "}
            of <span className="tabular-nums">{result.total}</span> scans
            queued. They appear in your history as each one finishes.
          </>
        )}
        {!result.error && result.failed > 0 && (
          <>
            {" "}
            <span className="font-semibold tabular-nums text-destructive">
              {result.failed}
            </span>{" "}
            <span className="text-muted-foreground">were refused.</span>
          </>
        )}
        {!result.error && result.skipped > 0 && (
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
            className="rounded-md px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open in history
          </Link>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Dismiss bulk scan summary"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
