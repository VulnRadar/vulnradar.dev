import { Skeleton } from "@/components/ui/skeleton";

const BUBBLE_WIDTHS = ["w-2/3", "w-1/2", "w-3/5", "w-2/5"];

/**
 * Mirrors AdminConversationPage's loaded layout (the user info card, then
 * alternating message bubbles) so the loading state doesn't reflow into a
 * differently-shaped page once the conversation fetch resolves.
 */
export function ConversationSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-live="polite"
      aria-label="Loading conversation"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl border border-border/50 bg-card/50">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Skeleton className="h-9 w-9 rounded-full shrink-0" />
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 items-start sm:items-end shrink-0">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {BUBBLE_WIDTHS.map((width, i) => (
          <div
            key={i}
            className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
          >
            <Skeleton
              className={`h-14 ${width} max-w-[85%] sm:max-w-[70%] rounded-2xl`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
