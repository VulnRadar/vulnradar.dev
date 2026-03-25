"use client"

import { Search, Eye, ChevronUp, ChevronDown, Loader2 } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PaginationControl } from "@/components/ui/pagination-control"
import { cn } from "@/lib/utils"
import { STAFF_ROLES, STAFF_ROLE_LABELS, ROLE_BADGE_STYLES } from "@/lib/constants"
import { UserAvatar } from "../shared/user-avatar"
import type { AdminUser } from "../types"

interface UsersTableProps {
  users: AdminUser[]
  totalCount: number
  loading: boolean
  searchLoading: boolean
  searchQuery: string
  onSearchChange: (query: string) => void
  onUserSelect: (userId: number) => void
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
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sortBy,
  sortDir,
  onSort,
}: UsersTableProps) {
  const SortHeader = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <button
      className="flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={() => onSort(field)}
    >
      {children}
      {sortBy === field && (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
    </button>
  )

  const getEffectivePlan = (u: AdminUser) => u.gifted_plan || u.plan
  const formatPlanLabel = (plan: string) => plan.replace("_supporter", "").charAt(0).toUpperCase() + plan.replace("_supporter", "").slice(1)

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-0 pt-5 px-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold">All Users</CardTitle>
            <Badge variant="secondary" className="text-[10px] font-medium">
              {Number(totalCount).toLocaleString()}
            </Badge>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 h-9 bg-background"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 mt-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Loading users...</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className={cn("hidden md:block overflow-x-auto transition-opacity duration-200", searchLoading && "opacity-40 pointer-events-none")}>
              <table className="w-full">
                <thead>
                  <tr className="border-y border-border bg-muted/10">
                    <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">
                      <SortHeader field="email">User</SortHeader>
                    </th>
                    <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Role</th>
                    <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Plan</th>
                    <th className="text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">
                      <SortHeader field="scan_count">Scans</SortHeader>
                    </th>
                    <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">
                      <SortHeader field="created_at">Joined</SortHeader>
                    </th>
                    <th className="text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Status</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => {
                    const effectivePlan = getEffectivePlan(u)
                    return (
                      <tr
                        key={u.id}
                        className={cn("group hover:bg-muted/30 transition-colors cursor-pointer", i < users.length - 1 && "border-b border-border/50")}
                        onClick={() => onUserSelect(u.id)}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <UserAvatar name={u.name} email={u.email} size="sm" avatarUrl={u.avatar_url} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate max-w-[180px]">{u.name || "Unnamed"}</p>
                              <p className="text-xs text-muted-foreground truncate max-w-[180px]">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          {u.role && u.role !== STAFF_ROLES.USER && ROLE_BADGE_STYLES[u.role] ? (
                            <Badge className={cn(ROLE_BADGE_STYLES[u.role], "text-[10px]")}>{STAFF_ROLE_LABELS[u.role] || u.role}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">User</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          {effectivePlan && effectivePlan !== "free" ? (
                            <Badge className={cn("text-[10px]", u.gifted_plan ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-primary/10 text-primary border-primary/20")}>
                              {formatPlanLabel(effectivePlan)}{u.gifted_plan ? " (Gift)" : ""}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Free</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span className="text-sm text-foreground font-medium">{u.scan_count}</span>
                        </td>
                        <td className="px-3 py-3.5">
                          <span className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {u.disabled_at && <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px]">Disabled</Badge>}
                            {u.totp_enabled && <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]">2FA</Badge>}
                            {!u.disabled_at && !u.totp_enabled && <span className="text-xs text-muted-foreground">Active</span>}
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center">
                        <Search className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No users found matching your search.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className={cn("md:hidden flex flex-col transition-opacity duration-200", searchLoading && "opacity-40 pointer-events-none")}>
              {users.map((u) => {
                const effectivePlan = getEffectivePlan(u)
                return (
                  <a
                    key={u.id}
                    href={`/admin#users/user-${u.id}`}
                    onClick={(e) => {
                      if (!e.ctrlKey && !e.metaKey) {
                        e.preventDefault()
                        onUserSelect(u.id)
                      }
                    }}
                    className="flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-0 hover:bg-muted/20 text-left transition-colors w-full"
                  >
                    <UserAvatar name={u.name} email={u.email} size="sm" avatarUrl={u.avatar_url} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{u.name || "Unnamed"}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">{u.scan_count} scans</span>
                        {u.disabled_at && <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-1.5">Disabled</Badge>}
                        {u.role && u.role !== STAFF_ROLES.USER && ROLE_BADGE_STYLES[u.role] && (
                          <Badge className={cn(ROLE_BADGE_STYLES[u.role], "text-[10px] px-1.5")}>{STAFF_ROLE_LABELS[u.role] || u.role}</Badge>
                        )}
                        {effectivePlan && effectivePlan !== "free" && (
                          <Badge className={cn("text-[10px] px-1.5", u.gifted_plan ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-primary/10 text-primary border-primary/20")}>
                            {formatPlanLabel(effectivePlan)}{u.gifted_plan ? " (Gift)" : ""}
                          </Badge>
                        )}
                        {u.totp_enabled && <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-1.5">2FA</Badge>}
                      </div>
                    </div>
                    <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
                  </a>
                )
              })}
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
      </CardContent>
    </Card>
  )
}
