"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Trash2,
  RefreshCw,
  Globe,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Share2,
  EyeOff,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  SaveConfirmationModal,
  type ChangeItem,
} from "@/components/shared/save-confirmation-modal";
import {
  EmptyState,
  TableScrollArea,
  DataTableSkeleton,
} from "@/components/admin/shared";
import { cn } from "@/lib/ui/utils";
import { ROUTES } from "@/lib/config/constants";

interface HostRow {
  host: string;
  danger_score: number;
  severity_counts: Record<string, number> | null;
  last_scanned_at: string;
  source_scan_id: number | null;
  auto_tags: string[] | null;
}

interface ShareRow {
  id: number;
  url: string;
  scanned_at: string;
  findings_count: number;
  share_publicly_listed: boolean;
  share_expires_at: string | null;
  user_email: string | null;
}

type Tab = "hosts" | "shares";

async function postAction(body: Record<string, unknown>) {
  const res = await fetch("/api/v3/admin/content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

export function ContentManager() {
  const [tab, setTab] = useState<Tab>("hosts");
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const [pendingPurgeHost, setPendingPurgeHost] = useState<string | null>(null);
  const [pendingRevokeShare, setPendingRevokeShare] = useState<ShareRow | null>(
    null,
  );
  const [busyId, setBusyId] = useState<string | number | null>(null);

  const fetchPage = useCallback(async (t: Tab, p: number) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v3/admin/content?type=${t}&page=${p}&limit=20`,
      );
      const data = await res.json();
      if (t === "hosts") {
        setHosts(data.hosts || []);
      } else {
        setShares(data.shares || []);
      }
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
    } catch (error) {
      console.error("Error fetching admin content:", error);
      setToast({ message: "Failed to load list", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(tab, page);
  }, [tab, page, fetchPage]);

  function switchTab(next: Tab) {
    setTab(next);
    setPage(1);
  }

  async function handlePurgeHost() {
    if (!pendingPurgeHost) return;
    setBusyId(pendingPurgeHost);
    const { ok, data } = await postAction({
      action: "purge_host",
      host: pendingPurgeHost,
    });
    setToast(
      ok
        ? {
            message: `Purged reputation for "${pendingPurgeHost}"`,
            type: "success",
          }
        : { message: data.error || "Failed to purge host", type: "error" },
    );
    setBusyId(null);
    if (ok) {
      setPendingPurgeHost(null);
      fetchPage("hosts", page);
    }
    return { ok, error: data?.error };
  }

  async function handleUnlistShare(row: ShareRow) {
    setBusyId(row.id);
    const { ok, data } = await postAction({
      action: "unlist_share",
      scanId: row.id,
    });
    setToast(
      ok
        ? {
            message: "Removed from the public scans directory",
            type: "success",
          }
        : { message: data.error || "Failed to unlist share", type: "error" },
    );
    setBusyId(null);
    if (ok) fetchPage("shares", page);
  }

  async function handleRevokeShare() {
    if (!pendingRevokeShare) return;
    setBusyId(pendingRevokeShare.id);
    const { ok, data } = await postAction({
      action: "revoke_share",
      scanId: pendingRevokeShare.id,
    });
    setToast(
      ok
        ? { message: "Share link revoked", type: "success" }
        : { message: data.error || "Failed to revoke share", type: "error" },
    );
    setBusyId(null);
    if (ok) {
      setPendingRevokeShare(null);
      fetchPage("shares", page);
    }
    return { ok, error: data?.error };
  }

  const purgeChangeItems: ChangeItem[] = pendingPurgeHost
    ? [
        {
          field: "host",
          label: "Host",
          oldValue: pendingPurgeHost,
          newValue: "Removed from public host directory",
        },
      ]
    : [];

  const revokeChangeItems: ChangeItem[] = pendingRevokeShare
    ? [
        {
          field: "share",
          label: "Share link",
          oldValue: pendingRevokeShare.url,
          newValue: "Link revoked, no longer accessible",
        },
      ]
    : [];

  return (
    <>
      <SaveConfirmationModal
        isOpen={!!pendingPurgeHost}
        onClose={() => setPendingPurgeHost(null)}
        onConfirm={handlePurgeHost}
        title="Purge Host Reputation"
        description={
          pendingPurgeHost
            ? `This removes "${pendingPurgeHost}" from the public host directory and reputation cache (/host/${pendingPurgeHost}). It does not delete the underlying scan history; a new scan will rebuild it. This action cannot be undone.`
            : undefined
        }
        confirmLabel="Purge Host"
        changes={purgeChangeItems}
        loading={busyId === pendingPurgeHost}
        variant="destructive"
      />

      <SaveConfirmationModal
        isOpen={!!pendingRevokeShare}
        onClose={() => setPendingRevokeShare(null)}
        onConfirm={handleRevokeShare}
        title="Revoke Share Link"
        description={
          pendingRevokeShare
            ? `Anyone with this link will get a "not found" page immediately, the same as an expired share. This action cannot be undone: the owner would have to create a new share link.`
            : undefined
        }
        confirmLabel="Revoke Link"
        changes={revokeChangeItems}
        loading={busyId === pendingRevokeShare?.id}
        variant="destructive"
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2">
          <div
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg",
              toast.type === "success"
                ? "bg-[hsl(var(--success))]/10 border-[hsl(var(--success))]/20 text-[hsl(var(--success))]"
                : "bg-destructive/10 border-destructive/20 text-destructive",
            )}
          >
            {toast.type === "success" ? (
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
            ) : (
              <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            )}
            <span className="text-sm font-medium">{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-2 text-current/60 hover:text-current"
              aria-label="Dismiss notification"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <Card className="border-border/50 bg-card/50 overflow-hidden">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  {tab === "hosts" ? (
                    <Globe
                      aria-hidden="true"
                      className="h-4 w-4 text-primary"
                    />
                  ) : (
                    <Share2
                      aria-hidden="true"
                      className="h-4 w-4 text-primary"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base font-semibold truncate">
                    {tab === "hosts"
                      ? "Public Host Directory"
                      : "Public Shares"}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {tab === "hosts"
                      ? "Every host cached at /host/[hostname]: purge one to pull it from the public directory."
                      : "Every scan that has ever had a share link: unlist from the public directory or revoke the link outright."}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-2 border-border/40 shrink-0"
                onClick={() => fetchPage(tab, page)}
                disabled={loading}
                aria-label="Refresh"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn("h-4 w-4", loading && "animate-spin")}
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>

            <div className="mt-4 inline-flex rounded-lg border border-border/40 bg-muted/30 p-1">
              <button
                onClick={() => switchTab("hosts")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  tab === "hosts"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Hosts
              </button>
              <button
                onClick={() => switchTab("shares")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  tab === "shares"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Public Shares
              </button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="p-4">
                <DataTableSkeleton rows={6} />
              </div>
            ) : tab === "hosts" ? (
              hosts.length === 0 ? (
                <EmptyState
                  icon={Globe}
                  title="No hosts cached"
                  description="Nothing has been scanned publicly yet."
                />
              ) : (
                <TableScrollArea maxHeight="28rem">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/90">
                      <TableRow className="border-y border-border/50 hover:bg-transparent">
                        <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Host
                        </TableHead>
                        <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Danger
                        </TableHead>
                        <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Last Scanned
                        </TableHead>
                        <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hosts.map((row) => (
                        <TableRow key={row.host} className="border-border/30">
                          <TableCell className="px-4 py-2.5">
                            <a
                              href={ROUTES.HOST(row.host)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-mono text-primary hover:underline"
                            >
                              {row.host}
                            </a>
                          </TableCell>
                          <TableCell className="px-4 py-2.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] px-1.5 py-0",
                                row.danger_score >= 7
                                  ? "border-destructive/30 text-destructive"
                                  : row.danger_score >= 4
                                    ? "border-[hsl(var(--severity-medium))]/30 text-[hsl(var(--severity-medium))]"
                                    : "border-border/50 text-muted-foreground",
                              )}
                            >
                              {row.danger_score}/10
                            </Badge>
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(row.last_scanned_at).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              },
                            )}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setPendingPurgeHost(row.host)}
                              disabled={busyId === row.host}
                            >
                              {busyId === row.host ? (
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
                              Purge
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScrollArea>
              )
            ) : shares.length === 0 ? (
              <EmptyState
                icon={Share2}
                title="No shared scans"
                description="Nobody has created a share link yet."
              />
            ) : (
              <TableScrollArea maxHeight="28rem">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/90">
                    <TableRow className="border-y border-border/50 hover:bg-transparent">
                      <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        URL
                      </TableHead>
                      <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Owner
                      </TableHead>
                      <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Listed
                      </TableHead>
                      <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shares.map((row) => (
                      <TableRow key={row.id} className="border-border/30">
                        <TableCell className="px-4 py-2.5">
                          <p
                            className="text-xs font-mono text-foreground truncate max-w-[220px]"
                            title={row.url}
                          >
                            {row.url}
                          </p>
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <p className="text-xs font-mono text-muted-foreground truncate max-w-[160px]">
                            {row.user_email || "—"}
                          </p>
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          {row.share_publicly_listed ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 border-primary/30 text-primary"
                            >
                              Listed
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 border-border/50 text-muted-foreground"
                            >
                              Unlisted
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            {row.share_publicly_listed && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 text-muted-foreground hover:text-foreground"
                                onClick={() => handleUnlistShare(row)}
                                disabled={busyId === row.id}
                              >
                                {busyId === row.id ? (
                                  <Loader2
                                    aria-hidden="true"
                                    className="h-3.5 w-3.5 animate-spin"
                                  />
                                ) : (
                                  <EyeOff
                                    aria-hidden="true"
                                    className="h-3.5 w-3.5"
                                  />
                                )}
                                Unlist
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setPendingRevokeShare(row)}
                              disabled={busyId === row.id}
                            >
                              <Trash2
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
                              Revoke
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScrollArea>
            )}

            {!loading && total > 0 && (
              <div className="flex items-center justify-between gap-3 border-t border-border/40 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Page {page} of {totalPages} &middot; {total} total
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                    <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
