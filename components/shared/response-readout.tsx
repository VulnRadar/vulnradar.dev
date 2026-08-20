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
 * Precomputed animation SHORTHAND classes (name + duration + timing-function
 * + delay + fill-mode all in ONE declaration) for the staggered row reveal,
 * keyed by row index. Tailwind can only generate a CSS rule for an arbitrary
 * value it can see as a literal string at build time -- a template-
 * interpolated class name is invisible to it -- so these are spelled out
 * instead of computed, which is also what keeps this off the CSP-hygiene
 * "excessive inline style attributes" scanner check (a per-row
 * `style={{ animationDelay }}` used to be here).
 *
 * This MUST be a single combined `animation:` shorthand per delay value,
 * not a separate `motion-safe:animate-[slide-up_...]` class plus a
 * separate `[animation-delay:...]` class: Tailwind's compiled stylesheet
 * doesn't preserve source order between arbitrary-property utilities, so
 * whichever of the two ends up later in the cascade wins on equal
 * specificity -- and the `animation` shorthand resets `animation-delay`
 * back to 0 for every sub-property it doesn't explicitly list. That's
 * exactly what silently collapsed every row's stagger to 0ms (all rows
 * popping in at once, in the base 0.4s, instead of cascading over ~1.4s)
 * until this was combined into one rule.
 *
 * Capped at 10, well above every current caller's row count (max 6); a
 * row beyond the cap just reuses the last delay instead of continuing to
 * stagger. Formula: rowStart (220) + i * rowStep (110 for lg, 90 for sm)
 * -- regenerate this list if either constant below ever changes.
 */
const LG_ROW_DELAY_CLASSES = [
  "motion-safe:animate-[slide-up_0.4s_ease-out_220ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_330ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_440ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_550ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_660ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_770ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_880ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_990ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_1100ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_1210ms_forwards]",
];
const SM_ROW_DELAY_CLASSES = [
  "motion-safe:animate-[slide-up_0.4s_ease-out_220ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_310ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_400ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_490ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_580ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_670ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_760ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_850ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_940ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_1030ms_forwards]",
];

function rowDelayClass(isLg: boolean, i: number): string {
  const list = isLg ? LG_ROW_DELAY_CLASSES : SM_ROW_DELAY_CLASSES;
  return list[Math.min(i, list.length - 1)];
}

/**
 * Same idea as the row delays above, for the footer line (rowStart +
 * rows.length * rowStep + 140), indexed by row count instead of row index.
 * Same combined-shorthand fix, same 10-row cap.
 */
const LG_FOOTER_DELAY_CLASSES = [
  "motion-safe:animate-[slide-up_0.4s_ease-out_360ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_470ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_580ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_690ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_800ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_910ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_1020ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_1130ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_1240ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_1350ms_forwards]",
];
const SM_FOOTER_DELAY_CLASSES = [
  "motion-safe:animate-[slide-up_0.4s_ease-out_360ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_450ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_540ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_630ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_720ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_810ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_900ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_990ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_1080ms_forwards]",
  "motion-safe:animate-[slide-up_0.4s_ease-out_1170ms_forwards]",
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
                "flex items-center justify-between gap-3 opacity-0 motion-reduce:opacity-100",
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
          "flex items-center justify-between gap-3 border-t border-border/60 bg-muted/20 text-muted-foreground opacity-0 motion-reduce:opacity-100",
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
