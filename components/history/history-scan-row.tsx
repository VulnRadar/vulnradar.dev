"use client"

import { useState } from "react"
import {
  ExternalLink,
  Tag,
  Plus,
  X,
  RefreshCw,
  Terminal,
  Monitor,
  ShieldCheck,
  MoreHorizontal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/ui/utils"
import { SEVERITY_LEVELS } from "@/lib/config/constants"
import { SeverityPill } from "./severity-pill"
import { type ScanRecord, formatRelativeTime, formatDate, getDomain, displayUrl } from "./history-types"

interface HistoryScanRowProps {
  scan: ScanRecord
  onView: (scan: ScanRecord) => void
  onRescan: (scan: ScanRecord) => void
  onAddTag: (scanId: number, tag: string) => void
  onRemoveTag: (scanId: number, tag: string) => void
  rescanning: boolean
}

export function HistoryScanRow({
  scan,
  onView,
  onRescan,
  onAddTag,
  onRemoveTag,
  rescanning,
}: HistoryScanRowProps) {
  const [addingTag, setAddingTag] = useState(false)
  const [newTag, setNewTag] = useState("")

  const handleAddTag = () => {
    if (newTag.trim()) {
      onAddTag(scan.id, newTag.trim())
    }
    setAddingTag(false)
    setNewTag("")
  }

  return (
    <div
      className="group flex flex-col sm:grid sm:grid-cols-[1fr,auto,auto,auto,auto] gap-2 sm:gap-4 p-4 hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => onView(scan)}
    >
      {/* URL + Tags */}
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {scan.source === "api" ? (
              <Terminal className="h-4 w-4 text-primary" />
            ) : (
              <Monitor className="h-4 w-4 text-primary" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-foreground truncate block">
              {getDomain(scan.url)}
            </span>
            <span className="text-xs text-muted-foreground truncate block font-mono">
              {displayUrl(scan.url)}
            </span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              window.open(scan.url, "_blank", "noopener,noreferrer")
            }}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-opacity shrink-0"
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Tags row */}
        <div className="flex flex-wrap items-center gap-1 ml-10">
          {scan.tags && scan.tags.length > 0 && scan.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20"
            >
              <Tag className="h-2.5 w-2.5" />{tag}
              <button
                type="button"
                className="ml-0.5 hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); onRemoveTag(scan.id, tag) }}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          {addingTag ? (
            <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === "Enter") { e.preventDefault(); handleAddTag() }
                  if (e.key === "Escape") { e.preventDefault(); setAddingTag(false); setNewTag("") }
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
              onClick={(e) => { e.stopPropagation(); setAddingTag(true); setNewTag("") }}
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>

      {/* Source badge - desktop only */}
      <div className="hidden sm:flex items-center justify-center w-20">
        <span className={cn(
          "inline-flex items-center rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wider border",
          scan.source === "api"
            ? "bg-violet-500/10 text-violet-500 border-violet-500/20"
            : "bg-cyan-500/10 text-cyan-500 border-cyan-500/20"
        )}>
          {scan.source === "api" ? "API" : "Web"}
        </span>
      </div>

      {/* Severity pills - desktop */}
      <div className="hidden sm:flex items-center justify-center gap-1 w-32">
        {scan.findings_count === 0 ? (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <ShieldCheck className="h-3 w-3" />
            Clean
          </span>
        ) : (
          <div className="flex items-center gap-1 flex-wrap justify-center">
            <SeverityPill severity={SEVERITY_LEVELS.CRITICAL} count={scan.summary?.critical || 0} />
            <SeverityPill severity={SEVERITY_LEVELS.HIGH} count={scan.summary?.high || 0} />
            <SeverityPill severity={SEVERITY_LEVELS.MEDIUM} count={scan.summary?.medium || 0} />
            <SeverityPill severity={SEVERITY_LEVELS.LOW} count={scan.summary?.low || 0} />
          </div>
        )}
      </div>

      {/* Time - desktop only */}
      <div className="hidden sm:flex items-center justify-end w-24">
        <span className="text-xs text-muted-foreground tabular-nums" title={formatDate(scan.scanned_at)}>
          {formatRelativeTime(scan.scanned_at)}
        </span>
      </div>

      {/* Actions - desktop only */}
      <div className="hidden sm:flex items-center justify-center w-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onView(scan) }}>
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRescan(scan) }}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-2", rescanning && "animate-spin")} />
              Rescan
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); window.open(scan.url, "_blank") }}>
              <ExternalLink className="h-3.5 w-3.5 mr-2" />
              Open URL
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile: meta row */}
      <div className="flex sm:hidden items-center justify-between text-xs text-muted-foreground ml-10">
        <span className={cn(
          "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
          scan.source === "api" ? "bg-violet-500/10 text-violet-500" : "bg-cyan-500/10 text-cyan-500"
        )}>
          {scan.source === "api" ? "API" : "Web"}
        </span>
        <span>{formatRelativeTime(scan.scanned_at)}</span>
        {scan.findings_count === 0 ? (
          <span className="text-emerald-500 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" />
            Clean
          </span>
        ) : (
          <span>{scan.findings_count} issues</span>
        )}
      </div>
    </div>
  )
}
