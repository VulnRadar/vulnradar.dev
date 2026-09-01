"use client";

import {
  Users,
  Search,
  RefreshCw,
  Eye,
  Activity,
  Zap,
  Lock,
  UserX,
  UserPlus,
  KeyRound,
  Webhook,
  Calendar,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaginationControl } from "@/components/ui/pagination-control";
import { cn } from "@/lib/ui/utils";
import { getPlanById } from "@/lib/billing/catalog";
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
} from "@/lib/config/client-constants";
import {
  EmptyState,
  SortableHeader,
  TableScrollArea,
  StatBar,
  UserAvatar,
  type SortDirection,
} from "@/components/admin/shared";
import type { AdminStats, AdminUser } from "@/components/admin/types";

/**
 * Admin > People > Users: the growth strip, the directory table and its
 * mobile list.
 *
 * AUDIT-014 qols-01 (partial): every other admin destination is already its
 * own component behind a code-split dynamic import, but this one was ~500
 * lines inlined in app/admin/page.tsx, which is why that file was the
 * outlier it was. Extracted verbatim; the regroup-and-route-split half of
 * that finding is a redesign and is not attempted here.
 *
 * The stat strip stays on this tab rather than the panel's landing view:
 * these are business counters and none of them can go red, which is exactly
 * why qols-02 added a separate health overview to land on.
 */
export function UsersTab({
  stats,
  users,
  page,
  totalPages,
  pageSize,
  searchQuery,
  onSearchQueryChange,
  searchLoading,
  sort,
  onToggleSort,
  onRefresh,
  onPageChange,
  onPageSizeChange,
  onOpenUser,
}: {
  stats: AdminStats | null;
  users: AdminUser[];
  page: number;
  totalPages: number;
  pageSize: number;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchLoading: boolean;
  sort: { column: "name" | "joined" | null; direction: SortDirection };
  onToggleSort: (column: "name" | "joined") => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onOpenUser: (userId: number) => void;
}) {
  return (
    <>
      {/* A live count strip, not a grid of decorative cards. Filtering the
          table by these segments (e.g. Disabled) needs a status filter the
          admin API does not expose yet (it only takes page/limit/search), so
          these stay informational until that lands. */}
      {stats && (
        <div className="space-y-3">
          <StatBar
            items={[
              {
                label: "Total Users",
                value: Number(stats.total_users),
                icon: Users,
                tone: "primary",
              },
              {
                label: "Total Scans",
                value: Number(stats.total_scans),
                icon: Activity,
                tone: "purple",
              },
              {
                label: "Scans (24h)",
                value: Number(stats.scans_24h),
                icon: Zap,
                tone: "orange",
              },
              {
                label: "2FA Enabled",
                value: Number(stats.users_with_2fa),
                icon: Lock,
                tone: "success",
              },
              {
                label: "Disabled",
                value: Number(stats.disabled_users),
                icon: UserX,
                tone: "destructive",
              },
            ]}
          />
          <StatBar
            items={[
              {
                label: "New Users (7d)",
                value: Number(stats.new_users_7d),
                icon: UserPlus,
                tone: "success",
              },
              {
                label: "Active API Keys",
                value: Number(stats.active_api_keys),
                icon: KeyRound,
                tone: "purple",
              },
              {
                label: "Active Webhooks",
                value: Number(stats.active_webhooks),
                icon: Webhook,
                tone: "orange",
              },
              {
                label: "Schedules",
                value: Number(stats.active_schedules),
                icon: Calendar,
                tone: "primary",
              },
              {
                label: "Shared Scans",
                value: Number(stats.shared_scans),
                icon: Share2,
                tone: "muted",
              },
            ]}
          />
        </div>
      )}

      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <CardHeader className="pb-4 pt-5 px-5">
          <div className="flex flex-col gap-4">
            {/* Title row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <Users className="h-4 w-4 text-primary" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base font-semibold truncate">
                    User Directory
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    Manage and view all registered users
                  </p>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="text-xs font-medium h-6 px-2.5 shrink-0"
              >
                {stats ? Number(stats.total_users).toLocaleString() : 0} users
              </Badge>
            </div>
            {/* Search and actions row */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex-1">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                  aria-hidden="true"
                />
                <Input
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  aria-label="Search users by name or email"
                  className="pl-9 h-10 bg-background/50 border-border/40 focus:border-primary/50"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-10 px-3 gap-2 border-border/40 shrink-0"
                aria-label="Refresh users"
                onClick={onRefresh}
              >
                <RefreshCw
                  className={cn("h-4 w-4", searchLoading && "animate-spin")}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop table */}
          <div className="hidden md:block">
            {users.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No users found"
                description={
                  searchQuery
                    ? `No results for "${searchQuery}". Try a different search term.`
                    : "No users have registered yet."
                }
              />
            ) : (
              <TableScrollArea maxHeight="65vh">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm supports-backdrop-filter:bg-muted/90">
                    <TableRow className="border-y border-border/50 hover:bg-transparent">
                      <TableHead className="px-5 h-10">
                        <SortableHeader
                          label="User"
                          active={sort.column === "name"}
                          direction={
                            sort.column === "name" ? sort.direction : null
                          }
                          onClick={() => onToggleSort("name")}
                        />
                      </TableHead>
                      <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Activity
                      </TableHead>
                      <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Status
                      </TableHead>
                      <TableHead className="px-4 h-10">
                        <SortableHeader
                          label="Joined"
                          active={sort.column === "joined"}
                          direction={
                            sort.column === "joined" ? sort.direction : null
                          }
                          onClick={() => onToggleSort("joined")}
                        />
                      </TableHead>
                      <TableHead className="px-5 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody
                    className={cn(
                      "transition-opacity duration-200",
                      searchLoading && "opacity-40 pointer-events-none",
                    )}
                  >
                    {users.map((u) => (
                      /* a11y (SC 2.1.1). Clicking the row was the only way to
                         open a user: the only other focusable control in it
                         is Delete. A <tr> is not focusable and had no key
                         handler, so opening a user was impossible with a
                         keyboard. tabIndex + Enter/Space is the fix that does
                         not cost the table its semantics; role="button" here
                         would replace role="row" and break the grid for
                         screen readers. The e.target guard stops the handler
                         firing when Enter/Space is pressed on a control
                         nested inside the row. */
                      <TableRow
                        key={u.id}
                        tabIndex={0}
                        className="border-border/40 cursor-pointer group focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() => onOpenUser(u.id)}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpenUser(u.id);
                          }
                        }}
                      >
                        <TableCell className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <UserAvatar
                              name={u.name}
                              email={u.email}
                              avatarUrl={u.avatar_url}
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">
                                {u.name || "Unnamed"}
                              </p>
                              <p className="text-xs text-muted-foreground truncate font-mono">
                                {u.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-4">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium">
                              {u.scan_count}{" "}
                              <span className="text-muted-foreground font-normal">
                                scans
                              </span>
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {u.api_key_count} API keys
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {u.disabled_at ? (
                              <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-2 py-0.5 font-medium">
                                Disabled
                              </Badge>
                            ) : (
                              <Badge className="bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20 text-[10px] px-2 py-0.5 font-medium">
                                Active
                              </Badge>
                            )}
                            {u.role &&
                              u.role !== STAFF_ROLES.USER &&
                              ROLE_BADGE_STYLES[u.role] && (
                                <Badge
                                  className={cn(
                                    ROLE_BADGE_STYLES[u.role],
                                    "text-[10px] px-2 py-0.5 font-medium",
                                  )}
                                >
                                  {STAFF_ROLE_LABELS[u.role] || u.role}
                                </Badge>
                              )}
                            {(() => {
                              const effectivePlan = u.gifted_plan || u.plan;
                              if (effectivePlan && effectivePlan !== "free") {
                                const planLabel =
                                  getPlanById(effectivePlan)?.badge?.text ||
                                  effectivePlan;
                                return (
                                  <Badge
                                    className={cn(
                                      "text-[10px] px-2 py-0.5 font-medium",
                                      u.gifted_plan
                                        ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                        : "bg-primary/10 text-primary border-primary/20",
                                    )}
                                  >
                                    {planLabel}
                                    {u.gifted_plan ? " (Gift)" : ""}
                                  </Badge>
                                );
                              }
                              return null;
                            })()}
                            {u.totp_enabled && (
                              <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-2 py-0.5 font-medium">
                                2FA
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(u.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </TableCell>
                        <TableCell className="px-5 py-4">
                          <div className="flex items-center justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                              asChild
                              onClick={(e) => e.stopPropagation()}
                            >
                              <a
                                href={`/admin?tab=users&user=${u.id}`}
                                aria-label={`View ${u.name || u.email}`}
                                onClick={(e) => {
                                  if (!e.ctrlKey && !e.metaKey) {
                                    e.preventDefault();
                                    onOpenUser(u.id);
                                  }
                                }}
                              >
                                <Eye
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                <span className="text-xs">View</span>
                              </a>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScrollArea>
            )}
          </div>

          {/* Mobile list */}
          <div
            className={cn(
              "md:hidden flex flex-col transition-opacity duration-200",
              searchLoading && "opacity-40 pointer-events-none",
            )}
          >
            {users.length === 0 && (
              <EmptyState
                icon={Search}
                title="No users found"
                description={
                  searchQuery
                    ? `No results for "${searchQuery}".`
                    : "No users have registered yet."
                }
              />
            )}
            {users.map((u) => (
              <a
                key={u.id}
                href={`/admin?tab=users&user=${u.id}`}
                onClick={(e) => {
                  if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    onOpenUser(u.id);
                  }
                }}
                className="flex items-center gap-3 px-5 py-4 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <UserAvatar
                  name={u.name}
                  email={u.email}
                  size="sm"
                  avatarUrl={u.avatar_url}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium truncate">
                      {u.name || "Unnamed"}
                    </p>
                    {u.disabled_at ? (
                      <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-1.5 shrink-0">
                        Disabled
                      </Badge>
                    ) : u.role &&
                      u.role !== STAFF_ROLES.USER &&
                      ROLE_BADGE_STYLES[u.role] ? (
                      <Badge
                        className={cn(
                          ROLE_BADGE_STYLES[u.role],
                          "text-[10px] px-1.5 shrink-0",
                        )}
                      >
                        {STAFF_ROLE_LABELS[u.role]}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground truncate font-mono">
                    {u.email}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                    <span>{u.scan_count} scans</span>
                    <span className="text-border">|</span>
                    <span>
                      {new Date(u.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    {(() => {
                      const effectivePlan = u.gifted_plan || u.plan;
                      if (effectivePlan && effectivePlan !== "free") {
                        const label =
                          getPlanById(effectivePlan)?.badge?.text ||
                          effectivePlan;
                        return (
                          <>
                            <span className="text-border">|</span>
                            <Badge
                              className={cn(
                                "text-[10px] px-1.5 py-0",
                                u.gifted_plan
                                  ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                  : "bg-primary/10 text-primary border-primary/20",
                              )}
                            >
                              {label}
                            </Badge>
                          </>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
                <Eye
                  className="h-4 w-4 text-muted-foreground/50 shrink-0"
                  aria-hidden="true"
                />
              </a>
            ))}
          </div>

          {/* Pagination */}
          {users.length > 0 && (
            <div className="px-5 py-4 border-t border-border/40 bg-muted/20">
              <PaginationControl
                currentPage={page}
                totalPages={totalPages}
                onPageChange={onPageChange}
                pageSize={pageSize}
                onPageSizeChange={onPageSizeChange}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
