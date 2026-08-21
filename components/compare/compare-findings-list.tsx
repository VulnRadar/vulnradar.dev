"use client";

import { cn } from "@/lib/ui/utils";
import { severityTone } from "@/components/scanner/severity-badge";
import { type DiffResult } from "./compare-types";

interface CompareFindingsListProps {
  diff: DiffResult["diff"];
}

type Variant = "added" | "removed" | "unchanged";

function FindingRow({
  title,
  severity,
  variant,
}: {
  title: string;
  severity: string;
  variant: Variant;
}) {
  return (
    <li className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/30 transition-colors">
      <span
        aria-hidden="true"
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          severityTone(severity).solid,
          variant === "removed" && "opacity-50",
        )}
      />
      <span
        className={cn(
          "flex-1 min-w-0 text-sm truncate",
          variant === "removed" && "line-through opacity-60",
          variant === "unchanged" && "text-muted-foreground",
        )}
        title={title}
      >
        {title}
      </span>
      <span
        className={cn(
          "text-[11px] font-mono uppercase tracking-wider shrink-0",
          variant === "added"
            ? severityTone(severity).text
            : "text-muted-foreground",
        )}
      >
        {severity}
      </span>
    </li>
  );
}

function Group({
  heading,
  note,
  count,
  tone,
  variant,
  items,
  scroll,
}: {
  heading: string;
  note: string;
  count: number;
  tone: string;
  variant: Variant;
  items: { title: string; severity: string }[];
  scroll?: boolean;
}) {
  return (
    <section className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <header className="px-5 py-3.5 border-b border-border/50 flex items-baseline gap-2 flex-wrap">
        <h3 className={cn("font-semibold text-sm", tone)}>{heading}</h3>
        <span className="text-sm tabular-nums text-muted-foreground">
          {count}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">{note}</span>
      </header>
      <ul
        className={cn(
          "divide-y divide-border/40",
          scroll && "max-h-[300px] overflow-y-auto",
        )}
      >
        {items.map((f, i) => (
          <FindingRow
            key={`${f.title}-${i}`}
            title={f.title}
            severity={f.severity}
            variant={variant}
          />
        ))}
      </ul>
    </section>
  );
}

export function CompareFindingsList({ diff }: CompareFindingsListProps) {
  const allClean = diff.added.length === 0 && diff.removed.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {allClean && (
        <div className="rounded-xl border border-border/50 border-l-2 border-l-primary bg-muted/30 px-5 py-4">
          <p className="text-sm font-semibold text-foreground">Nothing moved</p>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Both scans returned the same findings. Nothing was introduced and
            nothing was closed between them.
          </p>
        </div>
      )}

      {diff.added.length > 0 && (
        <Group
          heading="New findings"
          note="present in the newer scan only"
          count={diff.added.length}
          tone="text-destructive"
          variant="added"
          items={diff.added}
        />
      )}

      {diff.removed.length > 0 && (
        <Group
          heading="Fixed"
          note="gone since the base scan"
          count={diff.removed.length}
          tone="text-[hsl(var(--success))]"
          variant="removed"
          items={diff.removed}
        />
      )}

      {diff.unchanged.length > 0 && (
        <Group
          heading="Unchanged"
          note="present in both scans"
          count={diff.unchanged.length}
          tone="text-foreground"
          variant="unchanged"
          items={diff.unchanged}
          scroll
        />
      )}
    </div>
  );
}
