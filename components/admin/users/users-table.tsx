"use client"

import { useState } from "react"
import { 
  Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Shield, ShieldCheck, Ban, Loader2, User, Mail, Calendar, ExternalLink, RefreshCw
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { ROLE_BADGE_STYLES } from "@/lib/constants"
import type { AdminUser } from "../types"

interface UsersTableProps {
  users: AdminUser[]
  totalCount: number
  loading: boolean
  searchLoading: boolean
  searchQuery: string
  onSearchChange: (query: string) => void
  onUserSelect: (userId: number) => void
  onRefresh: () => void
  page: number
  totalPages: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  sortBy: string
  sortDir: "asc" | "desc"
  onSort: (field: string) => void
}

export function UsersTable({
  users,
  totalCount,
  loading,
  searchLoading,
  searchQuery,
  onSearchChange,
  onUserSelect,
  onRefresh,
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sortBy,
  sortDir,
  onSort,
}: UsersTableProps) {
  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <ChevronUp className="h-3 w-3 opacity-30" />
    return sortDir === "asc" 
      ? <ChevronUp className="h-3 w-3 text-primary" />
      : <ChevronDown className="h-3 w-3 text-primary" />
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", { 
      month: "short", 
      day: "numeric",
      year: "numeric"
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header with search and refresh */}
      <div className="p-4 border-b border-border bg-muted/30">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Users</h2>
            <Badge variant="secondary" className="text-xs">
              {totalCount.toLocaleString()} total
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              className="h-9 px-3"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              <span className="ml-2 hidden sm:inline">Refresh</span>
            </Button>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9 h-9 bg-background"
              />
              {searchLoading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="text-left p-3 font-medium text-muted-foreground">
                <button onClick={() => onSort("name")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                  User <SortIcon field="name" />
                </button>
              </th>
              <th className="text-left p-3 font-medium text-muted-foreground hidden md:table-cell">
                <button onClick={() => onSort("role")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                  Role <SortIcon field="role" />
                </button>
              </th>
              <th className="text-left p-3 font-medium text-muted-foreground hidden lg:table-cell">
                <button onClick={() => onSort("plan")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                  Plan <SortIcon field="plan" />
                </button>
              </th>
              <th className="text-center p-3 font-medium text-muted-foreground hidden sm:table-cell">2FA</th>
              <th className="text-left p-3 font-medium text-muted-foreground hidden xl:table-cell">
                <button onClick={() => onSort("created_at")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                  Joined <SortIcon field="created_at" />
                </button>
              </th>
              <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr 
                  key={user.id} 
                  className={cn(
                    "border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer group",
                    user.disabled_at && "opacity-60"
                  )}
                  onClick={(e) => {
                    // Don't trigger if clicking a button inside
                    if ((e.target as HTMLElement).closest('button')) return
                    onUserSelect(user.id)
                  }}
                >
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        {user.avatar_url ? (
                          <img src={user.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <User className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{user.name || "No name"}</span>
                          {user.disabled_at && <Ban className="h-3.5 w-3.5 text-destructive shrink-0" />}
                        </div>
                        <span className="text-xs text-muted-foreground truncate block">{user.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 hidden md:table-cell">
                    <Badge 
                      variant="outline" 
                      className={cn("text-[10px] capitalize", ROLE_BADGE_STYLES[user.role] || "")}
                    >
                      {user.role}
                    </Badge>
                  </td>
                  <td className="p-3 hidden lg:table-cell">
                    <span className="text-xs capitalize text-muted-foreground">{user.plan || "free"}</span>
                  </td>
                  <td className="p-3 text-center hidden sm:table-cell">
                    {user.totp_enabled ? (
                      <ShieldCheck className="h-4 w-4 text-primary mx-auto" />
                    ) : (
                      <Shield className="h-4 w-4 text-muted-foreground/50 mx-auto" />
                    )}
                  </td>
                  <td className="p-3 hidden xl:table-cell">
                    <span className="text-xs text-muted-foreground">{formatDate(user.created_at)}</span>
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      onClick={(e) => { e.stopPropagation(); onUserSelect(user.id) }}
                    >
                      View
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="p-3 border-t border-border bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Show</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="h-8 w-16">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>per page</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
