"use client"

import { useState } from "react"
import { Search, Eye, Ban, CheckCircle2, ChevronUp, ChevronDown, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PaginationControl } from "@/components/ui/pagination-control"
import { cn } from "@/lib/utils"
import { STAFF_ROLES, STAFF_ROLE_LABELS, ROLE_BADGE_STYLES } from "@/lib/constants"
import { UserAvatar } from "../shared/user-avatar"
import type { AdminUser } from "../types"

interface UsersTableProps {
  users: AdminUser[]
  loading: boolean
  searchLoading: boolean
  searchQuery: string
  onSearchChange: (query: string) => void
  onUserSelect: (userId: number) => void
  onAction: (userId: number, action: string) => Promise<void>
  onConfirmAction: (config: { title: string; description: string; confirmLabel: string; danger: boolean; action: () => Promise<void> }) => void
  actionLoading: string | null
  callerRole: string
  // Pagination
  page: number
  totalPages: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  // Sorting
  sortBy: string
  sortDir: "asc" | "desc"
  onSort: (field: string) => void
}

export function UsersTable({
  users,
  loading,
  searchLoading,
  searchQuery,
  onSearchChange,
  onUserSelect,
  onAction,
  onConfirmAction,
  actionLoading,
  callerRole,
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
    if (sortBy !== field) return null
    return sortDir === "asc" 
      ? <ChevronUp className="h-3 w-3" /> 
      : <ChevronDown className="h-3 w-3" />
  }

  const sortableHeader = (field: string, label: string) => (
    <button
      onClick={() => onSort(field)}
      className={cn(
        "flex items-center gap-1 hover:text-foreground transition-colors",
        sortBy === field ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {label}
      <SortIcon field={field} />
    </button>
  )

  const isLoading = (userId: number, action: string) => actionLoading === `${userId}-${action}`

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-0 pt-5 px-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-lg font-semibold">Users</CardTitle>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 h-9 text-sm bg-muted/30"
            />
            {searchLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 pt-4">
        {/* Desktop Table */}
        <div className={cn(
          "hidden md:block overflow-x-auto transition-opacity duration-200",
          searchLoading && "opacity-40 pointer-events-none"
        )}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 font-medium text-xs text-muted-foreground">
                  {sortableHeader("email", "User")}
                </th>
                <th className="text-left px-5 py-3 font-medium text-xs text-muted-foreground">Role</th>
                <th className="text-left px-5 py-3 font-medium text-xs text-muted-foreground">Plan</th>
                <th className="text-center px-5 py-3 font-medium text-xs text-muted-foreground">
                  {sortableHeader("scan_count", "Scans")}
                </th>
                <th className="text-left px-5 py-3 font-medium text-xs text-muted-foreground">
                  {sortableHeader("created_at", "Joined")}
                </th>
                <th className="text-right px-5 py-3 font-medium text-xs text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="px-5 py-3">
                    <button
                      onClick={() => onUserSelect(u.id)}
                      className="flex items-center gap-3 text-left hover:text-primary transition-colors"
                    >
                      <UserAvatar name={u.name} email={u.email} size="sm" avatarUrl={u.avatar_url} />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate max-w-[180px]">
                          {u.name || "Unnamed"}
                          {u.disabled_at && (
                            <span className="ml-2 text-[10px] text-destructive">(Disabled)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground truncate max-w-[180px]">{u.email}</p>
                      </div>
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    {u.role && u.role !== STAFF_ROLES.USER && ROLE_BADGE_STYLES[u.role] && (
                      <Badge className={cn(ROLE_BADGE_STYLES[u.role], "text-[10px] px-2 py-0.5")}>
                        {STAFF_ROLE_LABELS[u.role as keyof typeof STAFF_ROLE_LABELS] || u.role}
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {(() => {
                      const effectivePlan = u.gifted_plan || u.plan
                      if (!effectivePlan || effectivePlan === "free") return <span className="text-xs text-muted-foreground">Free</span>
                      const label = effectivePlan.replace("_supporter", "").charAt(0).toUpperCase() + effectivePlan.replace("_supporter", "").slice(1)
                      return (
                        <Badge className={cn(
                          "text-[10px] px-2 py-0.5",
                          u.gifted_plan ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-primary/10 text-primary border-primary/20"
                        )}>
                          {label}{u.gifted_plan ? " (Gift)" : ""}
                        </Badge>
                      )
                    })()}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className="text-sm font-medium">{u.scan_count.toLocaleString()}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="View Details"
                        onClick={() => onUserSelect(u.id)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {u.disabled_at ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10"
                          title="Re-enable"
                          onClick={async () => await onAction(u.id, "enable")}
                          disabled={isLoading(u.id, "enable")}
                        >
                          {isLoading(u.id, "enable") ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          title="Disable"
                          onClick={() => onConfirmAction({
                            title: "Disable Account",
                            description: `Suspend ${u.email}? They will be logged out and unable to sign in.`,
                            confirmLabel: "Disable",
                            danger: true,
                            action: async () => await onAction(u.id, "disable"),
                          })}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <Search className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No users found matching your search.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile List */}
        <div className={cn(
          "md:hidden flex flex-col transition-opacity duration-200",
          searchLoading && "opacity-40 pointer-events-none"
        )}>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => onUserSelect(u.id)}
              className="flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-0 hover:bg-muted/20 text-left transition-colors w-full"
            >
              <UserAvatar name={u.name} email={u.email} size="sm" avatarUrl={u.avatar_url} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{u.name || "Unnamed"}</p>
                <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">{u.scan_count} scans</span>
                  {u.disabled_at && (
                    <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-1.5">Disabled</Badge>
                  )}
                  {u.role && u.role !== STAFF_ROLES.USER && ROLE_BADGE_STYLES[u.role] && (
                    <Badge className={cn(ROLE_BADGE_STYLES[u.role], "text-[10px] px-1.5")}>
                      {STAFF_ROLE_LABELS[u.role as keyof typeof STAFF_ROLE_LABELS] || u.role}
                    </Badge>
                  )}
                </div>
              </div>
              <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
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
      </CardContent>
    </Card>
  )
}
