import { ALL_ADMIN_NAV_ITEMS, type AdminTabKey } from "@/components/admin/nav";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SkeletonForm,
  SkeletonRegion,
} from "@/components/shared/skeleton-shapes";
import {
  DataTableSkeleton,
  FactPanelSkeleton,
  HealthCardSkeleton,
  LogListSkeleton,
  PanelHeaderSkeleton,
  QueueBodySkeleton,
  RowListSkeleton,
  SettingsFieldsSkeleton,
  StatBarSkeleton,
} from "./skeleton";

/**
 * One table describing the shape of every admin destination, and one component
 * that draws it.
 *
 * This lived inside app/admin/page.tsx, where only the dynamic() fallbacks
 * could reach it. Three other places need the same answer and each had its own:
 * app/admin/loading.tsx drew the Overview health card for all 21 tabs, several
 * panels drew a third shape from their own pre-fetch branch, and none of the
 * three agreed with the others. Keyed by AdminTabKey, so a destination added to
 * VALID_TABS without a shape here is a type error rather than a tab that
 * silently loads as something else.
 *
 * The shapes are read off the real panels. What is not derivable stays honest
 * about it: a count that only the loaded data knows is reserved at the number
 * the panel asks its API for, and a card whose body cannot be predicted is
 * drawn as a header and nothing else, because reserving the wrong body is what
 * this table exists to stop.
 */

type BodyKind =
  /** TableScrollArea + Table, the shape most directories arrive in. */
  | "table"
  /** A divided list of tall rows with a leading icon tile. */
  | "rows"
  /** The log viewers' one-line-plus-metadata rows. */
  | "logs"
  /** SettingField clusters. */
  | "settings"
  /** A stack of label + input pairs (Compose Broadcast, Add Access Rule). */
  | "form"
  /** Scanner Queue's in-card count strip over its two age cells. */
  | "queue"
  /** A short block of explanatory prose (Blocked Data's warning card). */
  | "note"
  /** Nothing below the header. */
  | "none";

export interface CardShape {
  /**
   * "panel" is AdminPanelHeader: a 32px icon tile, a title, a subtitle and an
   * action cluster. "plain" is the hand-rolled band Revenue uses, a heading
   * over a line of prose on a muted ground with no tile and no action. "none"
   * is a card that starts straight into its body.
   */
  header?: "panel" | "plain" | "none";
  /** Control rows below the heading: a search field, a chip row, or both. */
  filterRows?: number;
  body?: BodyKind;
  /** Rows in the body. The panel's own page size where it has one. */
  rows?: number;
}

export interface PanelShape {
  /**
   * The panel opens with a bare h2 and a paragraph above its cards instead of
   * putting its title in the first card's header. Three do.
   */
  heading?: boolean;
  /** Cells in the panel's stat strip, or one entry per strip for the panels
   *  that stack two (the user directory does). Omitted means no strip. */
  stats?: number | number[];
  /** Panels that open with a fact grid and an action row (Backups, Updater)
   *  rather than a header over a body. */
  facts?: number;
  /** Overview is the System Health card and nothing else. */
  health?: boolean;
  /** Support tickets is a two-pane mail layout, not a stack of cards. */
  panes?: boolean;
  /** The cards below all of the above, in order. Defaults to a single
   *  header-over-table card. */
  cards?: CardShape[];
}

export const ADMIN_PANEL_SHAPES: Record<AdminTabKey, PanelShape> = {
  overview: { health: true },
  "queue-status": { cards: [{ body: "queue" }] },
  "error-logs": { cards: [{ filterRows: 1, body: "logs" }] },
  "email-logs": { cards: [{ filterRows: 1, body: "logs" }] },
  backup: { facts: 3, cards: [{ body: "logs", rows: 5 }] },
  // Updater's second card only exists while an install job is running, so it
  // is not part of the resting shape.
  updater: { facts: 4 },
  users: { stats: [5, 5], cards: [{ filterRows: 1, body: "table" }] },
  teams: { cards: [{ filterRows: 1, body: "table" }] },
  admins: { stats: 5, cards: [{ body: "table" }] },
  // Two cards: the filter card carries the category chips and the search box
  // and has no body at all, and the entries below it are a bare table with no
  // header of their own.
  audit: {
    stats: 4,
    cards: [
      { filterRows: 2, body: "none" },
      { header: "none", body: "table" },
    ],
  },
  "support-tickets": { heading: true, panes: true },
  "ai-chats": {
    heading: true,
    stats: 4,
    cards: [{ filterRows: 1, body: "table" }],
  },
  "security-alerts": { stats: 5, cards: [{ body: "rows", rows: 4 }] },
  "access-rules": {
    stats: 4,
    cards: [{ body: "form" }, { filterRows: 1, body: "table" }],
  },
  "blocked-data": {
    stats: 3,
    cards: [
      { header: "none", body: "note" },
      { body: "form" },
      { filterRows: 1, body: "rows", rows: 5 },
    ],
  },
  content: { cards: [{ filterRows: 1, body: "table" }] },
  broadcast: {
    stats: 3,
    cards: [{ body: "form" }, { body: "rows", rows: 5 }],
  },
  notifications: { stats: 4, cards: [{ body: "rows", rows: 5 }] },
  "billing-overview": {
    stats: 5,
    cards: [
      { header: "plain", body: "table", rows: 4 },
      { header: "plain", body: "table", rows: 3 },
    ],
  },
  settings: {
    cards: [{ filterRows: 1, body: "settings" }, { body: "none" }],
  },
  "engine-feedback": {
    heading: true,
    cards: [
      { filterRows: 1, body: "table" },
      { body: "table", rows: 4 },
      { body: "table", rows: 3 },
    ],
  },
};

const DEFAULT_CARDS: CardShape[] = [{ body: "table" }];

function CardBody({ body, rows }: { body: BodyKind; rows: number }) {
  switch (body) {
    case "table":
      //: the card around it already draws the border, and the
      // real body is a CardContent at p-0 with the table flush inside it.
      return <DataTableSkeleton rows={rows} />;
    case "rows":
      return <RowListSkeleton rows={rows} />;
    case "logs":
      return <LogListSkeleton rows={rows} />;
    case "settings":
      return (
        <div className="p-4 sm:p-5">
          <SettingsFieldsSkeleton />
        </div>
      );
    case "form":
      return (
        <div className="p-4 sm:p-5">
          <SkeletonForm fields={3} />
        </div>
      );
    case "queue":
      return (
        <div className="px-4 sm:px-5 py-5">
          <QueueBodySkeleton />
        </div>
      );
    case "note":
      return (
        <div className="p-4 space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      );
    case "none":
      return null;
  }
}

function PanelCard({
  header = "panel",
  filterRows = 0,
  body = "table",
  rows = 6,
}: CardShape) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
      {header === "panel" && <PanelHeaderSkeleton filterRows={filterRows} />}
      {header === "plain" && (
        <div className="border-b border-border/40 bg-muted/30 p-4 sm:p-5 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-full max-w-[60ch]" />
        </div>
      )}
      <CardBody body={body} rows={rows} />
    </div>
  );
}

/**
 * One admin destination's placeholder, in its own live region, named after the
 * destination.
 *
 * The name comes from the nav table, so it is the same word the operator
 * clicked and it cannot drift from it. Every caller that draws a whole tab goes
 * through this rather than PanelSkeleton directly: the fallbacks announced
 * nothing at all, so a screen reader user got silence between clicking a
 * section and its content arriving.
 */
export function AdminPanelSkeleton({ tab }: { tab: AdminTabKey }) {
  const label = ALL_ADMIN_NAV_ITEMS.find((item) => item.key === tab)?.label;
  return (
    <SkeletonRegion label={label ? `Loading ${label}` : "Loading section"}>
      <PanelSkeleton {...ADMIN_PANEL_SHAPES[tab]} />
    </SkeletonRegion>
  );
}

/**
 * The placeholder for one admin destination.
 *
 * Called with a shape from ADMIN_PANEL_SHAPES, never with a hand-written one:
 * the whole point of the table is that the fallback, the route skeleton and
 * the panel's own pre-fetch state cannot describe the same tab differently.
 *
 * No live region of its own. AdminDataSkeleton already wraps the sidebar and
 * the panel in one, and a second nested status region means the same load is
 * announced twice. AdminPanelSkeleton above is the labelled entry point for
 * callers that are not already inside a region.
 */
export function PanelSkeleton({
  heading,
  stats,
  facts,
  health,
  panes,
  cards = DEFAULT_CARDS,
}: PanelShape) {
  if (health) return <HealthCardSkeleton />;

  return (
    <div className={facts !== undefined ? "space-y-6" : "space-y-4"}>
      {heading && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-full max-w-[54ch]" />
          </div>
          <Skeleton className="h-9 w-24 rounded-md shrink-0" />
        </div>
      )}

      {/* The strip sits above the cards, which is where every panel that has
          one puts it (see components/admin/users/users-tab.tsx). Scanner Queue
          is the exception and keeps its strip in the card body instead, which
          is why that one is a body kind rather than a `stats` count. */}
      {stats !== undefined && (
        <div className="space-y-3">
          {(Array.isArray(stats) ? stats : [stats]).map((segments, i) => (
            <StatBarSkeleton key={i} segments={segments} />
          ))}
        </div>
      )}

      {facts !== undefined && <FactPanelSkeleton facts={facts} />}

      {panes ? (
        <>
          {/* The filter chip row above the panes. */}
          <div className="flex gap-1.5">
            {[16, 20, 24, 18].map((w, i) => (
              <Skeleton
                key={i}
                className="h-6 rounded-full"
                style={{ width: `${w * 0.25}rem` }}
              />
            ))}
          </div>
          <div className="grid gap-4 lg:h-[38rem] lg:grid-cols-[minmax(0,21rem)_1fr]">
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
              <RowListSkeleton
                rows={4}
                lead="none"
                lines={3}
                trailing={false}
              />
            </div>
            <div className="hidden lg:block rounded-xl border border-border/60 bg-card" />
          </div>
        </>
      ) : (
        cards.map((card, i) => <PanelCard key={i} {...card} />)
      )}
    </div>
  );
}
