import { cn } from "@/lib/ui/utils";
import { generateId } from "@/lib/scanner/_helpers";
import type { Severity } from "@/lib/scanner/types";
import { SEVERITY_TONE } from "@/components/scanner/severity-badge";

/**
 * A single line of the readout: one response header, one verdict.
 *
 * "pass" rows don't carry a severity, there's nothing to color by. "warn"
 * and "fail" rows must, so every non-passing line is colored by the same
 * --severity-* scale the real report uses, never a bespoke palette.
 */
export type ResponseReadoutRow =
  | { header: string; state: "pass"; detail: string }
  | {
      header: string;
      state: "warn" | "fail";
      detail: string;
      severity: Severity;
    };

interface ResponseReadoutProps {
  /** "lg" for the landing hero, "sm" for the auth rail. */
  size?: "lg" | "sm";
  host: string;
  method?: string;
  status?: string;
  rows: ResponseReadoutRow[];
  /**
   * Check id the footer's finding id is derived from, e.g. "csp-missing".
   * Run through the same generateId() the real scanner uses, so the id in
   * the footer is not a look-alike, it is one.
   */
  leadCheckId: string;
  className?: string;
}

function rowTone(row: ResponseReadoutRow): string {
  if (row.state === "pass") return "text-[hsl(var(--success))]";
  return SEVERITY_TONE[row.severity].text;
}

function rowGlyph(state: ResponseReadoutRow["state"]): string {
  if (state === "pass") return "✓";
  if (state === "warn") return "⚠";
  return "✗";
}

/**
 * Precomputed animation-delay classes for the staggered row reveal, keyed
 * by row index. Tailwind can only generate a CSS rule for an arbitrary
 * value it can see as a literal string at build time -- a template-
 * interpolated class name (`` `[animation-delay:${n}ms]` ``) is invisible
 * to it -- so these are spelled out instead of computed, which is also
 * what keeps this off the CSP-hygiene "excessive inline style attributes"
 * scanner check (a per-row `style={{ animationDelay }}` used to be here).
 * Capped at 10, well above every current caller's row count (max 6); a
 * row beyond the cap just reuses the last delay instead of continuing to
 * stagger. Formula: rowStart (220) + i * rowStep (110 for lg, 90 for sm)
 * -- regenerate this list if either constant below ever changes.
 */
const LG_ROW_DELAY_CLASSES = [
  "[animation-delay:220ms]",
  "[animation-delay:330ms]",
  "[animation-delay:440ms]",
  "[animation-delay:550ms]",
  "[animation-delay:660ms]",
  "[animation-delay:770ms]",
  "[animation-delay:880ms]",
  "[animation-delay:990ms]",
  "[animation-delay:1100ms]",
  "[animation-delay:1210ms]",
];
const SM_ROW_DELAY_CLASSES = [
  "[animation-delay:220ms]",
  "[animation-delay:310ms]",
  "[animation-delay:400ms]",
  "[animation-delay:490ms]",
  "[animation-delay:580ms]",
  "[animation-delay:670ms]",
  "[animation-delay:760ms]",
  "[animation-delay:850ms]",
  "[animation-delay:940ms]",
  "[animation-delay:1030ms]",
];

function rowDelayClass(isLg: boolean, i: number): string {
  const list = isLg ? LG_ROW_DELAY_CLASSES : SM_ROW_DELAY_CLASSES;
  return list[Math.min(i, list.length - 1)];
}

/**
 * Same idea as the row delays above, for the footer line's delay (rowStart
 * + rows.length * rowStep + 140), indexed by row count instead of row
 * index. Same 10-row cap.
 */
const LG_FOOTER_DELAY_CLASSES = [
  "[animation-delay:360ms]",
  "[animation-delay:470ms]",
  "[animation-delay:580ms]",
  "[animation-delay:690ms]",
  "[animation-delay:800ms]",
  "[animation-delay:910ms]",
  "[animation-delay:1020ms]",
  "[animation-delay:1130ms]",
  "[animation-delay:1240ms]",
  "[animation-delay:1350ms]",
];
const SM_FOOTER_DELAY_CLASSES = [
  "[animation-delay:360ms]",
  "[animation-delay:450ms]",
  "[animation-delay:540ms]",
  "[animation-delay:630ms]",
  "[animation-delay:720ms]",
  "[animation-delay:810ms]",
  "[animation-delay:900ms]",
  "[animation-delay:990ms]",
  "[animation-delay:1080ms]",
  "[animation-delay:1170ms]",
];

function footerDelayClass(isLg: boolean, rowCount: number): string {
  const list = isLg ? LG_FOOTER_DELAY_CLASSES : SM_FOOTER_DELAY_CLASSES;
  return list[Math.min(rowCount, list.length - 1)];
}

/**
 * The actual mechanism of the product, rendered as itself: a request line,
 * a status line, and the header checks that came back. Not a metaphor for
 * scanning, the literal shape of scanning.
 *
 * Reveals once on mount, staggered line by line, then settles. Nothing in
 * here loops. `prefers-reduced-motion` skips straight to the settled state.
 */
export function ResponseReadout({
  size = "lg",
  host,
  method = "GET",
  status = "HTTP/1.1 200 OK",
  rows,
  leadCheckId,
  className,
}: ResponseReadoutProps) {
  const isLg = size === "lg";
  const findingCount = rows.filter((r) => r.state !== "pass").length;
  const findingId = generateId(leadCheckId, `https://${host}`);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "select-none overflow-hidden rounded-xl border border-border bg-card font-mono",
        isLg ? "text-sm" : "text-[11px]",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-baseline gap-2 border-b border-border/60 bg-muted/20",
          isLg ? "px-5 py-3" : "px-3 py-2",
        )}
      >
        <span className="shrink-0 font-semibold text-primary">{method}</span>
        <span className="min-w-0 flex-1 truncate text-foreground">{host}</span>
      </div>

      <div className={cn(isLg ? "px-5 py-4" : "px-3 py-2.5")}>
        <p className="text-muted-foreground">{status}</p>

        <div className={cn(isLg ? "mt-3 space-y-1.5" : "mt-2 space-y-1")}>
          {rows.map((row, i) => (
            <div
              key={row.header}
              className={cn(
                "flex items-center justify-between gap-3 opacity-0 motion-safe:[animation:slide-up_0.4s_ease-out_forwards] motion-reduce:opacity-100",
                rowDelayClass(isLg, i),
              )}
            >
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {row.header}
              </span>
              <span className={cn("shrink-0 font-medium", rowTone(row))}>
                {rowGlyph(row.state)} {row.detail}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        className={cn(
          "flex items-center justify-between gap-3 border-t border-border/60 bg-muted/20 text-muted-foreground opacity-0 motion-safe:[animation:slide-up_0.4s_ease-out_forwards] motion-reduce:opacity-100",
          isLg ? "px-5 py-2.5 text-xs" : "px-3 py-2 text-[10px]",
          footerDelayClass(isLg, rows.length),
        )}
      >
        <span className="shrink-0">
          {findingCount} finding{findingCount === 1 ? "" : "s"}
        </span>
        <span className="min-w-0 truncate">{findingId}</span>
      </div>
    </div>
  );
}
