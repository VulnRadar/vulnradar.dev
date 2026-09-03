"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  History,
  ChevronDown,
  Shield,
  Clock,
  Globe,
  User,
  RefreshCw,
  ArrowRight,
  CalendarDays,
  Download,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/ui/utils";
import { downloadBlob } from "@/lib/ui/download";
import { APP_SLUG } from "@/lib/config/client-constants";
import { PaginationControl } from "@/components/ui/pagination-control";
import {
  UserAvatar,
  ActionBadge,
  StatBar,
  EmptyState,
  TableScrollArea,
  DataTableSkeleton,
  StatBarSkeleton,
  AdminMobileToc,
  AdminMobileTocTrigger,
  AdminPanelHeader,
  type AdminTocItem,
} from "@/components/admin/shared";
import {
  formatRelativeTime,
  getActionSentence,
  parseChangeDiff,
  AUDIT_FILTER_CATEGORIES,
} from "@/components/admin/utils";
import { ACTION_META } from "@/components/admin/config";
import type { AuditEntry } from "@/components/admin/types";

interface AuditLogProps {
  auditLogs: AuditEntry[];
  auditPaging: boolean;
  auditPage: number;
  auditTotalPages: number;
  auditPageSize: number;
  setAuditPageSize: (size: number) => void;
  fetchAudit: (page?: number, pageSize?: number) => void;
}

const focusRing =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Blast radius, read off the one table that already encodes it: ACTION_META
 * paints anything that deletes, revokes or disables with the destructive
 * token. Without this a `delete_user` sat at exactly the weight of a
 * `view_user_detail`, and the log's whole value is being able to spot the
 * former while scrolling past the latter.
 */
function isDestructiveAction(action: string): boolean {
  return ACTION_META[action]?.cls.includes("destructive") ?? false;
}

/**
 * Day separator label. The log is one undifferentiated reverse-chronological
 * stream, so "3d ago" on row 40 told you nothing about where yesterday ended.
 */
function formatDayLabel(date: Date): string {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysAgo = Math.round(
    (today.getTime() - startOfDay.getTime()) / 86_400_000,
  );
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" as const }
      : {}),
  });
}

/** True when this entry is the first of its calendar day in the rendered list. */
function startsNewDay(logs: AuditEntry[], index: number): boolean {
  const current = new Date(logs[index].created_at);
  if (index === 0) return true;
  const previous = new Date(logs[index - 1].created_at);
  return current.toDateString() !== previous.toDateString();
}

export function AuditLog({
  auditLogs,
  auditPaging,
  auditPage,
  auditTotalPages,
  auditPageSize,
  setAuditPageSize,
  fetchAudit,
}: AuditLogProps) {
  const [auditFilter, setAuditFilter] = useState("all");
  const [auditSearch, setAuditSearch] = useState("");
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [timeFilter, setTimeFilter] = useState<"all" | "today" | "week">("all");
  const [tocOpen, setTocOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"csv" | "json" | null>(
    null,
  );

  // AUDIT-010 admin-feature-gap: exports the FULL admin_audit_log table
  // (not just the current page in `auditLogs`) via the server route, then
  // triggers the browser download -- same fetch-blob-then-<a download>
  // pattern used by ProfilePrivacyTab's data export and
  // SystemSettingsManager's settings export.
  const handleExport = async (format: "csv" | "json") => {
    setExportingFormat(format);
    try {
      const res = await fetch(
        `/api/v3/admin/audit-log/export?format=${format}`,
      );
      if (!res.ok) return;
      const blob = await res.blob();
      downloadBlob(
        blob,
        `${APP_SLUG}-audit-log-${new Date().toISOString().split("T")[0]}.${format}`,
      );
    } catch {
      // Best-effort: the export buttons simply stay available to retry.
    } finally {
      setExportingFormat(null);
    }
  };

  const tocItems: AdminTocItem[] = [
    { id: "audit-filters", label: "Filters" },
    { id: "audit-log-entries", label: "Log Entries" },
  ];

  // Compute stats (and the today/week cutoffs the time filter reuses)
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const todayCount = auditLogs.filter(
      (log) => new Date(log.created_at) >= today,
    ).length;
    const weekCount = auditLogs.filter(
      (log) => new Date(log.created_at) >= weekAgo,
    ).length;
    const uniqueAdmins = new Set(auditLogs.map((log) => log.admin_email)).size;
    const userActions = auditLogs.filter((log) => log.target_email).length;

    return { today, weekAgo, todayCount, weekCount, uniqueAdmins, userActions };
  }, [auditLogs]);

  const filteredLogs = useMemo(
    () =>
      auditLogs.filter((log) => {
        const matchesCategory =
          auditFilter === "all" ||
          AUDIT_FILTER_CATEGORIES.find(
            (c) => c.id === auditFilter,
          )?.actions?.includes(log.action);
        const needle = auditSearch.toLowerCase();
        const matchesSearch =
          !auditSearch ||
          log.admin_email.toLowerCase().includes(needle) ||
          log.admin_name?.toLowerCase().includes(needle) ||
          log.target_email?.toLowerCase().includes(needle) ||
          log.target_name?.toLowerCase().includes(needle) ||
          log.action.toLowerCase().includes(needle) ||
          log.details?.toLowerCase().includes(needle) ||
          log.ip_address?.toLowerCase().includes(needle);
        const logDate = new Date(log.created_at);
        const matchesTime =
          timeFilter === "all" ||
          (timeFilter === "today" && logDate >= stats.today) ||
          (timeFilter === "week" && logDate >= stats.weekAgo);
        return matchesCategory && matchesSearch && matchesTime;
      }),
    [
      auditLogs,
      auditFilter,
      auditSearch,
      timeFilter,
      stats.today,
      stats.weekAgo,
    ],
  );

  const isInitialLoad = auditPaging && !auditLogs.length;

  return (
    <div className="space-y-4">
      {/* Stats */}
      {!isInitialLoad ? (
        <StatBar
          items={[
            {
              label: "Today",
              value: stats.todayCount,
              icon: Clock,
              tone: "muted",
              onClick: () =>
                setTimeFilter(timeFilter === "today" ? "all" : "today"),
              active: timeFilter === "today",
            },
            {
              label: "This Week",
              value: stats.weekCount,
              icon: CalendarDays,
              tone: "muted",
              onClick: () =>
                setTimeFilter(timeFilter === "week" ? "all" : "week"),
              active: timeFilter === "week",
            },
            {
              label: "Active Admins",
              value: stats.uniqueAdmins,
              icon: Shield,
              tone: "primary",
            },
            {
              label: "User Actions",
              value: stats.userActions,
              icon: User,
              tone: "purple",
            },
          ]}
        />
      ) : (
        <StatBarSkeleton segments={4} />
      )}

      {/* Filters */}
      <Card id="audit-filters" className="border-border/50 bg-card/50">
        {/* border-b-0: this card is the header, so the grammar's own divider
            would draw a stray line just above the card border. */}
        <AdminPanelHeader
          icon={History}
          title="Audit Log"
          subtitle="All admin actions across the platform"
          className="border-b-0 pb-5"
          actions={
            <>
              {/* One export control, not two. Below sm the CSV and JSON
                  buttons collapsed to two identical download icons sitting
                  next to each other, which is a coin flip rather than a
                  choice. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 gap-2 border-border/40"
                    disabled={exportingFormat !== null}
                    aria-label="Export the full audit log"
                  >
                    {exportingFormat !== null ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Download className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                    Full log, every page
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => handleExport("csv")}>
                    CSV, for a spreadsheet
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleExport("json")}>
                    JSON, for a script
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-2 border-border/40"
                onClick={() => fetchAudit(1)}
                aria-label="Refresh audit log"
              >
                <RefreshCw
                  className={cn("h-4 w-4", auditPaging && "animate-spin")}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </>
          }
        >
          {/* Category filters. Wraps rather than scrolling: the old
              overflow-x-auto + scrollbar-hide strip hid seven of the ten
              filters on a phone with no cue that more existed. Matches
              components/admin/features/email-logs-manager.tsx. */}
          <div className="flex flex-wrap gap-2">
            {AUDIT_FILTER_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setAuditFilter(cat.id)}
                aria-pressed={auditFilter === cat.id}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border whitespace-nowrap shrink-0",
                  focusRing,
                  auditFilter === cat.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted border-border/40",
                )}
              >
                <cat.icon className="h-3 w-3" aria-hidden="true" />
                {cat.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              placeholder="Search by admin, user, or action..."
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              aria-label="Search audit log by admin, user, or action"
              className="pl-9 h-10 bg-background/50 border-border/40 focus:border-primary/50"
            />
          </div>
        </AdminPanelHeader>
      </Card>

      {/* Log entries */}
      <Card
        id="audit-log-entries"
        className="border-border/50 bg-card/50 overflow-hidden"
      >
        {isInitialLoad ? (
          <div className="p-4 sm:p-5">
            <DataTableSkeleton rows={6} />
          </div>
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            icon={History}
            title={
              auditSearch || auditFilter !== "all" || timeFilter !== "all"
                ? "No matching logs found"
                : "No audit logs yet"
            }
            description={
              auditSearch || auditFilter !== "all" || timeFilter !== "all"
                ? auditTotalPages > 1
                  ? "Filters apply to this page only. Use Export for a full-log search across all pages."
                  : "Try adjusting your filters"
                : "Admin actions will appear here"
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <div
                className={cn(
                  "transition-opacity duration-200",
                  auditPaging && "opacity-40 pointer-events-none",
                )}
              >
                <TableScrollArea maxHeight="65vh">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm supports-backdrop-filter:bg-muted/90">
                      <TableRow className="border-y border-border/50 hover:bg-transparent">
                        <TableHead className="px-5 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Action
                        </TableHead>
                        <TableHead className="px-3 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Admin
                        </TableHead>
                        <TableHead className="px-3 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Target
                        </TableHead>
                        <TableHead className="px-3 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Time
                        </TableHead>
                        <TableHead className="w-10 px-3 h-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLogs.map((log, index) => {
                        const isExpanded = expandedLog === log.id;
                        const logDate = new Date(log.created_at);
                        const diff = parseChangeDiff(log.details);
                        const destructive = isDestructiveAction(log.action);
                        const newDay = startsNewDay(filteredLogs, index);

                        return (
                          <React.Fragment key={log.id}>
                            {newDay && (
                              <TableRow className="border-border/40 hover:bg-transparent">
                                <TableCell
                                  colSpan={5}
                                  className="px-5 py-1.5 bg-muted/30"
                                >
                                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    {formatDayLabel(logDate)}
                                  </span>
                                </TableCell>
                              </TableRow>
                            )}
                            {/* a11y (SC 2.1.1): expanding a log entry's detail
                                was click-only. See the note on the same fix in
                                components/admin/users/users-tab.tsx. */}
                            <TableRow
                              tabIndex={0}
                              aria-expanded={isExpanded}
                              className={cn(
                                "border-border/40 cursor-pointer group focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                                isExpanded && "bg-muted/20",
                              )}
                              onClick={() =>
                                setExpandedLog(isExpanded ? null : log.id)
                              }
                              onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setExpandedLog(isExpanded ? null : log.id);
                                }
                              }}
                            >
                              {/* The rail is always drawn, transparent when
                                  the action is benign, so a destructive row
                                  does not shift its neighbours by 2px. */}
                              <TableCell
                                className={cn(
                                  "px-5 py-4 border-l-2",
                                  destructive
                                    ? "border-l-destructive/60"
                                    : "border-l-transparent",
                                )}
                              >
                                <ActionBadge action={log.action} />
                              </TableCell>
                              <TableCell className="px-3 py-4">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAuditSearch(log.admin_email);
                                  }}
                                  title={`Filter to actions by ${log.admin_email}`}
                                  className={cn(
                                    "flex items-center gap-2 rounded-sm",
                                    focusRing,
                                  )}
                                >
                                  <UserAvatar
                                    name={log.admin_name}
                                    email={log.admin_email}
                                    size="sm"
                                    avatarUrl={log.admin_avatar_url}
                                  />
                                  <span className="text-sm text-foreground truncate max-w-[120px] hover:underline">
                                    {log.admin_name ||
                                      log.admin_email.split("@")[0]}
                                  </span>
                                </button>
                              </TableCell>
                              <TableCell className="px-3 py-4">
                                {log.target_email ? (
                                  // The avatar keeps the existing
                                  // filter-to-this-target action; the name is
                                  // now a real link to the account, the deep
                                  // link the users table already builds. It
                                  // used to be filter-only, so looking up the
                                  // account behind an entry meant a manual
                                  // search in another tab.
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAuditSearch(
                                          log.target_email as string,
                                        );
                                      }}
                                      title={`Filter to actions on ${log.target_email}`}
                                      className={cn(
                                        "flex items-center rounded-sm",
                                        focusRing,
                                      )}
                                    >
                                      <UserAvatar
                                        name={log.target_name}
                                        email={log.target_email}
                                        size="sm"
                                        avatarUrl={log.target_avatar_url}
                                      />
                                    </button>
                                    {log.target_user_id ? (
                                      <a
                                        href={`/admin?tab=users&user=${log.target_user_id}`}
                                        onClick={(e) => e.stopPropagation()}
                                        title={`Open ${log.target_email}`}
                                        className={cn(
                                          "text-sm text-muted-foreground truncate max-w-[120px] hover:underline hover:text-foreground rounded-sm",
                                          focusRing,
                                        )}
                                      >
                                        {log.target_name ||
                                          log.target_email.split("@")[0]}
                                      </a>
                                    ) : (
                                      <span className="text-sm text-muted-foreground truncate max-w-[120px]">
                                        {log.target_name ||
                                          log.target_email.split("@")[0]}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    -
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="px-3 py-4">
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {formatRelativeTime(logDate)}
                                </span>
                              </TableCell>
                              <TableCell className="px-3 py-4">
                                <ChevronDown
                                  className={cn(
                                    "h-4 w-4 text-muted-foreground transition-transform opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                                    isExpanded && "rotate-180 opacity-100",
                                  )}
                                  aria-hidden="true"
                                />
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow className="bg-muted/10 border-border/40 hover:bg-muted/10">
                                <TableCell
                                  colSpan={5}
                                  className={cn(
                                    "px-5 py-4 border-l-2",
                                    destructive
                                      ? "border-l-destructive/60"
                                      : "border-l-transparent",
                                  )}
                                >
                                  <div className="animate-in slide-in-from-top-1 space-y-4">
                                    <p className="text-sm text-foreground leading-relaxed">
                                      {getActionSentence(log)}
                                    </p>

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                      <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                          <Shield
                                            className="h-4 w-4 text-primary"
                                            aria-hidden="true"
                                          />
                                        </div>
                                        <div className="min-w-0">
                                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                            Admin
                                          </p>
                                          <p className="text-sm font-medium text-foreground truncate">
                                            {log.admin_name ||
                                              log.admin_email.split("@")[0]}
                                          </p>
                                          <p className="text-xs text-muted-foreground truncate font-mono">
                                            {log.admin_email}
                                          </p>
                                        </div>
                                      </div>

                                      {log.target_email && (
                                        <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                                          <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                            <User
                                              className="h-4 w-4 text-muted-foreground"
                                              aria-hidden="true"
                                            />
                                          </div>
                                          <div className="min-w-0">
                                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                              Target
                                            </p>
                                            <p className="text-sm font-medium text-foreground truncate">
                                              {log.target_name ||
                                                log.target_email.split("@")[0]}
                                            </p>
                                            <p className="text-xs text-muted-foreground truncate font-mono">
                                              {log.target_email}
                                            </p>
                                          </div>
                                        </div>
                                      )}

                                      <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                                        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                          <Clock
                                            className="h-4 w-4 text-muted-foreground"
                                            aria-hidden="true"
                                          />
                                        </div>
                                        <div className="min-w-0">
                                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                            Timestamp
                                          </p>
                                          <p className="text-sm font-medium text-foreground">
                                            {logDate.toLocaleDateString(
                                              "en-US",
                                              {
                                                weekday: "short",
                                                month: "short",
                                                day: "numeric",
                                              },
                                            )}
                                          </p>
                                          <p className="text-xs text-muted-foreground">
                                            {logDate.toLocaleTimeString(
                                              "en-US",
                                              {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                              },
                                            )}
                                            {log.ip_address && (
                                              <span className="ml-2 font-mono break-all">
                                                IP: {log.ip_address}
                                              </span>
                                            )}
                                          </p>
                                        </div>
                                      </div>
                                    </div>

                                    {log.details && (
                                      <div className="p-3 rounded-lg bg-card/60 border border-border/50">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                                          {diff?.field || "Details"}
                                        </p>
                                        {diff ? (
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <Badge
                                              variant="outline"
                                              className="bg-destructive/10 text-destructive border-destructive/20 font-mono font-normal text-xs"
                                            >
                                              {diff.from || "(empty)"}
                                            </Badge>
                                            <ArrowRight
                                              className="h-3 w-3 text-muted-foreground shrink-0"
                                              aria-hidden="true"
                                            />
                                            <Badge
                                              variant="outline"
                                              className="bg-primary/10 text-primary border-primary/20 font-mono font-normal text-xs"
                                            >
                                              {diff.to || "(empty)"}
                                            </Badge>
                                          </div>
                                        ) : (
                                          <p className="text-sm text-foreground leading-relaxed">
                                            {log.details}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableScrollArea>
              </div>
            </div>

            {/* Mobile view */}
            <div className="md:hidden">
              <div
                className={cn(
                  "divide-y divide-border/40 transition-opacity duration-200",
                  auditPaging && "opacity-40 pointer-events-none",
                )}
              >
                {filteredLogs.map((log, index) => {
                  const isExpanded = expandedLog === log.id;
                  const logDate = new Date(log.created_at);
                  const diff = parseChangeDiff(log.details);
                  const destructive = isDestructiveAction(log.action);
                  const newDay = startsNewDay(filteredLogs, index);

                  return (
                    <React.Fragment key={log.id}>
                      {newDay && (
                        <div className="px-4 py-1.5 bg-muted/30">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {formatDayLabel(logDate)}
                          </span>
                        </div>
                      )}
                      <div
                        className={cn(
                          "p-4 border-l-2",
                          destructive
                            ? "border-l-destructive/60"
                            : "border-l-transparent",
                        )}
                      >
                        <button
                          type="button"
                          className={cn(
                            "w-full text-left rounded-sm",
                            focusRing,
                          )}
                          onClick={() =>
                            setExpandedLog(isExpanded ? null : log.id)
                          }
                          aria-expanded={isExpanded}
                        >
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex items-center gap-2.5">
                              <UserAvatar
                                name={log.admin_name}
                                email={log.admin_email}
                                size="sm"
                                avatarUrl={log.admin_avatar_url}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">
                                  {log.admin_name ||
                                    log.admin_email.split("@")[0]}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {formatRelativeTime(logDate)}
                                </p>
                              </div>
                            </div>
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 text-muted-foreground shrink-0 transition-transform mt-1",
                                isExpanded && "rotate-180",
                              )}
                              aria-hidden="true"
                            />
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            <ActionBadge action={log.action} />
                            {log.target_email && (
                              <>
                                <span
                                  className="text-muted-foreground"
                                  aria-hidden="true"
                                >
                                  &rarr;
                                </span>
                                <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                                  {log.target_name ||
                                    log.target_email.split("@")[0]}
                                </span>
                              </>
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-border/50 space-y-3 animate-in slide-in-from-top-1">
                            <p className="text-sm text-foreground leading-relaxed">
                              {getActionSentence(log)}
                            </p>

                            {log.details && (
                              <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                                <p className="text-xs text-muted-foreground mb-1 font-medium">
                                  {diff?.field || "Details"}
                                </p>
                                {diff ? (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge
                                      variant="outline"
                                      className="bg-destructive/10 text-destructive border-destructive/20 font-mono font-normal text-xs"
                                    >
                                      {diff.from || "(empty)"}
                                    </Badge>
                                    <ArrowRight
                                      className="h-3 w-3 text-muted-foreground shrink-0"
                                      aria-hidden="true"
                                    />
                                    <Badge
                                      variant="outline"
                                      className="bg-primary/10 text-primary border-primary/20 font-mono font-normal text-xs"
                                    >
                                      {diff.to || "(empty)"}
                                    </Badge>
                                  </div>
                                ) : (
                                  <p className="text-sm text-foreground">
                                    {log.details}
                                  </p>
                                )}
                              </div>
                            )}

                            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                {logDate.toLocaleString("en-US", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })}
                              </span>
                              {log.ip_address && (
                                <span className="flex items-center gap-1 font-mono">
                                  <Globe
                                    className="h-3 w-3"
                                    aria-hidden="true"
                                  />
                                  {log.ip_address}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {auditTotalPages > 1 && (
              <div className="px-4 sm:px-5 py-4 border-t border-border/40 bg-muted/20">
                <PaginationControl
                  currentPage={auditPage}
                  totalPages={auditTotalPages}
                  onPageChange={(p) => fetchAudit(p)}
                  pageSize={auditPageSize}
                  onPageSizeChange={(s) => {
                    setAuditPageSize(s);
                    fetchAudit(1, s);
                  }}
                />
              </div>
            )}
          </>
        )}
      </Card>

      {/* Mobile "on this page" nav: filters + log entries are two distinct
          scroll regions once there are enough log entries to need it. */}
      <AdminMobileTocTrigger
        isOpen={tocOpen}
        onToggle={() => setTocOpen((o) => !o)}
      />
      <AdminMobileToc
        title="Audit Log"
        items={tocItems}
        isOpen={tocOpen}
        onClose={() => setTocOpen(false)}
      />
    </div>
  );
}
