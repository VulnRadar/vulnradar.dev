import { Loader2 } from "lucide-react";

/**
 * Shared loading spinner for route-level `loading.tsx` files.
 *
provides a consistent, centered loading indicator
 * for client-side route transitions. Each route that may take a moment
 * to fetch its initial data exports its own `loading.tsx` that wraps
 * this component.
 */
export function RouteLoadingSpinner({
  label = "Loading...",
}: {
  label?: string;
}) {
  return (
    <div
      className="min-h-[60vh] flex flex-col items-center justify-center gap-3 px-4"
      role="status"
      aria-live="polite"
    >
      <Loader2
        className="h-8 w-8 animate-spin text-primary"
        aria-hidden="true"
      />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export default RouteLoadingSpinner;
