"use client"

import { useState } from "react"
import { Globe, Loader2, CheckSquare, Square, X, Search, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

interface CrawlUrlSelectorProps {
  urls: string[]
  isLoading: boolean
  onConfirm: (selectedUrls: string[]) => void
  onCancel: () => void
}

function getPath(url: string) {
  try {
    const u = new URL(url)
    return u.pathname + u.search || "/"
  } catch {
    return url
  }
}

function getHostname(url: string) {
  try { return new URL(url).hostname } catch { return url }
}

export function CrawlUrlSelector({ urls, isLoading, onConfirm, onCancel }: CrawlUrlSelectorProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(urls))
  const [filter, setFilter] = useState("")

  // Keep selection in sync as URLs arrive
  const allSelected = selected.size === urls.length && urls.length > 0
  const noneSelected = selected.size === 0

  function toggleUrl(url: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(urls))
  }

  function deselectAll() {
    setSelected(new Set())
  }

  const filtered = filter
    ? urls.filter(u => u.toLowerCase().includes(filter.toLowerCase()))
    : urls

  const hostname = urls.length > 0 ? getHostname(urls[0]) : ""

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onCancel} />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-card shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
            <Globe className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Select Pages to Scan</h2>
            <p className="text-xs text-muted-foreground truncate">
              {isLoading ? "Discovering pages..." : `${urls.length} pages found on ${hostname}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Loading state */}
        {isLoading && urls.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Crawling for pages...</p>
          </div>
        )}

        {/* URL list */}
        {urls.length > 0 && (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/20">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter pages..."
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  className="w-full h-7 pl-7 pr-3 rounded-md border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <button
                type="button"
                onClick={allSelected ? deselectAll : selectAll}
                className="text-[10px] font-medium text-primary hover:underline shrink-0"
              >
                {allSelected ? "Deselect All" : "Select All"}
              </button>
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
              <div className="flex flex-col gap-0.5">
                {filtered.map((url, i) => {
                  const isChecked = selected.has(url)
                  const isFirst = i === 0
                  return (
                    <button
                      key={url}
                      type="button"
                      onClick={() => toggleUrl(url)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                        isChecked ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"
                      }`}
                    >
                      {isChecked ? (
                        <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />
                      ) : (
                        <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <span className="text-xs font-mono text-foreground truncate">
                          {getPath(url)}
                        </span>
                        {isFirst && (
                          <span className="text-[9px] text-muted-foreground">Entry page</span>
                        )}
                      </div>
                    </button>
                  )
                })}
                {filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">No pages match your filter.</p>
                )}
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-muted/10">
          <span className="text-xs text-muted-foreground">
            {selected.size} of {urls.length} selected
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onCancel} className="bg-transparent text-xs">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => onConfirm(Array.from(selected))}
              disabled={noneSelected || isLoading}
              className="text-xs gap-1.5"
            >
              Scan {selected.size} {selected.size === 1 ? "Page" : "Pages"}
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
