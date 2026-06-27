"use client";

import { useState } from "react";
import {
  ExternalLink,
  Tag,
  Plus,
  X,
  RefreshCw,
  Terminal,
  Globe,
  ShieldCheck,
  MoreHorizontal,
  ChevronRight,
  AlertTriangle,
  Sparkles,
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
import { SeverityPill } from "./severity-pill";
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
  onAddTag: (scanId: number, tag: string) => void;
  onRemoveTag: (scanId: number, tag: string) => void;
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
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");

  const handleAddTag = () => {
    if (newTag.trim()) {
      onAddTag(scan.id, newTag.trim());
    }
    setAddingTag(false);
    setNewTag("");
  };

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

  const dotColor: Record<string, string> = {
    critical: "bg-[hsl(var(--severity-critical))]",
    high: "bg-[hsl(var(--severity-high))]",
    medium: "bg-[hsl(var(--severity-medium))]",
    low: "bg-[hsl(var(--severity-low))]",
    info: "bg-muted-foreground/50",
  };

  const ringColor: Record<string, string> = {
    critical:
      "ring-[hsl(var(--severity-critical))]/30 bg-[hsl(var(--severity-critical))]/10 text-[hsl(var(--severity-critical))]",
    high: "ring-[hsl(var(--severity-high))]/30 bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))]",
    medium:
      "ring-[hsl(var(--severity-medium))]/30 bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))]",
    low: "ring-[hsl(var(--severity-low))]/30 bg-[hsl(var(--severity-low))]/10 text-[hsl(var(--severity-low))]",
    info: "ring-border/60 bg-muted/40 text-muted-foreground",
  };

  return (
    <div
      className="group relative flex flex-col sm:grid sm:grid-cols-[auto,1fr,auto,auto,auto,auto] gap-3 sm:gap-4 px-4 py-3.5 hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => onView(scan)}
    >
      {/* Severity indicator dot + icon chip */}
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex items-center justify-center w-9 h-9 rounded-lg ring-1 shrink-0",
            isClean
              ? "bg-emerald-500/10 ring-emerald-500/20 text-emerald-500"
              : ringColor[worst],
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
            <span className="text-sm font-medium text-foreground truncate">
              {getDomain(scan.url)}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums hidden sm:inline">
              · {displayUrl(scan.url)}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground truncate font-mono sm:hidden">
            {displayUrl(scan.url)}
          </span>

          {/* Tags row */}
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {scan.tags &&
              scan.tags.length > 0 &&
              scan.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20"
                >
                  <Tag className="h-2.5 w-2.5" />
                  {tag}
                  <button
                    type="button"
                    className="ml-0.5 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveTag(scan.id, tag);
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            {addingTag ? (
              <span
                className="inline-flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setAddingTag(false);
                      setNewTag("");
                    }
                  }}
                  placeholder="tag"
                  className="w-16 text-[10px] px-1.5 py-0.5 rounded-md border border-primary/30 bg-background text-foreground focus:outline-none"
                  autoFocus
                />
              </span>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  setAddingTag(true);
                  setNewTag("");
                }}
              >
                <Plus className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Source badge - desktop only */}
      <div className="hidden sm:flex items-center justify-center w-20">
        <span
          className={cn(
            "inline-flex items-center rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider border",
            scan.source === "api"
              ? "bg-violet-500/10 text-violet-500 border-violet-500/20"
              : "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
          )}
        >
          {scan.source === "api" ? "API" : "Web"}
        </span>
      </div>

      {/* Severity pills - desktop */}
      <div className="hidden sm:flex items-center justify-center gap-1 w-40">
        {isClean ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
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
            {!critical && !high && !medium && !low && info > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                {info} info
              </span>
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

      {/* Severity dot column - desktop only */}
      <div className="hidden sm:flex items-center justify-center w-4 shrink-0">
        {!isClean && (
          <span
            className={cn("w-2 h-2 rounded-full", dotColor[worst])}
            aria-hidden
          />
        )}
      </div>

      {/* Actions - desktop only */}
      <div className="hidden sm:flex items-center justify-end w-8 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
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
        <span
          className={cn(
            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            scan.source === "api"
              ? "bg-violet-500/10 text-violet-500"
              : "bg-cyan-500/10 text-cyan-500",
          )}
        >
          {scan.source === "api" ? "API" : "Web"}
        </span>
        <span className="tabular-nums">
          {formatRelativeTime(scan.scanned_at)}
        </span>
        {isClean ? (
          <span className="text-emerald-500 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" />
            Clean
          </span>
        ) : (
          <span>{scan.findings_count} issues</span>
        )}
      </div>
    </div>
  );
}
