"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
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
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      {/* Left: label + per-page selector */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground whitespace-nowrap">{rangeLabel}</span>
        {showSizeSelector && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground hidden sm:inline">Per page:</span>
            <div className="flex items-center gap-0.5">
              {PAGE_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  onClick={() => {
                    if (size !== pageSize) onPageSizeChange(size)
                  }}
                  className={cn(
                    "h-7 min-w-[2rem] px-2 rounded text-xs font-medium transition-colors",
                    size === pageSize
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  aria-pressed={size === pageSize}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: page buttons */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 bg-transparent"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {visiblePages.map((p, i) =>
            p === "ellipsis" ? (
              <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground select-none">
                ...
              </span>
            ) : (
              <Button
                key={p}
                variant={p === currentPage ? "default" : "outline"}
                size="icon"
                className={cn("h-8 w-8 text-xs", p !== currentPage && "bg-transparent")}
                onClick={() => onPageChange(p)}
                aria-label={`Page ${p}`}
                aria-current={p === currentPage ? "page" : undefined}
              >
                {p}
              </Button>
            )
          )}

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 bg-transparent"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
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
