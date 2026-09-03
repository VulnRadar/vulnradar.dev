import { Lock } from "lucide-react";
import { cn } from "@/lib/ui/utils";

/**
 * Shared between the just-scanned results view (dashboard-results.tsx) and
 * the history detail header, so both mark an authenticated scan the same
 * way instead of drifting into two lookalike badges.
 */
export function AuthenticatedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary",
        className,
      )}
    >
      <Lock aria-hidden className="h-3 w-3" />
      Authenticated
    </span>
  );
}
