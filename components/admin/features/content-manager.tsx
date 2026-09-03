"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { PaginationControl } from "@/components/ui/pagination-control";
import {
  Trash2,
  RefreshCw,
  Globe,
  Loader2,
  Share2,
  EyeOff,
} from "lucide-react";
import {
  SaveConfirmationModal,
  type ChangeItem,
} from "@/components/shared/save-confirmation-modal";
import {
  AdminPanelHeader,
  EmptyState,
  StatusPill,
  TableScrollArea,
  DataTableSkeleton,
  Toast,
} from "@/components/admin/shared";
import { formatTimestamp } from "@/components/admin/utils";
import { cn } from "@/lib/ui/utils";
import { ROUTES } from "@/lib/config/client-constants";

/**
 * The 0-4 safe / 5-7 caution / 8-10 unsafe bands that getDangerScore anchors
 * its tierBase/tierCap to (lib/scanner/safety-rating.ts), and that
 * components/host/danger-score-trend-utils.ts and extension/src/lib/badge.ts
 * both encode. This table used to bucket at 4 and 7 instead of 5 and 8, so a
 * score of 4 (top of the safe band) rendered amber and a 7 (top of caution)
 * rendered red, disagreeing with the engine's own verdict on the same host.
 */
function dangerBandClass(score: number): string {
  if (score >= 8) return "border-destructive/30 text-destructive";
  if (score >= 5)
    return "border-[hsl(var(--severity-medium))]/30 text-[hsl(var(--severity-medium))]";
  return "border-border/50 text-muted-foreground";
}

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

/** A share whose expiry has already passed still occupies a row here, but its
 *  link is already dead: revoking it changes nothing a visitor would notice.
 *  The list rendered no expiry at all, so an expired share and a live one that
 *  exposes forty findings were the same grey row. */
function isExpired(row: ShareRow): boolean {
  return (
    !!row.share_expires_at &&
    new Date(row.share_expires_at).getTime() <= Date.now()
  );
}

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
  const [pageSize, setPageSize] = useState(25);
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

  // Ticket so a slower earlier fetch (e.g. the Hosts tab) can't apply its
  // total/totalPages after a newer one (Shares) -- fast tab toggling otherwise
  // binds one tab's page count to the other.
  const fetchReqRef = useRef(0);
  const fetchPage = useCallback(async (t: Tab, p: number, limit: number) => {
    const reqId = ++fetchReqRef.current;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v3/admin/content?type=${t}&page=${p}&limit=${limit}`,
      );
      const data = await res.json();
      if (reqId !== fetchReqRef.current) return;
      if (t === "hosts") {
        setHosts(data.hosts || []);
      } else {
        setShares(data.shares || []);
      }
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
    } catch (error) {
      console.error("Error fetching admin content:", error);
      if (reqId === fetchReqRef.current) {
        setToast({ message: "Failed to load list", type: "error" });
      }
    } finally {
      if (reqId === fetchReqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/tab-or-page-change: fetchPage's setState calls only fire after its async request resolves, not synchronously in this effect
    fetchPage(tab, page, pageSize);
  }, [tab, page, pageSize, fetchPage]);

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
      fetchPage("hosts", page, pageSize);
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
    if (ok) fetchPage("shares", page, pageSize);
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
      fetchPage("shares", page, pageSize);
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

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      <div className="space-y-4">
        {/* A hand-rolled rounded-xl pane rather than a <Card>: its CardHeader
            also inherited ui/card.tsx's p-6, so this panel's header padding
            was wider than every sibling's. */}
        <div className="overflow-hidden rounded-xl border border-border/50 bg-card/50">
          <AdminPanelHeader
            icon={tab === "hosts" ? Globe : Share2}
            title={tab === "hosts" ? "Public Host Directory" : "Public Shares"}
            subtitle={
              tab === "hosts"
                ? "Every host cached at /host/[hostname]: purge one to pull it from the public directory."
                : "Every scan that has ever had a share link. Unlisting hides it from the directory; revoking kills the link for everyone already holding it."
            }
            actions={
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-2 border-border/40 shrink-0"
                onClick={() => fetchPage(tab, page, pageSize)}
                disabled={loading}
                aria-label="Refresh"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn("h-4 w-4", loading && "animate-spin")}
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            }
          >
            <div className="inline-flex rounded-lg border border-border/40 bg-muted/30 p-1">
              {/* a11y (SC 4.1.2): which half of this switcher is active was
                  carried in background and text colour only. */}
              <button
                onClick={() => switchTab("hosts")}
                aria-pressed={tab === "hosts"}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  tab === "hosts"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Hosts
              </button>
              <button
                onClick={() => switchTab("shares")}
                aria-pressed={tab === "shares"}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  tab === "shares"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Public Shares
              </button>
            </div>
          </AdminPanelHeader>

          <div>
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
                <>
                  {/* Desktop table plus an md:hidden card list, the pattern the
                      sibling admin panels use. Without the card list this table
                      shipped to phones and scrolled inside a viewport too
                      narrow to read it. */}
                  <div className="hidden md:block">
                    <TableScrollArea maxHeight="28rem">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm supports-backdrop-filter:bg-muted/90">
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
                            <TableRow
                              key={row.host}
                              className="border-border/30"
                            >
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
                                    "text-[10px] px-1.5 py-0 tabular-nums",
                                    dangerBandClass(row.danger_score),
                                  )}
                                >
                                  {row.danger_score}/10
                                </Badge>
                              </TableCell>
                              <TableCell className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                                {new Date(
                                  row.last_scanned_at,
                                ).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 text-right">
                                {/* Purging a host's reputation is the
                                    destructive action of this tab and used to
                                    be a ghost h-7, lighter than the Refresh
                                    button in the header above it. */}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
                  </div>

                  {/* Mobile cards */}
                  <div className="md:hidden divide-y divide-border/30">
                    {hosts.map((row) => (
                      <div key={row.host} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <a
                            href={ROUTES.HOST(row.host)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-mono text-primary hover:underline min-w-0 wrap-break-word"
                          >
                            {row.host}
                          </a>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5 py-0 shrink-0 tabular-nums",
                              dangerBandClass(row.danger_score),
                            )}
                          >
                            {row.danger_score}/10
                          </Badge>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="text-xs text-muted-foreground">
                            {new Date(row.last_scanned_at).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              },
                            )}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )
            ) : shares.length === 0 ? (
              <EmptyState
                icon={Share2}
                title="No shared scans"
                description="Nobody has created a share link yet."
              />
            ) : (
              <>
                <div className="hidden md:block">
                  <TableScrollArea maxHeight="28rem">
                    <Table className="min-w-[720px]">
                      <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm supports-backdrop-filter:bg-muted/90">
                        <TableRow className="border-y border-border/50 hover:bg-transparent">
                          <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Share
                          </TableHead>
                          <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Owner
                          </TableHead>
                          <TableHead className="px-4 h-9 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Findings
                          </TableHead>
                          <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Status
                          </TableHead>
                          <TableHead className="px-4 h-9 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {/* The list query already selects scanned_at,
                            findings_count and share_expires_at, and the row
                            rendered none of them: a share exposing forty
                            findings, a fresh one, and one whose link expired
                            months ago were three identical grey rows. */}
                        {shares.map((row) => {
                          const expired = isExpired(row);
                          return (
                            <TableRow key={row.id} className="border-border/30">
                              <TableCell className="px-4 py-2.5">
                                <p
                                  className="text-xs font-mono text-foreground truncate max-w-[260px]"
                                  title={row.url}
                                >
                                  {row.url}
                                </p>
                                <p className="text-[11px] tabular-nums text-muted-foreground">
                                  Scanned {formatTimestamp(row.scanned_at)}
                                </p>
                              </TableCell>
                              <TableCell className="px-4 py-2.5">
                                <p className="text-xs font-mono text-muted-foreground truncate max-w-[160px]">
                                  {row.user_email || "Unknown owner"}
                                </p>
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "px-4 py-2.5 text-right text-sm tabular-nums",
                                  row.findings_count > 0
                                    ? "font-medium text-foreground"
                                    : "text-muted-foreground",
                                )}
                              >
                                {row.findings_count}
                              </TableCell>
                              <TableCell className="px-4 py-2.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {row.share_publicly_listed ? (
                                    <StatusPill tone="info">Listed</StatusPill>
                                  ) : (
                                    <StatusPill tone="neutral">
                                      Unlisted
                                    </StatusPill>
                                  )}
                                  {expired && (
                                    <StatusPill tone="neutral">
                                      Expired
                                    </StatusPill>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-2.5">
                                <div className="flex justify-end gap-1.5">
                                  {/* Unlist is reversible and cosmetic, so it
                                      stays a bare ghost control. Revoke breaks
                                      a live link for everyone holding it and
                                      cannot be undone, so it gets a container
                                      and a destructive border rather than
                                      differing from Unlist by text colour
                                      alone. */}
                                  {row.share_publicly_listed && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
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
                                    variant="outline"
                                    size="sm"
                                    className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    onClick={() => setPendingRevokeShare(row)}
                                    disabled={busyId === row.id}
                                  >
                                    {/* Revoke used only to go disabled while
                                        the request was in flight, so a click
                                        produced no visible response at all. */}
                                    {busyId === row.id ? (
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
                                    Revoke
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

                {/* Mobile cards */}
                <div className="md:hidden divide-y divide-border/30">
                  {shares.map((row) => {
                    const expired = isExpired(row);
                    return (
                      <div key={row.id} className="px-4 py-3">
                        <p
                          className="text-xs font-mono text-foreground wrap-break-word"
                          title={row.url}
                        >
                          {row.url}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <p className="text-xs font-mono text-muted-foreground truncate min-w-0">
                            {row.user_email || "Unknown owner"}
                          </p>
                          {row.share_publicly_listed ? (
                            <StatusPill tone="info" className="shrink-0">
                              Listed
                            </StatusPill>
                          ) : (
                            <StatusPill tone="neutral" className="shrink-0">
                              Unlisted
                            </StatusPill>
                          )}
                          {expired && (
                            <StatusPill tone="neutral" className="shrink-0">
                              Expired
                            </StatusPill>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                          {row.findings_count}{" "}
                          {row.findings_count === 1 ? "finding" : "findings"}
                          {" · "}
                          scanned {formatTimestamp(row.scanned_at)}
                        </p>
                        <div className="mt-2 flex justify-end gap-1.5">
                          {row.share_publicly_listed && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
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
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setPendingRevokeShare(row)}
                            disabled={busyId === row.id}
                          >
                            {busyId === row.id ? (
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
                            Revoke
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* The shared pager, not a hand-rolled Prev/Next pair. It also
                brings the per-page selector, which is why the fetch takes its
                limit from state instead of a hardcoded 20. */}
            {!loading && total > 0 && (
              <div className="border-t border-border/40 px-4 py-3">
                <PaginationControl
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  pageSize={pageSize}
                  onPageSizeChange={(s) => {
                    setPageSize(s);
                    setPage(1);
                  }}
                  totalItems={total}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
