import { X } from "lucide-react";

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
    <div className="mx-auto max-w-lg w-full -mt-2 mb-2 rounded-xl border border-border bg-card/60 px-4 py-3 flex items-center justify-between gap-3">
      <p className="text-sm text-foreground">
        Bulk scan complete &mdash;{" "}
        <span className="text-emerald-500 font-medium">
          {result.successful} succeeded
        </span>
        {result.failed > 0 && (
          <span className="text-destructive font-medium">
            , {result.failed} failed
          </span>
        )}
        {result.skipped > 0 && (
          <span className="text-muted-foreground">
            , {result.skipped} skipped (limit)
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs text-muted-foreground hover:text-foreground shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
