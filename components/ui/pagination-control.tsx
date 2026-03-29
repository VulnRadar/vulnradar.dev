"use client"

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { cn } from "@/lib/utils"

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

interface PaginationControlProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  /** Current page size. When provided, renders a per-page selector. */
  pageSize?: number
  /** Called when the user picks a new page size. Reset page to 1 in the handler. */
  onPageSizeChange?: (size: number) => void
  /** Total item count – used for the "Showing X–Y of Z" label. */
  totalItems?: number
  className?: string
}

export function PaginationControl({
  currentPage,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  totalItems,
  className,
}: PaginationControlProps) {
  const showSizeSelector = pageSize !== undefined && onPageSizeChange !== undefined

  function getVisiblePages() {
    const pages: (number | "ellipsis")[] = []
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (currentPage > 3) pages.push("ellipsis")
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)
      for (let i = start; i <= end; i++) pages.push(i)
      if (currentPage < totalPages - 2) pages.push("ellipsis")
      pages.push(totalPages)
    }
    return pages
  }

  const visiblePages = getVisiblePages()

  // "Showing X–Y of Z" label
  const rangeLabel = (() => {
    if (totalItems === undefined || pageSize === undefined) return `Page ${currentPage} of ${totalPages}`
    const from = (currentPage - 1) * pageSize + 1
    const to = Math.min(currentPage * pageSize, totalItems)
    return `${from}–${to} of ${totalItems}`
  })()

  if (totalPages <= 1 && !showSizeSelector) return null

  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3", className)}>
      {/* Left: per-page selector */}
      {showSizeSelector && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Show</span>
          <div className="flex items-center rounded-lg border border-border/40 bg-muted/20 p-0.5">
            {PAGE_SIZE_OPTIONS.map((size) => (
              <button
                key={size}
                onClick={() => {
                  if (size !== pageSize) onPageSizeChange(size)
                }}
                className={cn(
                  "h-7 min-w-[2.25rem] px-2 rounded-md text-xs font-medium transition-all",
                  size === pageSize
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                aria-pressed={size === pageSize}
              >
                {size}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">{rangeLabel}</span>
        </div>
      )}

      {/* Right: page navigation */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          {/* First page */}
          <button
            className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center transition-colors border border-border/40",
              currentPage <= 1
                ? "text-muted-foreground/30 cursor-not-allowed bg-muted/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border/60"
            )}
            disabled={currentPage <= 1}
            onClick={() => onPageChange(1)}
            aria-label="First page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          
          {/* Previous page */}
          <button
            className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center transition-colors border border-border/40",
              currentPage <= 1
                ? "text-muted-foreground/30 cursor-not-allowed bg-muted/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border/60"
            )}
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Page numbers */}
          <div className="flex items-center gap-0.5 mx-1">
            {visiblePages.map((p, i) =>
              p === "ellipsis" ? (
                <span key={`ellipsis-${i}`} className="w-8 text-center text-xs text-muted-foreground/50 select-none">
                  ...
                </span>
              ) : (
                <button
                  key={p}
                  className={cn(
                    "h-8 min-w-[2rem] px-2 rounded-lg text-xs font-medium transition-all",
                    p === currentPage
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                  onClick={() => onPageChange(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === currentPage ? "page" : undefined}
                >
                  {p}
                </button>
              )
            )}
          </div>

          {/* Next page */}
          <button
            className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center transition-colors border border-border/40",
              currentPage >= totalPages
                ? "text-muted-foreground/30 cursor-not-allowed bg-muted/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border/60"
            )}
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          
          {/* Last page */}
          <button
            className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center transition-colors border border-border/40",
              currentPage >= totalPages
                ? "text-muted-foreground/30 cursor-not-allowed bg-muted/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border/60"
            )}
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(totalPages)}
            aria-label="Last page"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Hook for client-side pagination.
 * Returns the current slice of items and pagination metadata.
 */
export function usePagination<T>(items: T[], pageSize: number = 10) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  return {
    totalPages,
    getPage: (page: number) => {
      const clamped = Math.max(1, Math.min(page, totalPages))
      const start = (clamped - 1) * pageSize
      return items.slice(start, start + pageSize)
    },
  }
}
