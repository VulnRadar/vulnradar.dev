import { cn } from "@/lib/ui/utils";
import { formatTimestamp } from "@/components/admin/utils";
import type { UsageFigure, UserUsage } from "@/components/admin/types";

/**
 * How full an allowance is. `null` for an uncapped one, and for a cap of 0
 * (the plan does not include it) where a percentage means nothing.
 */
export function usageFraction(figure: UsageFigure): number | null {
  if (figure.limit === null || figure.limit <= 0) return null;
  return Math.min(1, figure.used / figure.limit);
}

function Meter({
  label,
  figure,
  note,
}: {
  label: string;
  figure: UsageFigure;
  note?: string;
}) {
  const fraction = usageFraction(figure);
  const full = fraction !== null && fraction >= 1;
  const high = fraction !== null && fraction >= 0.8;

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
        {figure.used.toLocaleString()}
        <span className="font-normal text-muted-foreground">
          {figure.limit === null
            ? " used, no cap"
            : figure.limit === 0
              ? " used, not on this plan"
              : ` of ${figure.limit.toLocaleString()}`}
        </span>
      </p>
      {fraction !== null && (
        <div
          role="progressbar"
          aria-label={`${label}: ${Math.round(fraction * 100)} percent of the cap used`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full",
              full
                ? "bg-destructive"
                : high
                  ? "bg-[hsl(var(--warning))]"
                  : "bg-primary",
            )}
            style={{ width: `${Math.max(2, Math.round(fraction * 100))}%` }}
          />
        </div>
      )}
      {note && <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/**
 * Spent against each allowance, drawn above the reset cards it informs.
 * Support resets limits, and used to do it without seeing whether the account
 * was at 3% or at the cap.
 */
export function UsageReadout({ usage }: { usage: UserUsage | null }) {
  if (!usage) {
    return (
      <p className="mb-3 text-xs text-muted-foreground">
        Current usage could not be read. The reset actions below still work.
      </p>
    );
  }
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Meter label="Scans today (UTC)" figure={usage.scans} />
      <Meter
        label="AI tokens, this window"
        figure={usage.ai}
        note={
          usage.ai.usingOwnKey
            ? "Uses their own AI key, so the cap does not apply."
            : `Window ends ${formatTimestamp(usage.ai.windowEndsAt)}`
        }
      />
      <Meter
        label="GitHub review tokens, this window"
        figure={usage.githubReview}
        note={`Window ends ${formatTimestamp(usage.githubReview.windowEndsAt)}`}
      />
    </div>
  );
}
