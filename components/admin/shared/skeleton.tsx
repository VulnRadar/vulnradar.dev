import { cn } from "@/lib/ui/utils";
import { StatStripSkeleton } from "@/components/shared/stat-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";
import { HEALTH_ROW_COUNT } from "@/components/admin/features/health-overview-utils";

/**
 * Re-exported, not redefined. This file used to declare a second base
 * `Skeleton` primitive with a different default radius (`rounded`, 4px) from
 * the app-wide one in components/ui/skeleton.tsx (`rounded-md`, 6px), so every
 * admin placeholder sat a rung below every other placeholder in the product.
 * Two primitives is the drift vector itself: there is one now.
 *
 * SkeletonRegion comes through here for the same reason: every shape below is
 * a body that sits inside a panel whose header is already on screen, so the
 * live region has to be declared at the call site that knows what is loading.
 * Re-exporting it keeps that one import line rather than sending twenty panels
 * to a second path for one component.
 */
export { Skeleton, SkeletonRegion };

// The five bespoke per-section skeletons that used to sit here
// (UsersListSkeleton, AuditLogSkeleton, UserDetailSkeleton, StaffListSkeleton,
// TeamsListSkeleton) are gone. They were written against an older card-row
// layout, were only ever reachable through this directory's wildcard barrel,
// and had zero importers: every admin section renders DataTableSkeleton or
// StatBarSkeleton below, which match the table layout the panel actually uses.
// Keeping shapes that mirror a layout the panel no longer has would produce
// MORE layout shift, not less, so the generic pair is the one to extend.

/**
 * Skeleton for the inline stat bar (see shared/stat-card.tsx StatBar).
 * Delegates to the shared strip's own skeleton so the two cannot drift: this
 * copy still drew the pre-consolidation container and had no icon square at
 * all, so every admin panel visibly reflowed the moment its counts landed.
 */
export function StatBarSkeleton({ segments = 5 }: { segments?: number }) {
  return <StatStripSkeleton cells={segments} size="sm" />;
}

/**
 * Skeleton for the Overview tab's health list: a dot, a label with its value
 * on the same baseline, and a one-line detail underneath, matching the rows
 * HealthOverview renders. Lives here rather than in health-overview.tsx so the
 * route-level loading.tsx (a server component, via AdminSkeleton) and the
 * card's own pre-fetch state can draw the same shape. Before this existed the
 * panel drew a stat strip and then a user table on the way to a status list,
 * so nothing that flashed resembled what arrived.
 *
 * The row count comes from buildHealthRows itself (HEALTH_ROW_COUNT), not from
 * a number typed here. The two used to disagree in exactly the way a hand-typed
 * count does: this file's comment said eight while HealthOverview passed six,
 * so the route drew eight rows, the card redrew six, and the list then arrived
 * at eight.
 */
export function HealthListSkeleton({
  rows = HEALTH_ROW_COUNT,
}: {
  rows?: number;
}) {
  return (
    <ul className="divide-y divide-border/50 border-t border-border/50">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 px-5 py-4">
          <Skeleton className="mt-1.5 h-2 w-2 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-3 w-full max-w-[46ch]" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The whole System Health card: state icon, title, refresh control, list.
 * Three separate skeletons used to stand in for this one panel on the way to
 * it (the route-level loading.tsx, the dynamic import's fallback, and the
 * card's own pre-fetch state), and none of the three was its shape.
 */
export function HealthCardSkeleton() {
  return (
    <div className="rounded-lg border border-border/50 bg-card/50 shadow-xs overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex items-center gap-3 min-w-0">
          <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-9 w-9 sm:w-[6.5rem] rounded-md shrink-0" />
      </div>
      <HealthListSkeleton />
    </div>
  );
}

/**
 * Skeleton for AdminPanelHeader (shared/panel-header.tsx), which 18 of the 19
 * lazily-loaded admin panels open with. The dynamic() fallback used to draw no
 * header at all, so roughly 130px of icon tile, title, subtitle and action row
 * appeared on top of every tab the moment its chunk landed.
 */
export function PanelHeaderSkeleton({
  /** Control rows below the heading. Most panels that have any have one, a
   *  search field; the audit log has two, a wrapping chip row over its search
   *  box, and drew one. */
  filterRows = 0,
}: {
  filterRows?: number;
}) {
  return (
    <div className="border-b border-border/50 px-4 sm:px-5 pt-5 pb-4 space-y-4">
      {/* Stacks below sm, because AdminPanelHeader does. Drawn side by side at
          every width, the placeholder was one row where the real header is two
          on a phone, so the whole panel jumped up by an action row's height the
          moment the header rendered. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {/* p-2 around a 16px glyph is a 32px tile at rounded-md. */}
          <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
          <div className="min-w-0 space-y-1">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-9 w-24 shrink-0 rounded-md" />
      </div>
      {Array.from({ length: filterRows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full rounded-md" />
      ))}
    </div>
  );
}

/**
 * Skeleton for a settings tab body: clustered rows of label + description
 * on the left, a control on the right, matching SettingField's layout in
 * system-settings-manager.tsx.
 */
export function SettingsFieldsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-border/40 overflow-hidden divide-y divide-border/40">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 px-4 sm:px-5 py-4"
        >
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full max-w-[30ch]" />
          </div>
          <Skeleton className="h-9 w-32 rounded-md shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for a divided log list (Error Logs, Email Logs): a subject line,
 * a metadata line under it, and a small trailing control. Deliberately NOT
 * DataTableSkeleton, which both log panels used to render: that one draws a
 * table header bar and a 36px round avatar per row, and neither panel has a
 * header row or an avatar, so the shape that flashed was not the shape that
 * arrived.
 */
export function LogListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border/40 border-t border-border/50">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-3.5 w-full max-w-[38ch]" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for a panel that opens with a fact grid and an action row
 * (Backups, Updater). Those two replaced their entire card with a centred
 * spinner in a `p-8` box, so the card visibly resized the moment the status
 * landed. This draws the header, the grid, and the button at the sizes they
 * actually render at.
 */
export function FactPanelSkeleton({
  facts = 3,
  actions = 1,
}: {
  facts?: number;
  actions?: number;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-border/50 px-4 sm:px-5 pt-5 pb-4">
        <div className="flex items-center gap-3 min-w-0">
          <Skeleton className="h-8 w-8 rounded-md shrink-0" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-9 w-9 sm:w-[6.5rem] rounded-md shrink-0" />
      </div>
      <div className="p-4 sm:p-5 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {Array.from({ length: facts }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {Array.from({ length: actions }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-36 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton for a divided list of tall rows: a square tile, a couple of text
 * lines and a trailing control. Broadcasts, Security Alerts, Site
 * Notifications and Blocked Rules all render this and all four drew
 * DataTableSkeleton on the way to it, which put a 40px table header bar and a
 * round avatar into a panel that has neither.
 *
 * `boxed` is the modal variant (Team Members): separately bordered rows in a
 * gap stack rather than dividers inside a card.
 */
export function RowListSkeleton({
  rows = 5,
  lead = "tile",
  lines = 2,
  trailing = true,
  boxed = false,
}: {
  rows?: number;
  /** The row's leading element: a 40px rounded-lg icon tile, a round avatar,
   *  or nothing. */
  lead?: "tile" | "avatar" | "none";
  /** Text lines in the row body, below the title line. */
  lines?: number;
  trailing?: boolean;
  boxed?: boolean;
}) {
  return (
    // No border-t, unlike LogListSkeleton: the four panels that render this
    // shape (Broadcasts, Security Alerts, Site Notifications, Blocked Rules)
    // put the list in a plain `divide-y` container under a header that already
    // draws the line, where the log panels' own list carries one.
    <div className={cn(boxed ? "space-y-2" : "divide-y divide-border/40")}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "flex items-start gap-3",
            boxed
              ? "rounded-lg border border-border/50 bg-muted/30 p-3"
              : "px-4 sm:px-5 py-4",
          )}
        >
          {lead !== "none" && (
            <Skeleton
              className={cn(
                "shrink-0",
                lead === "avatar" ? "h-8 w-8 rounded-full" : "h-10 w-10",
              )}
            />
          )}
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            {Array.from({ length: lines }).map((_, j) => (
              <Skeleton
                key={j}
                className={cn("h-3", j === lines - 1 ? "w-1/2" : "w-full")}
              />
            ))}
          </div>
          {trailing && (
            <Skeleton className="h-5 w-16 rounded-full shrink-0 mt-0.5" />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The Scanner Queue card's body: the count strip and the two age cells, inside
 * the card's own padding. The strip is the only admin stat strip that lives
 * INSIDE its card rather than above it, which is why this is a body shape
 * rather than the `stats` option every other panel uses. The panel drew the
 * strip alone while it waited, so the age grid dropped in underneath it.
 */
export function QueueBodySkeleton() {
  return (
    <div className="space-y-4">
      <StatBarSkeleton segments={4} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-md border border-border/40 bg-muted/20 px-3 py-2.5 space-y-1.5"
          >
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-full max-w-[34ch]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton for a data table: header bar + N rows, matches the
 * TableScrollArea + Table pattern used across the admin panel.
 *
 * No border and no padding of its own, because there is nowhere in the panel
 * where a table has either: every one sits in a CardContent at p-0 inside a
 * card that draws the border. The `bordered` option this used to carry made
 * the wrong thing the default, and eleven call sites took it, each wrapping
 * the result in its own `p-4 sm:p-5` box on top. A double border, inset from
 * a header the real table sits flush against.
 */
export function DataTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden">
      <div className="h-10 bg-muted/30 border-b border-border/50" />
      <div className="divide-y divide-border/40">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-4">
            <Skeleton className="h-9 w-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
