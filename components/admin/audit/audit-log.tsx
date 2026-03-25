"use client"

import { useState } from "react"
import { History, Search, X, RefreshCw, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { PaginationControl } from "@/components/ui/pagination-control"
import { cn } from "@/lib/utils"
import { AuditEntry } from "./audit-entry"
import { AuditFilters, filterAuditLogs } from "./audit-filters"
import type { AuditEntry as AuditEntryType } from "../types"

interface AuditLogProps {
  logs: AuditEntryType[]
  loading: boolean
  onRefresh: () => void
  page: number
  totalPages: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function AuditLog({
  logs,
  loading,
  onRefresh,
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: AuditLogProps) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")

  const filteredLogs = filterAuditLogs(logs, filter, search)

  return (
    <div className="space-y-4">
      {/* Header Card with Search & Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            {/* Title row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Audit Log</h2>
                <p className="text-xs text-muted-foreground">Track all administrative actions</p>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 gap-1.5 text-xs self-start sm:self-auto" 
                onClick={onRefresh}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh
              </Button>
            </div>
            
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by admin, user, or action..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-10 bg-background"
              />
              {search && (
                <button 
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearch("")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            
            {/* Filter chips */}
            <AuditFilters 
              activeFilter={filter} 
              onFilterChange={setFilter} 
            />
          </div>
        </CardContent>
      </Card>
      
      {/* Results Card */}
      <Card className="bg-card border-border overflow-hidden">
        {filteredLogs.length === 0 ? (
          <div className="py-16 px-4 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
              <History className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-base font-medium text-muted-foreground">
              {search || filter !== "all" ? "No matching entries" : "No audit log entries yet"}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {search || filter !== "all" 
                ? "Try adjusting your search or filters" 
                : "Admin actions will appear here"
              }
            </p>
          </div>
        ) : (
          <>
            <div className={cn(
              "divide-y divide-border transition-opacity",
              loading && "opacity-50"
            )}>
              {filteredLogs.map((log) => (
                <AuditEntry key={log.id} entry={log} />
              ))}
            </div>
            
            {/* Pagination */}
            <div className="px-5 py-3 border-t border-border bg-muted/10">
              <PaginationControl
                currentPage={page}
                totalPages={totalPages}
                onPageChange={onPageChange}
                pageSize={pageSize}
                onPageSizeChange={onPageSizeChange}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
