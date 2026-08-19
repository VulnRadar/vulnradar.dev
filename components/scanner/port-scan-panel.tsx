"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PortScanResult } from "@/lib/scanner/port-scan";
import { cn } from "@/lib/ui/utils";

interface PortScanPanelProps {
  portScan?: PortScanResult | null;
}

/**
 * "Open ports" panel: the result of the opt-in, ownership-gated curated port
 * sweep (lib/scanner/port-scan.ts). Collapsible, monospace, with each open
 * port's number, service, and any banner. Mirrors DnsRecordsPanel's styling
 * and the response-headers panel's "render nothing when absent" behavior --
 * but when the sweep DID run and found nothing open, it still renders a short
 * definitive "no open ports" line, since that is itself a useful result.
 */
export function PortScanPanel({ portScan }: PortScanPanelProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  // Absent field: the caller did not opt in, or the target was unsafe /
  // unresolvable. Nothing to say -- render nothing, like the DNS panel does
  // for a raw IP.
  if (!portScan) return null;

  const openCount = portScan.open.length;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex-1 text-sm font-medium text-foreground">
          Open ports
        </span>
        <span className="hidden flex-wrap items-center gap-1 sm:flex">
          {portScan.open.slice(0, 8).map((p) => (
            <span
              key={p.port}
              className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary"
            >
              {p.port}
            </span>
          ))}
          {openCount > 8 && (
            <span className="font-mono text-[11px] text-muted-foreground">
              +{openCount - 8}
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {openCount} open / {portScan.portsScanned} checked
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
          {openCount === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              No open ports among the {portScan.portsScanned} common service
              ports checked on {portScan.host}.
            </p>
          ) : (
            // Long banners scroll horizontally inside this container so the
            // page body never does.
            <div className="max-h-96 overflow-auto">
              <div className="sticky top-0 flex items-center gap-2 bg-muted/40 px-4 py-1.5 backdrop-blur">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-primary">
                  {portScan.host}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {openCount} open
                </span>
              </div>
              <div className="divide-y divide-border/50">
                {portScan.open.map((p) => (
                  <div key={p.port} className="px-4 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-foreground">
                        {p.port}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                        {p.service}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[hsl(var(--severity-medium))]">
                        open
                      </span>
                    </div>
                    {p.banner && (
                      <div className="mt-1 overflow-x-auto">
                        <code className="whitespace-pre font-mono text-[11px] text-muted-foreground">
                          {p.banner}
                        </code>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
