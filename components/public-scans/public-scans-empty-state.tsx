import { Globe } from "lucide-react";

export function PublicScansEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card/50 px-4 py-14 text-center">
      <Globe aria-hidden className="h-6 w-6 text-muted-foreground/60" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">
          No public scans yet
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Share a scan and list it publicly from the Shared page to be the first
          one here.
        </p>
      </div>
    </div>
  );
}
