"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  Plus,
  Trash2,
  RefreshCw,
  Network,
  Globe,
  Eye,
  AlertTriangle,
  Ban,
  ShieldCheck,
  X,
  ListChecks,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SaveConfirmationModal,
  type ChangeItem,
} from "@/components/shared/save-confirmation-modal";
import {
  EmptyState,
  TableScrollArea,
  SortableHeader,
  DataTableSkeleton,
  nextSortDirection,
  StatBar,
  AdminPanelHeader,
  StatusPill,
  type SortDirection,
} from "@/components/admin/shared";
import { ModalShell } from "@/components/ui/modal-shell";
import { cn } from "@/lib/ui/utils";
import { pluralize } from "@/lib/ui/plural";

/**
 * Expiry presets for a new rule. A temporary block is the normal case on this
 * surface, and the column has always existed (access_rules.expires_at, enforced
 * in lib/scanner/access-rules.ts), but the form never sent it, so every rule an
 * admin created was permanent and had to be remembered and deleted by hand.
 */
const EXPIRY_OPTIONS: { value: string; label: string; hours: number | null }[] =
  [
    { value: "never", label: "Never (permanent)", hours: null },
    { value: "1h", label: "In 1 hour", hours: 1 },
    { value: "24h", label: "In 24 hours", hours: 24 },
    { value: "7d", label: "In 7 days", hours: 24 * 7 },
    { value: "30d", label: "In 30 days", hours: 24 * 30 },
  ];

function expiryToIso(preset: string): string | null {
  const opt = EXPIRY_OPTIONS.find((o) => o.value === preset);
  if (!opt || opt.hours === null) return null;
  return new Date(Date.now() + opt.hours * 60 * 60 * 1000).toISOString();
}

/**
 * When a rule stops being enforced, in the shape the table and the detail
 * modal both need. "Which of my blocks are about to lapse" was unanswerable
 * from the list: expires_at existed on the row and was only ever rendered as
 * a plain date, three clicks deep in the detail modal.
 */
const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000;

function ruleExpiry(expiresAt?: string): {
  state: "none" | "expired" | "soon" | "ok";
  label: string;
} {
  if (!expiresAt) {
    return { state: "none", label: "Never" };
  }
  const ms = new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return { state: "none", label: "Never" };
  const remaining = ms - Date.now();
  const date = new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (remaining <= 0) return { state: "expired", label: "Expired" };
  if (remaining <= EXPIRING_SOON_MS) {
    const hours = Math.max(1, Math.round(remaining / (60 * 60 * 1000)));
    return { state: "soon", label: `In ${hours}h` };
  }
  return { state: "ok", label: date };
}

interface AccessRule {
  id: number;
  rule_type: "whitelist" | "blacklist";
  value_type: "ip" | "url";
  ip_address: string;
  description?: string;
  reason?: string;
  is_active: boolean;
  hit_count: number;
  created_at: string;
  expires_at?: string;
}

export function IPRulesManager() {
  const [rules, setRules] = useState<AccessRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [valueType, setValueType] = useState<"ip" | "url">("ip");
  const [ruleType, setRuleType] = useState<"whitelist" | "blacklist">(
    "blacklist",
  );
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState("never");
  const [togglingActive, setTogglingActive] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AccessRule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedRule, setSelectedRule] = useState<AccessRule | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [typeFilter, setTypeFilter] = useState<
    "all" | "whitelist" | "blacklist"
  >("all");
  const [showPaused, setShowPaused] = useState(false);

  // Stable ids so each <label htmlFor> names its control; the block-rule form
  // was a run of unnamed edit fields to a screen reader.
  const valueFieldId = useId();
  const ruleTypeId = useId();
  const descriptionId = useId();
  const reasonId = useId();
  const expiryId = useId();

  const fetchRules = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          section: "access_rules",
          // Paused rules have to come back or they are unreachable: the panel
          // is the only place to resume one.
          include_inactive: true,
        }),
      });
      if (!res.ok) {
        // A failed fetch must never render as "no rules configured" -- in
        // a security-relevant panel specifically, that reads as a false
        // all-clear rather than the load failure it actually is.
        setFetchError("Could not load access rules.");
        return;
      }
      const data = await res.json();
      setRules(data.rules || []);
    } catch (error) {
      console.error("Error fetching access rules:", error);
      setFetchError("Could not load access rules.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: fetchRules' setState calls only fire after its async request resolves, not synchronously in this effect
    fetchRules();
  }, []);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newValue) return;
    setShowAddModal(true);
  };

  // Normalize domain/URL by stripping protocol and trailing slashes
  const normalizeDomain = (value: string): string => {
    let normalized = value.trim().toLowerCase();
    // Remove any protocol (http://, https://, ftp://, sftp://, etc.)
    normalized = normalized.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    // Remove trailing slashes
    normalized = normalized.replace(/\/+$/, "");
    // Remove www. prefix (optional, keeps it simple)
    // normalized = normalized.replace(/^www\./i, "")
    return normalized;
  };

  const handleAddRule = async () => {
    setAdding(true);
    setActionError(null);
    try {
      // For URL type, normalize to domain only (strip protocol)
      const normalizedValue =
        valueType === "url" ? normalizeDomain(newValue) : newValue.trim();

      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          section: "access_rules",
          rule_type: ruleType,
          value_type: valueType,
          ip_address: normalizedValue,
          description:
            description || (valueType === "url" ? "URL Rule" : "IP Rule"),
          reason,
          expires_at: expiryToIso(expiry),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add rule.");
      }
      setNewValue("");
      setDescription("");
      setReason("");
      setExpiry("never");
      await fetchRules();
    } catch (error) {
      // Re-thrown below so SaveConfirmationModal's onConfirm chain (see the
      // Add Rule modal) sees the rejection and keeps the dialog open instead
      // of playing its success animation for a rule that was never created.
      console.error("Error adding rule:", error);
      setActionError(
        error instanceof Error ? error.message : "Failed to add rule.",
      );
      throw error;
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteRule = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          section: "access_rules",
          id: pendingDelete.id,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete rule.");
      }
      setPendingDelete(null);
      await fetchRules();
    } catch (error) {
      // Same reasoning as handleAddRule: keep the confirmation dialog open
      // on failure instead of quietly closing it as if the delete worked.
      console.error("Error deleting rule:", error);
      setActionError(
        error instanceof Error ? error.message : "Failed to delete rule.",
      );
      throw error;
    } finally {
      setDeleting(false);
    }
  };

  /**
   * Pause or resume a rule. The API has supported is_active on its update
   * action all along; the panel only ever dispatched create and delete, so a
   * temporary block could only be removed by deleting it outright.
   */
  const handleToggleActive = async (rule: AccessRule) => {
    setTogglingActive(true);
    setActionError(null);
    try {
      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          section: "access_rules",
          id: rule.id,
          is_active: !rule.is_active,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update rule.");
      }
      setSelectedRule({ ...rule, is_active: !rule.is_active });
      await fetchRules();
    } catch (error) {
      console.error("Error updating rule:", error);
      setActionError(
        error instanceof Error ? error.message : "Failed to update rule.",
      );
    } finally {
      setTogglingActive(false);
    }
  };

  const addChangeItems: ChangeItem[] = newValue
    ? [
        {
          field: "value",
          label: valueType === "ip" ? "IP Address" : "URL/Domain",
          oldValue: "",
          newValue,
        },
        {
          field: "rule_type",
          label: "Action",
          oldValue: "",
          newValue:
            ruleType === "whitelist"
              ? "Allow (Whitelist)"
              : "Block (Blacklist)",
        },
        ...(description
          ? [
              {
                field: "description",
                label: "Description",
                oldValue: "",
                newValue: description,
              },
            ]
          : []),
        {
          field: "expires_at",
          label: "Expires",
          oldValue: "",
          newValue:
            EXPIRY_OPTIONS.find((o) => o.value === expiry)?.label ??
            "Never (permanent)",
        },
      ]
    : [];

  const whitelistCount = rules.filter(
    (r) => r.rule_type === "whitelist" && r.is_active,
  ).length;
  const blacklistCount = rules.filter(
    (r) => r.rule_type === "blacklist" && r.is_active,
  ).length;
  const totalHits = rules.reduce((sum, r) => sum + r.hit_count, 0);

  const pausedCount = rules.filter((r) => !r.is_active).length;

  const sortedRules = useMemo(() => {
    // Paused rules are hidden by default (they are not enforced), but they
    // stay reachable behind the toggle so one can be resumed.
    const byStatus = showPaused ? rules : rules.filter((r) => r.is_active);
    const filtered =
      typeFilter === "all"
        ? byStatus
        : byStatus.filter((r) => r.rule_type === typeFilter);
    if (sortColumn !== "hits" || !sortDirection) return filtered;
    const sorted = [...filtered].sort((a, b) => a.hit_count - b.hit_count);
    return sortDirection === "asc" ? sorted : sorted.reverse();
  }, [rules, sortColumn, sortDirection, typeFilter, showPaused]);

  const handleSortHits = () => {
    const next = nextSortDirection("hits", sortColumn, sortDirection);
    setSortColumn(next.column);
    setSortDirection(next.direction);
  };

  return (
    <>
      {/* Detail Modal */}
      {selectedRule && (
        <ModalShell
          open
          onClose={() => setSelectedRule(null)}
          size="md"
          title="Rule Details"
          description={`${selectedRule.rule_type === "whitelist" ? "Whitelist" : "Blacklist"} ${selectedRule.value_type === "ip" ? "IP" : "URL"}`}
          icon={
            selectedRule.value_type === "url" ? (
              <Globe
                aria-hidden="true"
                className={cn(
                  "h-4 w-4 shrink-0",
                  selectedRule.rule_type === "whitelist"
                    ? "text-[hsl(var(--success))]"
                    : "text-destructive",
                )}
              />
            ) : (
              <Network
                aria-hidden="true"
                className={cn(
                  "h-4 w-4 shrink-0",
                  selectedRule.rule_type === "whitelist"
                    ? "text-[hsl(var(--success))]"
                    : "text-destructive",
                )}
              />
            )
          }
          bodyClassName="space-y-4"
        >
          {/* Rule value */}
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              {selectedRule.value_type === "ip" ? "IP Address" : "URL / Domain"}
            </p>
            <p className="text-sm font-mono text-foreground break-all">
              {selectedRule.ip_address}
            </p>
          </div>

          {/* Details grid */}
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Rule Type
              </p>
              <Badge
                className={cn(
                  "text-xs px-2 py-0.5 font-medium",
                  selectedRule.rule_type === "whitelist"
                    ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20"
                    : "bg-destructive/10 text-destructive border-destructive/20",
                )}
              >
                {selectedRule.rule_type === "whitelist"
                  ? "Allow (Whitelist)"
                  : "Block (Blacklist)"}
              </Badge>
            </div>

            {selectedRule.description && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Description
                </p>
                <p className="text-sm text-foreground">
                  {selectedRule.description}
                </p>
              </div>
            )}

            {selectedRule.reason && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Reason
                </p>
                <p className="text-sm text-foreground">{selectedRule.reason}</p>
              </div>
            )}

            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Activity
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-muted/30 border border-border/50">
                  <p className="text-2xl font-semibold tabular-nums text-foreground">
                    {selectedRule.hit_count}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Total Hits
                  </p>
                </div>
                <div className="p-2 rounded-lg bg-muted/30 border border-border/50">
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {new Date(selectedRule.created_at).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", year: "numeric" },
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Created</p>
                </div>
              </div>
            </div>

            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Status
                </p>
                {/* A paused rule is a security rule that is NOT being
                      enforced. It used to be the quietest thing on screen. */}
                <StatusPill tone={selectedRule.is_active ? "ok" : "warn"}>
                  {selectedRule.is_active ? "Active" : "Paused"}
                </StatusPill>
              </div>
              {/* Pausing is reversible in one click, so no confirmation. */}
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-border/40 shrink-0"
                onClick={() => handleToggleActive(selectedRule)}
                disabled={togglingActive}
              >
                {selectedRule.is_active ? (
                  <>
                    <PauseCircle aria-hidden="true" className="h-3.5 w-3.5" />
                    Pause rule
                  </>
                ) : (
                  <>
                    <PlayCircle aria-hidden="true" className="h-3.5 w-3.5" />
                    Resume rule
                  </>
                )}
              </Button>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Expires
              </p>
              {/* An already-lapsed rule used to render as an ordinary date,
                    so a block that stopped being enforced last week looked
                    exactly like one that expires next month. */}
              {(() => {
                const expiresIn = ruleExpiry(selectedRule.expires_at);
                if (expiresIn.state === "none") {
                  return (
                    <p className="text-sm text-foreground">
                      Never. This rule stays until it is paused or deleted.
                    </p>
                  );
                }
                const stamp = new Date(
                  selectedRule.expires_at as string,
                ).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                if (expiresIn.state === "ok") {
                  return (
                    <p className="text-sm text-foreground tabular-nums">
                      {stamp}
                    </p>
                  );
                }
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      tone={expiresIn.state === "expired" ? "crit" : "warn"}
                    >
                      {expiresIn.state === "expired"
                        ? "Expired, no longer enforced"
                        : expiresIn.label}
                    </StatusPill>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {stamp}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
        </ModalShell>
      )}

      <div className="space-y-6">
        {actionError && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/10">
            <div className="p-2 rounded-lg bg-destructive/20 shrink-0">
              <AlertTriangle
                className="h-4 w-4 text-destructive"
                aria-hidden="true"
              />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">
                {actionError}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-11 w-11 sm:h-7 sm:w-7 p-0 shrink-0"
              onClick={() => setActionError(null)}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        )}

        {/* Stats */}
        <StatBar
          items={[
            {
              label: "All Rules",
              value: rules.length,
              icon: ListChecks,
              tone: "muted",
              onClick: () => setTypeFilter("all"),
              active: typeFilter === "all",
            },
            {
              label: "Blocked (Blacklist)",
              value: blacklistCount,
              icon: Ban,
              tone: "destructive",
              onClick: () => setTypeFilter("blacklist"),
              active: typeFilter === "blacklist",
            },
            {
              label: "Allowed (Whitelist)",
              value: whitelistCount,
              icon: ShieldCheck,
              tone: "success",
              onClick: () => setTypeFilter("whitelist"),
              active: typeFilter === "whitelist",
            },
            {
              label: "Total Hits",
              value: totalHits,
              icon: AlertTriangle,
              tone: "orange",
            },
          ]}
        />

        {/* Add Rule Card */}
        <Card className="border-border/50 bg-card/50">
          <AdminPanelHeader
            icon={Plus}
            title="Add Access Rule"
            subtitle="Create whitelist or blacklist rules for IP addresses or URLs"
          />
          <CardContent className="pt-6">
            <form onSubmit={handleFormSubmit} className="space-y-4">
              {/* Type Toggle */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                  Rule Target
                </label>
                <Tabs
                  value={valueType}
                  onValueChange={(v) => setValueType(v as "ip" | "url")}
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="ip" className="gap-2">
                      <Network aria-hidden="true" className="h-4 w-4" />
                      <span className="hidden sm:inline">IP Address</span>
                      <span className="sm:hidden">IP</span>
                    </TabsTrigger>
                    <TabsTrigger value="url" className="gap-2">
                      <Globe aria-hidden="true" className="h-4 w-4" />
                      <span className="hidden sm:inline">URL / Domain</span>
                      <span className="sm:hidden">URL</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor={valueFieldId}
                    className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block"
                  >
                    {valueType === "ip" ? "IP Address / CIDR" : "Domain"}
                  </label>
                  <Input
                    id={valueFieldId}
                    placeholder={
                      valueType === "ip"
                        ? "192.168.1.0/24 or 10.0.0.1"
                        : "example.com (blocks all subdomains & paths)"
                    }
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    className="bg-background/50 border-border/40"
                  />
                  {valueType === "url" && (
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Enter domain only (no http:// or https://). Blocking
                      example.com also blocks sub.example.com and
                      example.com/any/path
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor={ruleTypeId}
                    className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block"
                  >
                    Rule Type
                  </label>
                  <select
                    id={ruleTypeId}
                    value={ruleType}
                    onChange={(e) =>
                      setRuleType(e.target.value as "whitelist" | "blacklist")
                    }
                    className="w-full rounded-md border border-border/40 bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="whitelist">Whitelist (Allow)</option>
                    <option value="blacklist">Blacklist (Block)</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor={descriptionId}
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block"
                >
                  Description (optional)
                </label>
                <Input
                  id={descriptionId}
                  placeholder={
                    valueType === "ip"
                      ? "e.g., Office network"
                      : "e.g., Blocked competitor site"
                  }
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-background/50 border-border/40"
                />
              </div>

              <div>
                <label
                  htmlFor={reasonId}
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block"
                >
                  Reason (optional)
                </label>
                <Input
                  id={reasonId}
                  placeholder="e.g., Security policy"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="bg-background/50 border-border/40"
                />
              </div>

              <div>
                <label
                  htmlFor={expiryId}
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block"
                >
                  Expires
                </label>
                <select
                  id={expiryId}
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="w-full rounded-md border border-border/40 bg-background/50 px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                >
                  {EXPIRY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  An expired rule stops being enforced on its own. Most blocks
                  are temporary, so pick a window rather than deleting the rule
                  by hand later.
                </p>
              </div>

              <Button type="submit" className="w-full" disabled={!newValue}>
                <Plus aria-hidden="true" className="h-4 w-4 mr-2" />
                Add Rule
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Rules List */}
        <Card className="border-border/50 bg-card/50 overflow-hidden">
          <AdminPanelHeader
            icon={Globe}
            title="Access Rules"
            subtitle="Manage whitelist and blacklist rules for IPs and URLs"
            status={
              // Hidden on a failed load: "0 active" next to the title would
              // be the same false all-clear the empty state below is careful
              // not to render.
              fetchError ? null : (
                <Badge
                  variant="secondary"
                  className="text-[11px] font-medium h-5 px-2 shrink-0 tabular-nums"
                >
                  {rules.filter((r) => r.is_active).length} active
                </Badge>
              )
            }
            actions={
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-2 border-border/40 shrink-0"
                onClick={() => fetchRules()}
                disabled={loading}
                aria-label="Refresh rules"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn("h-4 w-4", loading && "animate-spin")}
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            }
          >
            {/* The paused toggle is a filter over the list below, not a panel
                action, so it sits on the filter row rather than beside
                Refresh. */}
            {pausedCount > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  variant={showPaused ? "secondary" : "outline"}
                  size="sm"
                  className="h-9 px-3 gap-2 border-border/40"
                  onClick={() => setShowPaused((v) => !v)}
                  aria-pressed={showPaused}
                >
                  <PauseCircle aria-hidden="true" className="h-4 w-4" />
                  {showPaused ? "Hide paused" : `Show ${pausedCount} paused`}
                </Button>
              </div>
            )}
          </AdminPanelHeader>

          <CardContent className="p-0">
            {loading && rules.length === 0 ? (
              <div className="p-4">
                <DataTableSkeleton rows={6} />
              </div>
            ) : fetchError ? (
              <EmptyState
                icon={AlertTriangle}
                title="Couldn't load rules"
                description={fetchError}
              />
            ) : rules.length === 0 ? (
              <EmptyState
                icon={Network}
                title="No rules configured"
                description="Add your first IP or URL rule above."
              />
            ) : sortedRules.length === 0 ? (
              <EmptyState
                icon={Network}
                title={
                  typeFilter === "all"
                    ? "No active rules"
                    : `No ${typeFilter} rules`
                }
                description={
                  pausedCount > 0 && !showPaused
                    ? `Every matching rule is paused. Use "Show ${pausedCount} paused" above.`
                    : "Try a different filter above."
                }
              />
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block">
                  <TableScrollArea maxHeight="65vh">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm supports-backdrop-filter:bg-muted/90">
                        <TableRow className="border-y border-border/50 hover:bg-transparent">
                          <TableHead className="px-5 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Rule
                          </TableHead>
                          <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Type
                          </TableHead>
                          <TableHead className="px-4 h-10">
                            <SortableHeader
                              label="Hits"
                              active={sortColumn === "hits"}
                              direction={sortDirection}
                              onClick={handleSortHits}
                            />
                          </TableHead>
                          <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Created
                          </TableHead>
                          {/* expires_at has always been on the row and was
                              only visible inside the detail modal, so "which
                              of my blocks lapse this week" could not be
                              answered from the list at all. */}
                          <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Expires
                          </TableHead>
                          <TableHead className="px-5 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody
                        className={cn(
                          "transition-opacity duration-200",
                          loading && "opacity-40 pointer-events-none",
                        )}
                      >
                        {sortedRules.map((rule) => {
                          const expiresIn = ruleExpiry(rule.expires_at);
                          return (
                            /* a11y (SC 2.1.1): row click was the only route to
                               a rule's detail panel. See the note on the same
                               fix in components/admin/users/users-tab.tsx. */
                            <TableRow
                              key={rule.id}
                              tabIndex={0}
                              className="border-border/40 hover:bg-muted/50 transition-colors group cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                              onClick={() => setSelectedRule(rule)}
                              onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedRule(rule);
                                }
                              }}
                            >
                              <TableCell className="px-5 py-2.5">
                                <div className="flex items-center gap-3">
                                  <div className="p-2 rounded-lg bg-muted/50 shrink-0">
                                    {rule.value_type === "url" ? (
                                      <Globe
                                        aria-hidden="true"
                                        className="h-4 w-4 text-muted-foreground"
                                      />
                                    ) : (
                                      <Network
                                        aria-hidden="true"
                                        className="h-4 w-4 text-muted-foreground"
                                      />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-mono text-foreground truncate">
                                      {rule.ip_address}
                                    </p>
                                    {rule.description && (
                                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                                        {rule.description}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-2.5">
                                <Badge
                                  className={cn(
                                    "text-[10px] px-2 py-0.5 font-medium",
                                    rule.rule_type === "whitelist"
                                      ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20"
                                      : "bg-destructive/10 text-destructive border-destructive/20",
                                  )}
                                >
                                  {rule.rule_type === "whitelist"
                                    ? "Allow"
                                    : "Block"}
                                </Badge>
                                {!rule.is_active && (
                                  <StatusPill
                                    tone="warn"
                                    icon={PauseCircle}
                                    className="ml-1.5"
                                  >
                                    Paused
                                  </StatusPill>
                                )}
                              </TableCell>
                              <TableCell className="px-4 py-2.5">
                                <span className="text-sm font-medium text-foreground tabular-nums">
                                  {rule.hit_count}
                                </span>
                              </TableCell>
                              <TableCell className="px-4 py-2.5 text-sm text-muted-foreground whitespace-nowrap tabular-nums">
                                {new Date(rule.created_at).toLocaleDateString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  },
                                )}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 whitespace-nowrap">
                                {expiresIn.state === "expired" ||
                                expiresIn.state === "soon" ? (
                                  <StatusPill
                                    tone={
                                      expiresIn.state === "expired"
                                        ? "crit"
                                        : "warn"
                                    }
                                  >
                                    {expiresIn.label}
                                  </StatusPill>
                                ) : (
                                  <span
                                    className={cn(
                                      "text-sm tabular-nums",
                                      expiresIn.state === "none"
                                        ? "text-muted-foreground"
                                        : "text-muted-foreground",
                                    )}
                                  >
                                    {expiresIn.label}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="px-5 py-2.5">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedRule(rule);
                                    }}
                                  >
                                    <Eye
                                      aria-hidden="true"
                                      className="h-3.5 w-3.5"
                                    />
                                    <span className="text-xs">View</span>
                                  </Button>
                                  {/* Delete is the one irreversible action in
                                    the row, so it does not hide behind the
                                    same hover as View. */}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-8 p-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPendingDelete(rule);
                                    }}
                                    aria-label={`Delete rule ${rule.ip_address}`}
                                  >
                                    <Trash2
                                      aria-hidden="true"
                                      className="h-3.5 w-3.5"
                                    />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableScrollArea>
                </div>

                {/* Mobile list */}
                <div
                  className={cn(
                    "md:hidden flex flex-col transition-opacity duration-200",
                    loading && "opacity-40 pointer-events-none",
                  )}
                >
                  {sortedRules.map((rule) => {
                    const expiresIn = ruleExpiry(rule.expires_at);
                    return (
                      /* a11y (SC 2.1.1 / 4.1.2): the md:hidden mirror of the
                       table row above, and below md it is the ONLY route to a
                       rule's detail. It is a plain div, so unlike the <tr> it
                       can take role="button" without displacing a table
                       role. */
                      <div
                        key={rule.id}
                        role="button"
                        tabIndex={0}
                        className="flex items-center gap-3 px-5 py-4 border-b border-border/40 last:border-0 hover:bg-muted/50 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() => setSelectedRule(rule)}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedRule(rule);
                          }
                        }}
                      >
                        <div className="p-2 rounded-lg bg-muted/50 shrink-0">
                          {rule.value_type === "url" ? (
                            <Globe
                              aria-hidden="true"
                              className="h-4 w-4 text-muted-foreground"
                            />
                          ) : (
                            <Network
                              aria-hidden="true"
                              className="h-4 w-4 text-muted-foreground"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* flex-wrap: the Allow/Block badge and the Paused
                              pill beside it are both shrink-0, so an IPv6 or
                              a URL had about 74px on a phone. */}
                          <div className="flex flex-wrap items-center gap-2 mb-0.5">
                            <p
                              title={rule.ip_address}
                              className="min-w-0 text-sm font-mono text-foreground truncate"
                            >
                              {rule.ip_address}
                            </p>
                            <Badge
                              className={cn(
                                "text-[10px] px-1.5 py-0 font-medium shrink-0",
                                rule.rule_type === "whitelist"
                                  ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20"
                                  : "bg-destructive/10 text-destructive border-destructive/20",
                              )}
                            >
                              {rule.rule_type === "whitelist"
                                ? "Allow"
                                : "Block"}
                            </Badge>
                            {!rule.is_active && (
                              <StatusPill
                                tone="warn"
                                icon={PauseCircle}
                                className="shrink-0"
                              >
                                Paused
                              </StatusPill>
                            )}
                          </div>
                          {rule.description && (
                            <p className="text-xs text-muted-foreground truncate mb-1">
                              {rule.description}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            <span className="tabular-nums">
                              {pluralize(rule.hit_count, "hit")}
                            </span>
                            <span className="text-border" aria-hidden="true">
                              |
                            </span>
                            <span className="tabular-nums">
                              {new Date(rule.created_at).toLocaleDateString(
                                "en-US",
                                { month: "short", day: "numeric" },
                              )}
                            </span>
                            {(expiresIn.state === "expired" ||
                              expiresIn.state === "soon") && (
                              <StatusPill
                                tone={
                                  expiresIn.state === "expired"
                                    ? "crit"
                                    : "warn"
                                }
                              >
                                {expiresIn.label}
                              </StatusPill>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 w-11 sm:h-8 sm:w-8 p-0 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(rule);
                          }}
                          aria-label={`Delete rule ${rule.ip_address}`}
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Add Rule Confirmation Modal */}
        <SaveConfirmationModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onConfirm={async () => {
            await handleAddRule();
            setShowAddModal(false);
          }}
          title="Add Access Rule"
          description={`Create a new ${ruleType} rule for ${valueType === "ip" ? "IP address" : "URL/domain"}.`}
          changes={addChangeItems}
          loading={adding}
          confirmText="Add Rule"
        />

        {/* Delete Confirmation Modal */}
        <SaveConfirmationModal
          isOpen={!!pendingDelete}
          onClose={() => setPendingDelete(null)}
          onConfirm={handleDeleteRule}
          title="Delete Access Rule"
          description="This action cannot be undone."
          changes={
            pendingDelete
              ? [
                  {
                    field: "value",
                    label:
                      pendingDelete.value_type === "url"
                        ? "URL/Domain"
                        : "IP Address",
                    oldValue: pendingDelete.ip_address,
                    newValue: "Removed",
                  },
                  {
                    field: "rule_type",
                    label: "Rule Type",
                    oldValue: pendingDelete.rule_type,
                    newValue: "Deleted",
                  },
                ]
              : []
          }
          loading={deleting}
          confirmText="Delete Rule"
          variant="destructive"
        />
      </div>
    </>
  );
}
