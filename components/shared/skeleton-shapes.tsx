import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/ui/utils";

/**
 * Declarative placeholders for the region of a page that is actually waiting
 * on data. AppPageShell holds the chrome; these fill the hole in it.
 *
 * The point is that a skeleton stops being drawing and becomes a description.
 * The old assets table placeholder was seventeen lines of nested divs
 * restating "rounded-xl border, divide-y, a two-line leading cell, three
 * trailing cells that hide below sm". Every one of those numbers was a second
 * copy of a decision made in the real table, and nothing checked the two still
 * agreed. `<SkeletonRows rows={6} lead trailing={[16, 20, 14]} />` says the
 * same thing in one line, and the shared container styling means a change to
 * how a list looks lands in one file instead of eleven.
 *
 * Widths are in Tailwind spacing units (w-16 etc) rather than pixels or
 * percentages: the surrounding tables are built from the same scale, so a
 * placeholder cell and the real cell round to the same box.
 */

/**
 * The list/table shape: a bordered, divided container of uniform rows.
 *
 * `lead` gives the first cell the two-line treatment every one of our tables
 * uses for its primary column (a name over a muted sub-label). `trailing`
 * hides below sm because the real tables do, which is the detail the
 * hand-written copies most often got wrong: a placeholder showing four columns
 * on a phone, then reflowing to one the instant data arrived.
 */
export function SkeletonRows({
  rows = 6,
  lead = true,
  trailing = [16, 20, 14],
  className,
}: {
  rows?: number;
  lead?: boolean;
  trailing?: number[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border overflow-hidden divide-y divide-border",
        className,
      )}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3.5 px-4">
          {lead ? (
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ) : (
            <Skeleton className="h-4 flex-1 min-w-0" />
          )}
          {trailing.map((w, j) => (
            <Skeleton
              key={j}
              className="hidden sm:block h-4 shrink-0"
              style={{ width: `${w * 0.25}rem` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Stacked label/field pairs for a settings or form panel. */
export function SkeletonForm({
  fields = 3,
  className,
}: {
  fields?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-5", className)}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}

/**
 * Wraps a waiting region so screen readers are told once that something is
 * loading, and told what.
 *
 * It carries the status role instead of the page's <main>, which is where the
 * old whole-page skeletons put it. That mattered: <main> keeps the role for
 * the entire life of the page, so every later update inside it (a filter
 * change, a fetch, a toast) got announced as though the page were loading
 * again. Scoping it to the region means the role disappears with the region.
 */
export function SkeletonRegion({
  label,
  children,
  className,
}: {
  /** e.g. "Loading your hosts". Read out verbatim, so name the content. */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn("flex flex-col gap-5", className)}
    >
      {children}
    </div>
  );
}
