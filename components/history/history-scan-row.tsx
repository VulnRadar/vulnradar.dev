"use client";

import {
  ExternalLink,
  RefreshCw,
  Terminal,
  Globe,
  ShieldCheck,
  MoreHorizontal,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/ui/utils";
import { SEVERITY_LEVELS } from "@/lib/config/constants";
import { severityTone } from "@/components/scanner/severity-badge";
import { SeverityPill } from "./severity-pill";
import { ScanTags } from "./scan-tags";
import {
  type ScanRecord,
  formatRelativeTime,
  formatDate,
  getDomain,
  displayUrl,
} from "./history-types";

interface HistoryScanRowProps {
  scan: ScanRecord;
  onView: (scan: ScanRecord) => void;
  onRescan: (scan: ScanRecord) => void;
  onAddTag: (scanId: string | number, tag: string) => void;
  onRemoveTag: (scanId: string | number, tag: string) => void;
  rescanning: boolean;
}

export function HistoryScanRow({
  scan,
  onView,
  onRescan,
  onAddTag,
  onRemoveTag,
  rescanning,
}: HistoryScanRowProps) {
  const domain = getDomain(scan.url);
  const fullDisplay = displayUrl(scan.url);
  const path = fullDisplay.startsWith(domain)
    ? fullDisplay.slice(domain.length)
    : "";

  const isClean = scan.findings_count === 0;
  const summary = scan.summary || {};
  const critical = summary.critical || 0;
  const high = summary.high || 0;
  const medium = summary.medium || 0;
  const low = summary.low || 0;
  const info = summary.info || 0;
  const worst =
    critical > 0
      ? "critical"
      : high > 0
        ? "high"
        : medium > 0
          ? "medium"
          : low > 0
            ? "low"
            : "info";

  const tone = severityTone(worst);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onView(scan)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onView(scan);
        }
      }}
      className="group relative flex cursor-pointer flex-col gap-3 border-l-2 border-transparent py-3.5 pl-4 pr-4 transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid sm:grid-cols-[auto,1fr,auto,auto,auto,auto] sm:items-center sm:gap-4"
      style={{
        borderLeftColor: isClean
          ? "hsl(var(--success))"
          : `hsl(var(--severity-${worst}))`,
      }}
    >
      {/* Icon chip + URL + tags. `sm:contents` unwraps this at sm+ so the
          icon and the URL block become two separate grid cells that line up
          under the header's spacer and "Target" columns, instead of both
          sharing one auto-sized column the header doesn't account for. */}
      <div className="flex items-center gap-3 sm:contents">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            isClean
              ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
              : cn(tone.surface, tone.text),
          )}
        >
          {isClean ? (
            <ShieldCheck className="h-4 w-4" />
          ) : scan.source === "api" ? (
            <Terminal className="h-4 w-4" />
          ) : (
            <Globe className="h-4 w-4" />
          )}
        </div>

        {/* URL + Tags */}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate font-mono text-sm font-medium text-foreground">
              {domain}
            </span>
            {path && (
              <span className="hidden shrink-0 truncate font-mono text-[11px] text-muted-foreground sm:inline">
                · {path}
              </span>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground truncate font-mono sm:hidden">
            {fullDisplay}
          </span>

          {/* Tags row */}
          <ScanTags
            scanId={scan.id}
            tags={scan.tags ?? []}
            onAdd={onAddTag}
            onRemove={onRemoveTag}
            className="mt-0.5"
          />
        </div>
      </div>

      {/* Source badge - desktop only */}
      <div className="hidden sm:flex items-center justify-center w-20">
        <span className="inline-flex items-center rounded border border-border bg-muted px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {scan.source === "api" ? "API" : "Web"}
        </span>
      </div>

      {/* Severity pills - desktop */}
      <div className="hidden sm:flex items-center justify-center gap-1 w-40">
        {isClean ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-[hsl(var(--success))]/20 bg-[hsl(var(--success))]/10 px-2.5 py-1 text-xs font-semibold text-[hsl(var(--success))]">
            <ShieldCheck className="h-3 w-3" />
            Clean
          </span>
        ) : (
          <div className="flex items-center gap-1 flex-wrap justify-center">
            {critical > 0 && (
              <SeverityPill
                severity={SEVERITY_LEVELS.CRITICAL}
                count={critical}
              />
            )}
            {high > 0 && (
              <SeverityPill severity={SEVERITY_LEVELS.HIGH} count={high} />
            )}
            {medium > 0 && (
              <SeverityPill severity={SEVERITY_LEVELS.MEDIUM} count={medium} />
            )}
            {low > 0 && (
              <SeverityPill severity={SEVERITY_LEVELS.LOW} count={low} />
            )}
            {info > 0 && (
              <SeverityPill severity={SEVERITY_LEVELS.INFO} count={info} />
            )}
            {!critical && !high && !medium && !low && !info && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3" />
                {scan.findings_count}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Time - desktop only */}
      <div className="hidden sm:flex items-center justify-end w-20">
        <span
          className="text-xs text-muted-foreground tabular-nums"
          title={formatDate(scan.scanned_at)}
        >
          {formatRelativeTime(scan.scanned_at)}
        </span>
      </div>

      {/* Actions - desktop only */}
      <div className="hidden sm:flex items-center justify-end w-12 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Scan actions"
              className="h-8 w-8 p-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onView(scan);
              }}
            >
              <ChevronRight className="h-3.5 w-3.5 mr-2" />
              View details
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onRescan(scan);
              }}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5 mr-2", rescanning && "animate-spin")}
              />
              {rescanning ? "Rescanning..." : "Rescan"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                window.open(scan.url, "_blank");
              }}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-2" />
              Open URL
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile: meta row */}
      <div className="flex sm:hidden items-center justify-between text-xs text-muted-foreground ml-12">
        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {scan.source === "api" ? "API" : "Web"}
        </span>
        <span className="tabular-nums">
          {formatRelativeTime(scan.scanned_at)}
        </span>
        {isClean ? (
          <span className="flex items-center gap-1 text-[hsl(var(--success))]">
            <ShieldCheck className="h-3 w-3" />
            Clean
          </span>
        ) : (
          <span className={cn("font-medium", tone.text)}>
            {scan.findings_count}{" "}
            {scan.findings_count === 1 ? "finding" : "findings"}
          </span>
        )}
      </div>
    </div>
  );
}
