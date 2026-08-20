"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Trash2,
  RefreshCw,
  Globe,
  Network,
  Loader2,
  AlertTriangle,
  Search,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Ban,
  FileSearch,
} from "lucide-react";
import {
  SaveConfirmationModal,
  type ChangeItem,
} from "@/components/shared/save-confirmation-modal";
import {
  EmptyState,
  TableScrollArea,
  DataTableSkeleton,
  StatBar,
  Toast,
} from "@/components/admin/shared";
import { cn } from "@/lib/ui/utils";

interface BlockedRule {
  id: number;
  rule_type: "blacklist";
  value_type: "ip" | "url";
  ip_address: string;
  description?: string;
  reason?: string;
  is_active: boolean;
  hit_count: number;
  created_at: string;
}

interface MatchingScan {
  id: number;
  url: string;
  source: string;
  scanned_at: string;
  user_email?: string;
  user_id: number;
}

export function BlockedDataManager() {
  const [blockedRules, setBlockedRules] = useState<BlockedRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRule, setExpandedRule] = useState<number | null>(null);
  const [matchingScans, setMatchingScans] = useState<
    Record<number, MatchingScan[]>
  >({});
  const [loadingScans, setLoadingScans] = useState<number | null>(null);
  const [deletingScans, setDeletingScans] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    ruleId: number;
    scanCount: number;
    value: string;
  } | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Free-form lookup: not tied to an access-rules blacklist entry. Covers
  // the "something ended up public that shouldn't have" case -- a host or
  // scan an admin needs gone right now, before (or without ever) adding a
  // formal blacklist rule for it.
  const [lookupValue, setLookupValue] = useState("");
  const [lookupScans, setLookupScans] = useState<MatchingScan[] | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [pendingLookupDelete, setPendingLookupDelete] = useState<{
    value: string;
    scanCount: number;
  } | null>(null);
  const [deletingLookupScans, setDeletingLookupScans] = useState(false);
  const [pendingPurgeHost, setPendingPurgeHost] = useState<string | null>(null);
  const [purgingHost, setPurgingHost] = useState(false);

  const fetchBlockedRules = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", section: "access_rules" }),
      });
      const data = await res.json();
      // Filter to only show blacklist rules
      const blacklistRules = (data.rules || []).filter(
        (r: BlockedRule) => r.rule_type === "blacklist" && r.is_active,
      );
      setBlockedRules(blacklistRules);
    } catch (error) {
      console.error("Error fetching blocked rules:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchBlockedRules();
  }, []);

  const fetchMatchingScans = async (ruleId: number, value: string) => {
    setLoadingScans(ruleId);
    try {
      const res = await fetch("/api/v3/admin/blocked-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "find_scans", value }),
      });
      const data = await res.json();
      setMatchingScans((prev) => ({ ...prev, [ruleId]: data.scans || [] }));
    } catch (error) {
      console.error("Error fetching matching scans:", error);
      setToast({ message: "Failed to fetch matching scans", type: "error" });
    } finally {
      setLoadingScans(null);
    }
  };

  const handleToggleExpand = async (ruleId: number, value: string) => {
    if (expandedRule === ruleId) {
      setExpandedRule(null);
    } else {
      setExpandedRule(ruleId);
      if (!matchingScans[ruleId]) {
        await fetchMatchingScans(ruleId, value);
      }
    }
  };

  const handleDeleteScans = async () => {
    if (!pendingDelete) return;
    setDeletingScans(pendingDelete.ruleId);
    try {
      const res = await fetch("/api/v3/admin/blocked-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_scans",
          value: pendingDelete.value,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setToast({
          message: `Deleted ${data.deletedCount || 0} scan(s) for ${pendingDelete.value}`,
          type: "success",
        });
        // Clear cached scans and refresh
        setMatchingScans((prev) => {
          const newScans = { ...prev };
          delete newScans[pendingDelete.ruleId];
          return newScans;
        });
        // Refetch to show updated state
        await fetchMatchingScans(pendingDelete.ruleId, pendingDelete.value);
        setPendingDelete(null);
        return { ok: true };
      }
      setToast({
        message: data.error || "Failed to delete scans",
        type: "error",
      });
      return { ok: false, error: data.error };
    } catch (error) {
      console.error("Error deleting scans:", error);
      setToast({ message: "Failed to delete scans", type: "error" });
      return { ok: false, error: "Failed to delete scans" };
    } finally {
      setDeletingScans(null);
    }
  };

  const handleLookupSearch = async () => {
    const value = lookupValue.trim();
    if (!value) return;
    setLookupLoading(true);
    setLookupScans(null);
    try {
      const res = await fetch("/api/v3/admin/blocked-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "find_scans", value }),
      });
      const data = await res.json();
      if (res.ok) {
        setLookupScans(data.scans || []);
      } else {
        setToast({ message: data.error || "Lookup failed", type: "error" });
      }
    } catch (error) {
      console.error("Error looking up host:", error);
      setToast({ message: "Lookup failed", type: "error" });
    } finally {
      setLookupLoading(false);
    }
  };

  const handleDeleteLookupScans = async () => {
    if (!pendingLookupDelete) return;
    setDeletingLookupScans(true);
    try {
      const res = await fetch("/api/v3/admin/blocked-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_scans",
          value: pendingLookupDelete.value,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setToast({
          message: `Deleted ${data.deletedCount || 0} scan(s) for ${pendingLookupDelete.value}`,
          type: "success",
        });
        setLookupScans([]);
        setPendingLookupDelete(null);
        return { ok: true };
      }
      setToast({
        message: data.error || "Failed to delete scans",
        type: "error",
      });
      return { ok: false, error: data.error };
    } catch (error) {
      console.error("Error deleting scans:", error);
      setToast({ message: "Failed to delete scans", type: "error" });
      return { ok: false, error: "Failed to delete scans" };
    } finally {
      setDeletingLookupScans(false);
    }
  };

  const handlePurgeHost = async () => {
    if (!pendingPurgeHost) return;
    setPurgingHost(true);
    try {
      const res = await fetch("/api/v3/admin/blocked-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "purge_host_reputation",
          value: pendingPurgeHost,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ message: data.message, type: "success" });
        setPendingPurgeHost(null);
        return { ok: true };
      }
      setToast({
        message: data.error || "Failed to purge host reputation",
        type: "error",
      });
      return { ok: false, error: data.error };
    } catch (error) {
      console.error("Error purging host reputation:", error);
      setToast({ message: "Failed to purge host reputation", type: "error" });
      return { ok: false, error: "Failed to purge host reputation" };
    } finally {
      setPurgingHost(false);
    }
  };

  const filteredRules = blockedRules.filter(
    (rule) =>
      rule.ip_address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const totalScansFound = Object.values(matchingScans).reduce(
    (sum, scans) => sum + scans.length,
    0,
  );

  const deleteChangeItems: ChangeItem[] = pendingDelete
    ? [
        {
          field: "target",
          label: "Blocked URL/IP",
          oldValue: pendingDelete.value,
          newValue: "All data will be deleted",
        },
        {
          field: "scans",
          label: "Scans to Delete",
          oldValue: `${pendingDelete.scanCount} scan(s)`,
          newValue: "0",
        },
      ]
    : [];

  const lookupDeleteChangeItems: ChangeItem[] = pendingLookupDelete
    ? [
        {
          field: "target",
          label: "Host/URL",
          oldValue: pendingLookupDelete.value,
          newValue: "All data will be deleted",
        },
        {
          field: "scans",
          label: "Scans to Delete",
          oldValue: `${pendingLookupDelete.scanCount} scan(s)`,
          newValue: "0",
        },
      ]
    : [];

  const purgeHostChangeItems: ChangeItem[] = pendingPurgeHost
    ? [
        {
          field: "host",
          label: "Host",
          oldValue: pendingPurgeHost,
          newValue: "Removed from public host directory",
        },
      ]
    : [];

  return (
    <>
      {/* Delete confirmation modal */}
      <SaveConfirmationModal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDeleteScans}
        title="Delete Blocked Data"
        description={
          pendingDelete
            ? `This will permanently delete ${pendingDelete.scanCount} scan${pendingDelete.scanCount !== 1 ? "s" : ""} of history for "${pendingDelete.value}". This action cannot be undone.`
            : undefined
        }
        confirmLabel="Delete All Data"
        changes={deleteChangeItems}
        loading={deletingScans !== null}
        variant="destructive"
      />

      {/* Free-form lookup delete confirmation */}
      <SaveConfirmationModal
        isOpen={!!pendingLookupDelete}
        onClose={() => setPendingLookupDelete(null)}
        onConfirm={handleDeleteLookupScans}
        title="Delete Scan History"
        description={
          pendingLookupDelete
            ? `This will permanently delete ${pendingLookupDelete.scanCount} scan${pendingLookupDelete.scanCount !== 1 ? "s" : ""} of history for "${pendingLookupDelete.value}". This action cannot be undone.`
            : undefined
        }
        confirmLabel="Delete All Data"
        changes={lookupDeleteChangeItems}
        loading={deletingLookupScans}
        variant="destructive"
      />

      {/* Purge host reputation confirmation */}
      <SaveConfirmationModal
        isOpen={!!pendingPurgeHost}
        onClose={() => setPendingPurgeHost(null)}
        onConfirm={handlePurgeHost}
        title="Purge Host Reputation"
        description={
          pendingPurgeHost
            ? `This removes "${pendingPurgeHost}" from the public host directory and reputation cache (/host/${pendingPurgeHost}). It does not delete the underlying scan history -- a new scan will rebuild it. This action cannot be undone.`
            : undefined
        }
        confirmLabel="Purge Host"
        changes={purgeHostChangeItems}
        loading={purgingHost}
        variant="destructive"
      />

      {/* Toast */}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      <div className="space-y-6">
        {/* Stats */}
        <StatBar
          items={[
            { label: "Blocked Rules", value: blockedRules.length, icon: Ban },
            {
              label: "Scans Found",
              value: totalScansFound,
              icon: FileSearch,
            },
            {
              label: "Block Attempts",
              value: blockedRules.reduce((sum, r) => sum + r.hit_count, 0),
              icon: AlertTriangle,
            },
          ]}
        />

        {/* Info Card */}
        <Card className="border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-[hsl(var(--warning))]/10 shrink-0">
                <AlertTriangle
                  aria-hidden="true"
                  className="h-4 w-4 text-[hsl(var(--warning))]"
                />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Blocked Data Management
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  This page shows all blocked URLs and IPs. You can find and
                  delete any scan history that matches these blocked entries.
                  Use this when a URL owner requests their data to be removed,
                  or to clean up scans that should not have been performed.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Free-form lookup: any host or URL, no blacklist rule required */}
        <Card className="border-border/50 bg-card/50 overflow-hidden">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                <Search aria-hidden="true" className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base font-semibold truncate">
                  Look Up Any Host or URL
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  For something that ended up public and shouldn't have -- no
                  blacklist rule needed first.
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <div className="relative flex-1">
                <Search
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                />
                <Input
                  placeholder="example.com or https://example.com/path"
                  value={lookupValue}
                  onChange={(e) => setLookupValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLookupSearch();
                  }}
                  aria-label="Host or URL to look up"
                  className="pl-10 bg-background/50 border-border/40"
                />
              </div>
              <Button
                onClick={handleLookupSearch}
                disabled={lookupLoading || !lookupValue.trim()}
                className="h-10 shrink-0"
              >
                {lookupLoading ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                  />
                ) : (
                  "Search"
                )}
              </Button>
            </div>
          </CardHeader>

          {lookupScans !== null && (
            <CardContent className="p-0 border-t border-border/40">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <p className="text-xs text-muted-foreground">
                  {lookupScans.length === 0 ? (
                    "No scan history found for that value."
                  ) : (
                    <>
                      Found{" "}
                      <span className="font-medium text-foreground">
                        {lookupScans.length}
                      </span>{" "}
                      scan{lookupScans.length !== 1 ? "s" : ""} for{" "}
                      <span className="font-mono text-foreground">
                        {lookupValue.trim()}
                      </span>
                    </>
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
                    onClick={() => setPendingPurgeHost(lookupValue.trim())}
                    disabled={purgingHost}
                  >
                    {purgingHost ? (
                      <Loader2
                        aria-hidden="true"
                        className="h-3.5 w-3.5 animate-spin"
                      />
                    ) : (
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    )}
                    Purge host reputation
                  </Button>
                  {lookupScans.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() =>
                        setPendingLookupDelete({
                          value: lookupValue.trim(),
                          scanCount: lookupScans.length,
                        })
                      }
                      disabled={deletingLookupScans}
                    >
                      {deletingLookupScans ? (
                        <Loader2
                          aria-hidden="true"
                          className="h-3.5 w-3.5 animate-spin"
                        />
                      ) : (
                        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                      )}
                      Delete all scans
                    </Button>
                  )}
                </div>
              </div>

              {lookupScans.length > 0 && (
                <div className="border-t border-border/40">
                  <TableScrollArea maxHeight="16rem">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm supports-backdrop-filter:bg-muted/90">
                        <TableRow className="border-y border-border/50 hover:bg-transparent">
                          <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            URL
                          </TableHead>
                          <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            User
                          </TableHead>
                          <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Type
                          </TableHead>
                          <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Date
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lookupScans.map((scan) => (
                          <TableRow key={scan.id} className="border-border/30">
                            <TableCell className="px-4 py-2.5">
                              <p
                                className="text-xs font-mono text-foreground truncate max-w-[200px]"
                                title={scan.url}
                              >
                                {scan.url}
                              </p>
                            </TableCell>
                            <TableCell className="px-4 py-2.5">
                              <p className="text-xs font-mono text-muted-foreground truncate max-w-[150px]">
                                {scan.user_email || `User #${scan.user_id}`}
                              </p>
                            </TableCell>
                            <TableCell className="px-4 py-2.5">
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0"
                              >
                                {scan.source}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(scan.scanned_at).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                },
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableScrollArea>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Blocked Rules List */}
        <Card className="border-border/50 bg-card/50 overflow-hidden">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-destructive/10 shrink-0">
                  <Globe
                    aria-hidden="true"
                    className="h-4 w-4 text-destructive"
                  />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base font-semibold truncate">
                    Blocked URLs & IPs
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    Find and delete scan data for blocked entries
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-2 border-border/40 shrink-0"
                onClick={() => fetchBlockedRules()}
                disabled={loading}
                aria-label="Refresh blocked rules"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn("h-4 w-4", loading && "animate-spin")}
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>

            {/* Search */}
            <div className="mt-4 relative">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              />
              <Input
                placeholder="Search blocked URLs or IPs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search blocked URLs or IPs"
                className="pl-10 bg-background/50 border-border/40"
              />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="p-4">
                <DataTableSkeleton rows={5} />
              </div>
            ) : filteredRules.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="No blocked rules"
                description={
                  searchQuery
                    ? `No results for "${searchQuery}".`
                    : "Add blacklist rules in Access Rules to see them here."
                }
              />
            ) : (
              <div className="divide-y divide-border/40">
                {filteredRules.map((rule) => {
                  const isExpanded = expandedRule === rule.id;
                  const scans = matchingScans[rule.id] || [];
                  const isLoadingThisRule = loadingScans === rule.id;

                  return (
                    <div key={rule.id} className="group">
                      {/* Rule header */}
                      <button
                        onClick={() =>
                          handleToggleExpand(rule.id, rule.ip_address)
                        }
                        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/20 transition-colors text-left"
                      >
                        <div className="p-2 rounded-lg bg-muted/50 shrink-0">
                          {rule.value_type === "url" ? (
                            <Globe
                              aria-hidden="true"
                              className="h-4 w-4 text-destructive"
                            />
                          ) : (
                            <Network
                              aria-hidden="true"
                              className="h-4 w-4 text-destructive"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-mono text-foreground truncate">
                            {rule.ip_address}
                          </p>
                          {rule.description && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {rule.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge
                            variant="outline"
                            className="text-[10px] px-2 py-0.5 font-medium bg-muted/30"
                          >
                            {rule.hit_count} hits
                          </Badge>
                          {matchingScans[rule.id] && (
                            <Badge
                              className={cn(
                                "text-[10px] px-2 py-0.5 font-medium",
                                scans.length > 0
                                  ? "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20"
                                  : "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20",
                              )}
                            >
                              {scans.length} scan{scans.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                          {isLoadingThisRule ? (
                            <Loader2
                              aria-hidden="true"
                              className="h-4 w-4 animate-spin text-muted-foreground"
                            />
                          ) : isExpanded ? (
                            <ChevronUp
                              aria-hidden="true"
                              className="h-4 w-4 text-muted-foreground"
                            />
                          ) : (
                            <ChevronDown
                              aria-hidden="true"
                              className="h-4 w-4 text-muted-foreground"
                            />
                          )}
                        </div>
                      </button>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="px-5 pb-4 bg-muted/10 border-t border-border/30">
                          {isLoadingThisRule ? (
                            <div className="flex items-center justify-center py-8">
                              <Loader2
                                aria-hidden="true"
                                className="h-5 w-5 animate-spin text-primary mr-2"
                              />
                              <span className="text-sm text-muted-foreground">
                                Searching scan history...
                              </span>
                            </div>
                          ) : scans.length === 0 ? (
                            <div className="flex items-center gap-3 py-6 justify-center">
                              <CheckCircle2
                                aria-hidden="true"
                                className="h-5 w-5 text-[hsl(var(--success))]"
                              />
                              <span className="text-sm text-muted-foreground">
                                No scan data found for this blocked entry
                              </span>
                            </div>
                          ) : (
                            <div className="pt-4">
                              {/* Delete all button */}
                              <div className="flex items-center justify-between mb-4">
                                <p className="text-xs text-muted-foreground">
                                  Found{" "}
                                  <span className="font-medium text-foreground">
                                    {scans.length}
                                  </span>{" "}
                                  scan{scans.length !== 1 ? "s" : ""} matching
                                  this blocked entry
                                </p>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-8 gap-1.5"
                                  onClick={() =>
                                    setPendingDelete({
                                      ruleId: rule.id,
                                      scanCount: scans.length,
                                      value: rule.ip_address,
                                    })
                                  }
                                  disabled={deletingScans !== null}
                                >
                                  {deletingScans === rule.id ? (
                                    <Loader2
                                      aria-hidden="true"
                                      className="h-3.5 w-3.5 animate-spin"
                                    />
                                  ) : (
                                    <Trash2
                                      aria-hidden="true"
                                      className="h-3.5 w-3.5"
                                    />
                                  )}
                                  Delete All
                                </Button>
                              </div>

                              {/* Scans list */}
                              <div className="border border-border/40 rounded-lg overflow-hidden">
                                <TableScrollArea maxHeight="16rem">
                                  <Table>
                                    <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm supports-backdrop-filter:bg-muted/90">
                                      <TableRow className="border-y border-border/50 hover:bg-transparent">
                                        <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                          URL
                                        </TableHead>
                                        <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                          User
                                        </TableHead>
                                        <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                          Type
                                        </TableHead>
                                        <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                          Date
                                        </TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {scans.map((scan) => (
                                        <TableRow
                                          key={scan.id}
                                          className="border-border/30"
                                        >
                                          <TableCell className="px-4 py-2.5">
                                            <p
                                              className="text-xs font-mono text-foreground truncate max-w-[200px]"
                                              title={scan.url}
                                            >
                                              {scan.url}
                                            </p>
                                          </TableCell>
                                          <TableCell className="px-4 py-2.5">
                                            <p className="text-xs font-mono text-muted-foreground truncate max-w-[150px]">
                                              {scan.user_email ||
                                                `User #${scan.user_id}`}
                                            </p>
                                          </TableCell>
                                          <TableCell className="px-4 py-2.5">
                                            <Badge
                                              variant="outline"
                                              className="text-[10px] px-1.5 py-0"
                                            >
                                              {scan.source}
                                            </Badge>
                                          </TableCell>
                                          <TableCell className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                                            {new Date(
                                              scan.scanned_at,
                                            ).toLocaleDateString("en-US", {
                                              month: "short",
                                              day: "numeric",
                                              year: "numeric",
                                            })}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </TableScrollArea>
                                <div className="px-4 py-2 bg-muted/20 border-t border-border/30 text-center">
                                  <p className="text-xs text-muted-foreground">
                                    {scans.length} scan
                                    {scans.length !== 1 ? "s" : ""} total.
                                    Scroll to view all.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
