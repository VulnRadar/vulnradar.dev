"use client";

import { useId, useState } from "react";
import { ChevronDown, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type {
  ThreatIntelSource,
  ThreatIntelSummary,
} from "@/lib/scanner/reputation-lookup";
import { cn } from "@/lib/ui/utils";

interface ThreatIntelPanelProps {
  threatIntel?: ThreatIntelSummary | null;
}

/**
 * "Threat intelligence" panel: the result of the multi-source reputation
 * lookup (lib/scanner/reputation-lookup.ts). Read-only and collapsible,
 * mirroring PortScanPanel's styling. Shows every source that was checked and
 * what each said, keeping "unavailable" visually distinct from "clean" so a
 * source that could not be reached is never mistaken for a clean verdict. A
 * host actually listed by a source also raises a real reputation finding in
 * the list above; this panel is the structured "what was checked" companion.
 *
 * Renders nothing when there is no summary, exactly like the DNS/port panels
 * do when their capture was absent.
 */
export function ThreatIntelPanel({ threatIntel }: ThreatIntelPanelProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  if (!threatIntel || threatIntel.sources.length === 0) return null;

  const { sources, flaggedCount, reachableCount } = threatIntel;
  const headline =
    flaggedCount > 0
      ? `${flaggedCount} flagged`
      : reachableCount > 0
        ? "None flagged"
        : "Not reachable";

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ShieldAlert
          aria-hidden
          className="h-4 w-4 shrink-0 text-muted-foreground"
        />
        <span className="flex-1 text-sm font-medium text-foreground">
          Threat intelligence
        </span>
        <span
          className={cn(
            "shrink-0 text-xs font-medium",
            flaggedCount > 0
              ? "text-[hsl(var(--severity-high))]"
              : reachableCount > 0
                ? "text-[hsl(var(--success))]"
                : "text-muted-foreground",
          )}
        >
          {headline}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {reachableCount}/{sources.length} checked
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-border">
          <div className="sticky top-0 flex items-center gap-2 bg-muted/40 px-4 py-1.5 backdrop-blur-sm">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-primary">
              {threatIntel.host}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {flaggedCount > 0
                ? `${flaggedCount} source(s) flagged this host`
                : reachableCount > 0
                  ? "no source flagged this host"
                  : "no source could be reached"}
            </span>
          </div>

          <div className="divide-y divide-border/50">
            {sources.map((s) => (
              <SourceRow key={s.source} source={s} />
            ))}
          </div>

          <p className="border-t border-border px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
            A source shown as unavailable was not reached (no key, an error, or
            a timeout). Unavailable is not the same as clean: it means this
            source has no verdict for this host, not that the host is safe.
          </p>
        </div>
      )}
    </div>
  );
}

function SourceRow({ source }: { source: ThreatIntelSource }) {
  const { Icon, tone, label } = VERDICT_META[source.verdict];
  return (
    <div className="flex items-start gap-2.5 px-4 py-2">
      <Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-medium text-foreground">
            {source.source}
          </span>
          <span className={cn("text-[11px] font-medium", tone)}>{label}</span>
        </div>
        {source.verdict === "flagged" &&
          source.categories &&
          source.categories.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {source.categories.map((c) => (
                <span
                  key={c}
                  className="rounded border border-[hsl(var(--severity-high))]/30 bg-[hsl(var(--severity-high))]/10 px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--severity-high))]"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        {source.detail && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {source.detail}
          </p>
        )}
      </div>
    </div>
  );
}

const VERDICT_META = {
  flagged: {
    Icon: ShieldAlert,
    tone: "text-[hsl(var(--severity-high))]",
    label: "flagged",
  },
  clean: {
    Icon: ShieldCheck,
    tone: "text-[hsl(var(--success))]",
    label: "clean",
  },
  unavailable: {
    Icon: ShieldQuestion,
    tone: "text-muted-foreground",
    label: "unavailable",
  },
} as const;
