import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { StatIcon, type StatTone } from "@/components/shared/stat-icon";

/**
 * The joined stat strip: one bordered strip of cells divided by a hairline,
 * not four separate cards.
 *
 * The shape was already right and consistent, but it was implemented six
 * times: a byte-identical `Cell` in history-stats, assets-stats and
 * shares-stats, a `StatCell` in the dashboard, a `Stat` in scan-summary, and a
 * `StatBar` in admin. The value type size differed three ways and the
 * container two, so the same element read differently on four adjacent pages
 * and the loading skeleton could drift from the loaded state. One component
 * now, two documented densities.
 *
 * `size="md"` is the page-opening strip (24px value, 2-up on mobile, 4-up
 * above sm). `size="sm"` is the compact in-panel strip (14px value, cells
 * flowing to fit).
 */
export interface StatStripItem {
  /** Numbers are locale-formatted; strings are printed verbatim. */
  value: string | number;
  label: string;
  /** Optional: a segment without one is just the number and its label. */
  icon?: LucideIcon;
  /** Icon container colour. Falls back to muted when the value is zero. */
  iconTone?: StatTone;
  /** Value colour when the value is non-zero. */
  textTone?: string;
  /**
   * Makes the segment a real button. The admin panels use this to filter the
   * table rendered below the strip by the count that was clicked, so the
   * segment has to be focusable and expose its pressed state, not just take a
   * click on a div.
   */
  onClick?: () => void;
  /** Pressed state for an `onClick` segment. Ignored without one. */
  active?: boolean;
}

const CONTAINER = "overflow-hidden rounded-xl border border-border bg-border";

/**
 * Column tracks for the md strip, keyed by how many cells it actually has.
 *
 * This used to be the literal `grid-cols-2 gap-px sm:grid-cols-4` in both the
 * strip and its skeleton, whatever the caller passed. A grid asked for four
 * tracks and given three items still draws the fourth track, and since the
 * container is `bg-border` showing through a `gap-px` between `bg-card`
 * cells, that empty track rendered as a bordered box with nothing in it.
 * /assets has exactly three cells (Clean, Caution, Exploitable), so it shipped
 * a visible empty fourth card, and the placeholder drew the same hole.
 *
 * Written out rather than interpolated because Tailwind only emits classes it
 * can read as whole strings; `sm:grid-cols-${n}` compiles to nothing.
 */
const MD_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  // The phone step matters most here, not least. Three cells at 390px are
  // ~119px each, and after the padding and the icon that leaves ~43px of text
  // column against an "EXPLOITABLE" caption needing ~74px and a four-digit
  // count needing ~67px, so /assets clipped both the label and the number.
  // Every other entry in this table already stepped down; this one did not.
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
};

function mdGrid(count: number): string {
  return `grid gap-px ${MD_COLS[count] ?? "grid-cols-2 sm:grid-cols-4"}`;
}

function isZero(value: string | number) {
  return typeof value === "number" && value === 0;
}

export function StatStrip({
  items,
  size = "md",
  bordered = true,
  className,
}: {
  items: StatStripItem[];
  size?: "sm" | "md";
  /** Drop the border and radius when the strip is the top row of a card that
   *  already has both (the dashboard pairs it with an activity sparkline). */
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        bordered ? CONTAINER : "bg-border",
        size === "md" ? mdGrid(items.length) : "flex flex-wrap gap-px",
        className,
      )}
    >
      {items.map((item) => {
        const zero = isZero(item.value);
        const Icon = item.icon;
        const cellClass = cn(
          "flex min-w-0 items-center bg-card text-left transition-colors",
          size === "md"
            ? "gap-3 px-4 py-3"
            : // Two per row on a phone, the strip's natural flow from sm up.
              // basis-24 (96px) alone let four cells shrink to about 88px on a
              // 390px screen, and after the padding and the icon that leaves
              // roughly 40px for a 10px uppercase caption. "SESSIONS" needs
              // about 55px, so it clipped to "SESSIO...". Half-width minus the
              // 1px gap gives every label room to be read.
              "flex-1 basis-[calc(50%-1px)] gap-2.5 px-3 py-2 sm:basis-24 sm:px-4",
          item.onClick &&
            "hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          item.active && "bg-primary/5",
        );
        const inner = (
          <>
            {Icon && (
              <StatIcon
                icon={Icon}
                tone={zero ? "muted" : (item.iconTone ?? "muted")}
                size={size}
              />
            )}
            <div className="flex min-w-0 flex-col gap-1">
              {/* The value and its label used to be two sizes of the same
                  thing: 24px semibold over 11px regular, both in the plain
                  text colours, which is most of why a page of these read as
                  flat. They now differ on four axes at once (size, weight,
                  case, tracking) so the number is unmistakably the subject and
                  the label is unmistakably a caption. The uppercase micro-label
                  is not a new invention: it is the same treatment the check-
                  family group headers in the scan form already use.

                  The value stays at 24px on mobile. At 28px a four-digit
                  count plus its icon does not fit a half-width cell on a 320px
                  viewport, and `truncate` would silently clip a number. */}
              <span
                className={cn(
                  "truncate tabular-nums",
                  size === "md"
                    ? "text-2xl font-semibold tracking-tight sm:text-[1.75rem]"
                    : "text-sm font-semibold",
                  // After the size, not before it. Tailwind's text-<size>
                  // utilities set a line-height as well as a font-size, so
                  // tailwind-merge treats them as conflicting with leading-*
                  // and drops whichever came first: written ahead of the size
                  // (as it was), `leading-none` was being stripped from every
                  // stat value in the product and never reached the DOM.
                  "leading-none",
                  // Was text-muted-foreground/40, which measures 2.18:1 on
                  // --card in dark mode. A zero should read as quiet, not as
                  // barely-there: this is a real count a user is reading off
                  // the page ("0 critical"), and the un-faded token is already
                  // tuned to clear AA on every surface while staying more than
                  // twice as dark as --foreground.
                  zero
                    ? "text-muted-foreground"
                    : (item.textTone ?? "text-foreground"),
                )}
              >
                {typeof item.value === "number"
                  ? item.value.toLocaleString()
                  : item.value}
              </span>
              {/* Wraps rather than truncating. This is our own caption, not
                  user data: the text is known, short and load-bearing, so
                  clipping it to "CAME BACK CLEA..." destroys the meaning and
                  buys nothing. At grid-cols-2 on a 320px screen the text
                  column is ~67px against "CAME BACK CLEAN" at ~93px, so
                  /history clipped it on the narrowest phones. */}
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {item.label}
              </span>
            </div>
          </>
        );
        return item.onClick ? (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            aria-pressed={item.active}
            className={cellClass}
          >
            {inner}
          </button>
        ) : (
          <div key={item.label} className={cellClass}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Loading placeholder for a StatStrip. Lives beside the real thing on purpose:
 * three pages each hand-rolled their own skeleton copy of the strip, so the
 * loading state could stop matching the loaded state without anyone noticing.
 */
export function StatStripSkeleton({
  cells = 4,
  size = "md",
  bordered = true,
  className,
}: {
  cells?: number;
  size?: "sm" | "md";
  /** Mirrors StatStrip's own prop. Without it the dashboard, which renders the
   *  strip unbordered inside a card, had no way to draw its placeholder the
   *  same way and so drew a second border the loaded state does not have. */
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        bordered ? CONTAINER : "bg-border",
        size === "md" ? mdGrid(cells) : "flex flex-wrap gap-px",
        className,
      )}
      aria-hidden
    >
      {Array.from({ length: cells }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center bg-card",
            size === "md"
              ? "gap-3 px-4 py-3"
              : // Two per row on a phone, the strip's natural flow from sm up.
                // basis-24 (96px) alone let four cells shrink to about 88px on a
                // 390px screen, and after the padding and the icon that leaves
                // roughly 40px for a 10px uppercase caption. "SESSIONS" needs
                // about 55px, so it clipped to "SESSIO...". Half-width minus the
                // 1px gap gives every label room to be read.
                "flex-1 basis-[calc(50%-1px)] gap-2.5 px-3 py-2 sm:basis-24 sm:px-4",
          )}
        >
          <div
            className={cn(
              "shrink-0 bg-muted",
              size === "md" ? "h-8 w-8 rounded-lg" : "h-7 w-7 rounded-md",
            )}
          />
          <div className="flex flex-col gap-1.5">
            {/* Tracks the loaded value's height, including the sm: step up. */}
            <div
              className={cn(
                "rounded bg-muted",
                size === "md" ? "h-6 w-12 sm:h-7 sm:w-14" : "h-3.5 w-10",
              )}
            />
            <div className="h-2 w-16 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
