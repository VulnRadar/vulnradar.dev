import Link from "next/link";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SharesEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card/50 px-4 py-14 text-center">
      <Share2 aria-hidden className="h-6 w-6 text-muted-foreground/60" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">
          Nothing shared yet
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Open a scan in your history and hit Share to hand out a read-only
          link. Anyone with it sees the findings, no account required.
        </p>
      </div>
      <Button asChild size="sm" className="mt-1">
        <Link href="/history">Go to history</Link>
      </Button>
    </div>
  );
}
