import { X, ListChecks } from "lucide-react";

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
    <div className="mx-auto max-w-2xl w-full -mt-2 mb-2 rounded-xl border border-border/50 bg-card/50 px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
          <ListChecks className="h-3.5 w-3.5 text-primary" />
        </div>
        <p className="text-sm text-foreground">
          Bulk scan complete
          <span aria-hidden className="text-muted-foreground/50 mx-1.5">
            ·
          </span>
          <span className="text-emerald-500 font-medium tabular-nums">
            {result.successful} succeeded
          </span>
          {result.failed > 0 && (
            <span className="text-destructive font-medium tabular-nums">
              <span aria-hidden className="text-muted-foreground/50 mx-1">
                ·
              </span>
              {result.failed} failed
            </span>
          )}
          {result.skipped > 0 && (
            <span className="text-muted-foreground">
              <span aria-hidden className="text-muted-foreground/50 mx-1">
                ·
              </span>
              {result.skipped} skipped (limit)
            </span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
