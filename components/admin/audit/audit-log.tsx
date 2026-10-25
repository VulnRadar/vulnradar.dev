"use client";

import React, { useEffect, useRef, useState } from "react";
import {
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
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
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
import { API, APP_SLUG } from "@/lib/config/client-constants";
import { PaginationControl } from "@/components/ui/pagination-control";
import {
  SkeletonRegion,
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
  formatTimestamp,
  getActionSentence,
  parseChangeDiff,
  AUDIT_FILTER_CATEGORIES,
} from "@/components/admin/utils";
import { ACTION_META } from "@/components/admin/config";
import type { AuditEntry, AuditStats } from "@/components/admin/types";
import { FilterChips } from "@/components/admin/shared/filter-chips";
import {
  EMPTY_AUDIT_FILTERS,
  hasActiveAuditFilters,
  type AuditFilters,
} from "@/components/admin/audit/audit-filters";
import { ListSearchInput } from "@/components/shared/list-filter-bar";

interface AuditLogProps {
  auditLogs: AuditEntry[];
  auditPaging: boolean;
  auditPage: number;
  auditTotalPages: number;
  auditPageSize: number;
  setAuditPageSize: (size: number) => void;
  fetchAudit: (page?: number, pageSize?: number) => void;
  /** Totals over the whole log, from the server. Null until the first load. */
  auditStats: AuditStats | null;
  /** Rows the current filters leave, across every page. */
  auditTotal: number;
  /** The applied filters. The page owns them because it owns the fetch. */
  filters: AuditFilters;
  onFiltersChange: (next: AuditFilters) => void;
  /** Whether this role holds EXPORT_AUDIT_LOG; the Export menu is not drawn without it. */
  canExport: boolean;
  onNotify: (message: string, type: "success" | "error") => void;
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

function PersonFilterChip({
  prefix,
  label,
  onClear,
}: {
  prefix: string;
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 py-1 pl-3 pr-1 text-xs font-medium text-primary">
      <span className="text-primary/70">{prefix}</span>
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear the ${prefix.toLowerCase()} ${label} filter`}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-primary/15",
          focusRing,
        )}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

export function AuditLog({
  auditLogs,
  auditPaging,
  auditPage,
  auditTotalPages,
  auditPageSize,
  setAuditPageSize,
  fetchAudit,
  auditStats,
  auditTotal,
  filters,
  onFiltersChange,
  canExport,
  onNotify,
}: AuditLogProps) {
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [tocOpen, setTocOpen] = useState(false);

  // The search box types into local state and reaches the server a beat
  // later: a request per keystroke would be a query per keystroke against the
  // whole log. Everything else (a chip, a tile, an avatar) applies at once.
  const [searchInput, setSearchInput] = useState(filters.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );
  // Clearing the filters from outside (the empty state's button, a chip) has
  // to clear the box too. Adjusted during render, which is the sanctioned way
  // to derive state from a prop, rather than in an effect.
  const [appliedQ, setAppliedQ] = useState(filters.q);
  if (filters.q !== appliedQ) {
    setAppliedQ(filters.q);
    setSearchInput(filters.q);
  }

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      onFiltersChange({ ...filters, q: value });
    }, 300);
  };
  // A pending search is applied with whatever else changed, so clicking a chip
  // a moment after typing does not throw the typed text away.
  const applyFilters = (patch: Partial<AuditFilters>) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    onFiltersChange({ ...filters, q: searchInput, ...patch });
  };
  const filtersActive = hasActiveAuditFilters(filters);
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
      const res = await fetch(`${API.ADMIN}/audit-log/export?format=${format}`);
      if (!res.ok) {
        // Said out loud. This returned silently, so a click that the server
        // refused did nothing and explained nothing.
        const body = await res.json().catch(() => null);
        onNotify(
          body?.error ||
            (res.status === 403
              ? "Your role cannot export the audit log."
              : "Couldn't export the audit log."),
          "error",
        );
        return;
      }
      const blob = await res.blob();
      downloadBlob(
        blob,
        `${APP_SLUG}-audit-log-${new Date().toISOString().split("T")[0]}.${format}`,
      );
    } catch {
      onNotify("Couldn't export the audit log.", "error");
    } finally {
      setExportingFormat(null);
    }
  };

  const tocItems: AdminTocItem[] = [
    { id: "audit-filters", label: "Filters" },
    { id: "audit-log-entries", label: "Log Entries" },
  ];

  const isInitialLoad = auditPaging && !auditLogs.length;

  return (
    <div className="space-y-4">
      {/* Stats */}
      {/* Totals over the whole log, counted by the server. These used to be
          computed from the ten rows on the page and labelled "Today", "This
          Week" and "Active Admins", which they were not. The first two are
          also the time filter, so the number on the tile is the number of rows
          the filter leaves. */}
      {auditStats && !isInitialLoad ? (
        <StatBar
          items={[
            {
              label: "Last 24 hours",
              value: auditStats.last24h,
              icon: Clock,
              tone: "muted",
              onClick: () =>
                applyFilters({
                  range: filters.range === "24h" ? "all" : "24h",
                }),
              active: filters.range === "24h",
            },
            {
              label: "Last 7 days",
              value: auditStats.last7d,
              icon: CalendarDays,
              tone: "muted",
              onClick: () =>
                applyFilters({ range: filters.range === "7d" ? "all" : "7d" }),
              active: filters.range === "7d",
            },
            {
              label: "Staff active (7d)",
              value: auditStats.activeAdmins7d,
              icon: Shield,
              tone: "primary",
            },
            {
              label: "On accounts (7d)",
              value: auditStats.userActions7d,
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
          status={
            <Badge
              variant="secondary"
              className="text-[11px] font-medium h-5 px-2 tabular-nums"
              aria-label={`${auditTotal} matching entries`}
            >
              {auditTotal.toLocaleString()}
            </Badge>
          }
          className="border-b-0 pb-5"
          actions={
            <>
              {/* One export control, not two. Below sm the CSV and JSON
                  buttons collapsed to two identical download icons sitting
                  next to each other, which is a coin flip rather than a
                  choice. Not drawn at all for a role without
                  EXPORT_AUDIT_LOG: moderator and security_analyst can read
                  the log and used to get a menu whose every item was a
                  silent 403. */}
              {canExport && (
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
              )}
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
          <FilterChips
            options={AUDIT_FILTER_CATEGORIES.map((cat) => ({
              id: cat.id,
              label: cat.label,
              icon: cat.icon,
            }))}
            value={filters.category}
            onChange={(category) => applyFilters({ category })}
            label="Filter the audit log by category"
          />

          {/* Search. Sent to the server, which matches the whole log across
              details, action, IP and both people's name and email. */}
          <ListSearchInput
            value={searchInput}
            onChange={onSearchChange}
            placeholder="Search details, action, IP, admin or user"
            label="Search the whole audit log by details, action, IP, admin or user"
          />

          {/* Who the log is narrowed to. A person chip is the answer to "what
              has staff done to this account" and "what did this admin do". */}
          {(filters.admin || filters.target) && (
            <div className="flex flex-wrap items-center gap-2">
              {filters.admin && (
                <PersonFilterChip
                  prefix="By"
                  label={filters.admin.label}
                  onClear={() => applyFilters({ admin: null })}
                />
              )}
              {filters.target && (
                <PersonFilterChip
                  prefix="On"
                  label={filters.target.label}
                  onClear={() => applyFilters({ target: null })}
                />
              )}
            </div>
          )}
        </AdminPanelHeader>
      </Card>

      {/* Log entries */}
      <Card
        id="audit-log-entries"
        className="border-border/50 bg-card/50 overflow-hidden"
      >
        {isInitialLoad ? (
          // auditPageSize, not a literal six: this panel's page size is a
          // control, so a fixed six was wrong for every setting but one.
          <SkeletonRegion label="Loading audit log">
            <DataTableSkeleton rows={auditPageSize} />
          </SkeletonRegion>
        ) : auditLogs.length === 0 ? (
          <EmptyState
            icon={History}
            title={
              filtersActive ? "No matching logs found" : "No audit logs yet"
            }
            description={
              filtersActive
                ? "Nothing in the whole log matches these filters."
                : "Admin actions will appear here"
            }
            action={
              filtersActive ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => onFiltersChange(EMPTY_AUDIT_FILTERS)}
                >
                  Clear filters
                </Button>
              ) : undefined
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
                    <TableHeader className="sticky top-0 z-20 bg-muted">
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
                      {auditLogs.map((log, index) => {
                        const isExpanded = expandedLog === log.id;
                        const logDate = new Date(log.created_at);
                        const diff = parseChangeDiff(log.details);
                        const destructive = isDestructiveAction(log.action);
                        const newDay = startsNewDay(auditLogs, index);

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
                                    applyFilters({
                                      admin: {
                                        id: log.admin_id,
                                        label:
                                          log.admin_name || log.admin_email,
                                      },
                                    });
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
                                        if (log.target_user_id === null) return;
                                        applyFilters({
                                          target: {
                                            id: log.target_user_id,
                                            label:
                                              log.target_name ||
                                              (log.target_email as string),
                                          },
                                        });
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
                                          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
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
                                            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
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
                                          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                                            Timestamp
                                          </p>
                                          <p className="text-sm font-medium text-foreground">
                                            {formatTimestamp(log.created_at)}
                                          </p>
                                          {log.ip_address && (
                                            <p className="text-xs text-muted-foreground font-mono break-all">
                                              IP: {log.ip_address}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    {log.details && (
                                      <div className="p-3 rounded-lg bg-card/60 border border-border/50">
                                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
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
                {auditLogs.map((log, index) => {
                  const isExpanded = expandedLog === log.id;
                  const logDate = new Date(log.created_at);
                  const diff = parseChangeDiff(log.details);
                  const destructive = isDestructiveAction(log.action);
                  const newDay = startsNewDay(auditLogs, index);

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
                                <p className="text-[11px] text-muted-foreground">
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

                            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                {formatTimestamp(log.created_at)}
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
