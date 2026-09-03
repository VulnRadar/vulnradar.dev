import { cn } from "@/lib/ui/utils";
import { StatStripSkeleton } from "@/components/shared/stat-strip";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Re-exported, not redefined. This file used to declare a second base
 * `Skeleton` primitive with a different default radius (`rounded`, 4px) from
 * the app-wide one in components/ui/skeleton.tsx (`rounded-md`, 6px), so every
 * admin placeholder sat a rung below every other placeholder in the product.
 * Two primitives is the drift vector itself: there is one now.
 */
export { Skeleton };

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
 * Eight rows, not six: buildHealthRows (features/health-overview-utils.ts)
 * emits scan queue (two), backup, error logs, email, security alerts, support
 * tickets and staff invites, plus a ninth when an update is available.
 */
export function HealthListSkeleton({ rows = 8 }: { rows?: number }) {
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
  /** Panels whose header carries a search field or filter row below the
   *  heading (users, audit, blocked data, and friends). */
  withFilterRow = false,
}: {
  withFilterRow?: boolean;
}) {
  return (
    <div className="border-b border-border/50 px-4 sm:px-5 pt-5 pb-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
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
      {withFilterRow && <Skeleton className="h-9 w-full rounded-md" />}
    </div>
  );
}

/**
 * The Card an admin tab loads into: the panel header over its body, at the
 * geometry every panel actually uses (a rounded-lg Card whose CardContent is
 * p-0, so the body's own rows sit flush against the header). The dynamic()
 * fallback in app/admin/page.tsx used to wrap DataTableSkeleton, which carries
 * its own border, in a second bordered rounded-xl box: a nested double border
 * one rung too large, around a body no panel has.
 */
export function PanelCardSkeleton({
  children,
  withFilterRow = false,
}: {
  children: React.ReactNode;
  withFilterRow?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
      <PanelHeaderSkeleton withFilterRow={withFilterRow} />
      {children}
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
 * Skeleton for a data table: header bar + N rows, matches the
 * TableScrollArea + Table pattern used across the admin panel.
 */
export function DataTableSkeleton({
  rows = 6,
  bordered = true,
}: {
  rows?: number;
  /** Off when the table sits inside PanelCardSkeleton, which already draws the
   *  Card border. The real panels put the table in a CardContent at p-0, with
   *  no border of its own. */
  bordered?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden",
        bordered && "rounded-lg border border-border/50",
      )}
    >
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
