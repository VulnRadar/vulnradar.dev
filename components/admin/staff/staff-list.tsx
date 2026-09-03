"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Shield,
  RefreshCw,
  Monitor,
  Activity,
  Clock,
  Globe,
  Dot,
  Eye,
  User,
  Users,
  Key,
  Calendar,
  ShieldCheck,
  Zap,
  CircleOff,
  UserPlus,
  Loader2,
  Check,
  Trash2,
  Mail,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/ui/utils";
import {
  PaginationControl,
  usePagination,
} from "@/components/ui/pagination-control";
import {
  UserAvatar,
  ActionBadge,
  StatBar,
  EmptyState,
  TableScrollArea,
  SortableHeader,
  nextSortDirection,
  DataTableSkeleton,
  StatBarSkeleton,
  AdminPasswordConfirmDialog,
  AdminPanelHeader,
  StatusPill,
  type SortDirection,
} from "@/components/admin/shared";
import { formatRelativeTime } from "@/components/admin/utils";
import { ModalShell } from "@/components/ui/modal-shell";
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  type StaffRole,
} from "@/lib/config/client-constants";
import type { ActiveAdmin } from "@/components/admin/types";

interface StaffListProps {
  activeAdmins: ActiveAdmin[];
  adminsLoading: boolean;
  fetchActiveAdmins: () => void;
}

type StatusFilter = "all" | "active" | "recent" | "offline";
type SortColumn = "created_at" | "total_actions";

// Roles an admin can invite someone directly into via the staff-invite
// modal below. Mirrors app/api/v3/admin/staff-invites/route.ts's own
// INVITABLE_ROLES: user (the default, not a staff role) and super_admin
// (only ever granted by the first-user bootstrap in lib/auth/auth.ts)
// are excluded.
const INVITABLE_STAFF_ROLES: readonly StaffRole[] = Object.values(
  STAFF_ROLES,
).filter(
  (role) => role !== STAFF_ROLES.USER && role !== STAFF_ROLES.SUPER_ADMIN,
);

// One outstanding staff invite, as returned by GET /api/v3/admin/staff-invites.
interface PendingInvite {
  id: number;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  invited_by_name: string | null;
  invited_by_email: string | null;
}

/**
 * An outstanding invite is a live grant of a staff role, so when it lapses is
 * a fact about it, not a footnote. The list printed a plain date, which made
 * an invite expiring tomorrow look exactly like one expiring in a month.
 */
const INVITE_EXPIRING_SOON_MS = 48 * 60 * 60 * 1000;

function inviteExpiry(expiresAt: string): {
  state: "expired" | "soon" | "ok";
  label: string;
} {
  const ms = new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return { state: "ok", label: "No expiry on record" };
  const remaining = ms - Date.now();
  if (remaining <= 0) return { state: "expired", label: "Expired" };
  const date = new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (remaining <= INVITE_EXPIRING_SOON_MS) {
    const hours = Math.max(1, Math.round(remaining / (60 * 60 * 1000)));
    return { state: "soon", label: `Expires in ${hours}h` };
  }
  return { state: "ok", label: `Expires ${date}` };
}

/**
 * Presence ladder. It used to run backwards: "Active Now" wore the neutral
 * accent while "Recently Active" wore --success, so the weaker state was the
 * greener one. Only active-now is green now, recently-active is neutral with
 * foreground text, and offline is the quietest.
 */
type Presence = "active" | "recent" | "offline";

const PRESENCE_BADGE: Record<Presence, string> = {
  active:
    "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border-[hsl(var(--success))]/30",
  recent: "bg-muted text-foreground border-border",
  offline: "bg-muted text-muted-foreground border-border",
};

const PRESENCE_DOT: Record<Presence, string> = {
  active: "bg-[hsl(var(--success))] animate-pulse",
  recent: "bg-[hsl(var(--success))]/40",
  offline: "bg-muted-foreground/40",
};

export function StaffList({
  activeAdmins,
  adminsLoading,
  fetchActiveAdmins,
}: StaffListProps) {
  const [staffPage, setStaffPage] = useState(1);
  const [staffPageSize, setStaffPageSize] = useState(10);
  const [selectedAdmin, setSelectedAdmin] = useState<ActiveAdmin | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Invite staff modal (AUDIT-010: invite-by-email instead of requiring
  // the invitee to self-register first, then be promoted separately).
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<StaffRole>(STAFF_ROLES.SUPPORT);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  // Sending an invite grants a staff role (admin is selectable) to an
  // arbitrary email address. Granting the same role through the user detail
  // panel has always required password re-auth; this path used to be one
  // unconfirmed click, so it was the cheap way to the same privilege.
  const [invitePasswordOpen, setInvitePasswordOpen] = useState(false);

  // Pending invites (GET /api/v3/admin/staff-invites): the outstanding
  // invites nobody has accepted yet, so a wrong address or wrong role can be
  // revoked before it is used instead of being stuck live until it expires.
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const fetchPendingInvites = useCallback(async () => {
    setInvitesLoading(true);
    try {
      const res = await fetch("/api/v3/admin/staff-invites");
      if (!res.ok) return;
      const data = await res.json();
      setPendingInvites(Array.isArray(data.invites) ? data.invites : []);
    } catch {
      // Non-blocking: the send-invite form still works without the list.
    } finally {
      setInvitesLoading(false);
    }
  }, []);

  // The pending/expired count now sits on the Staff Directory header, so the
  // list has to load with the panel rather than only when the invite modal
  // opens: the health overview links here specifically when invites have
  // expired unaccepted, and the operator arriving from it must see that
  // without first opening an unrelated dialog.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchPendingInvites();
  }, [fetchPendingInvites]);

  // Reload whenever the modal opens, so it reflects invites sent from another
  // admin's session too, not just this tab's own sends.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-open: kicks off an async load when the modal opens; the loading flag it sets is for that request, not synchronous derived state
    if (inviteOpen) fetchPendingInvites();
  }, [inviteOpen, fetchPendingInvites]);

  function closeInviteModal() {
    setInviteOpen(false);
    setInviteEmail("");
    setInviteRole(STAFF_ROLES.SUPPORT);
    setInviteError("");
    setInviteSuccess("");
  }

  function requestSendInvite() {
    setInviteError("");
    setInviteSuccess("");
    if (!inviteEmail.trim()) {
      setInviteError("Enter an email address.");
      return;
    }
    setInvitePasswordOpen(true);
  }

  async function handleSendInvite(
    currentAdminPassword: string,
  ): Promise<{ ok: boolean; error?: string }> {
    setInviteError("");
    setInviteSuccess("");
    setInviting(true);
    try {
      const res = await fetch("/api/v3/admin/staff-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          currentAdminPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || "Failed to send invite." };
      }
      setInviteSuccess(`Invite sent to ${inviteEmail.trim()}.`);
      setInviteEmail("");
      setInvitePasswordOpen(false);
      // Reflect the just-created invite in the pending list right away.
      fetchPendingInvites();
      return { ok: true };
    } catch {
      return { ok: false, error: "Something went wrong. Please try again." };
    } finally {
      setInviting(false);
    }
  }

  async function handleRevokeInvite(id: number) {
    setRevokingId(id);
    setInviteError("");
    try {
      const res = await fetch("/api/v3/admin/staff-invites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setInviteError(data.error || "Failed to revoke invite.");
        return;
      }
      setPendingInvites((prev) => prev.filter((invite) => invite.id !== id));
    } catch {
      setInviteError("Something went wrong revoking that invite.");
    } finally {
      setRevokingId(null);
    }
  }

  const getStatusInfo = (admin: ActiveAdmin) => {
    const isActive = admin.is_active === true;
    const isRecentlyActive =
      !isActive &&
      admin.seconds_since_heartbeat != null &&
      admin.seconds_since_heartbeat < 600;
    const presence: Presence = isActive
      ? "active"
      : isRecentlyActive
        ? "recent"
        : "offline";
    const statusDisplay = isActive
      ? "Active Now"
      : isRecentlyActive
        ? "Recently Active"
        : "Offline";
    return { isActive, isRecentlyActive, presence, statusDisplay };
  };

  // Compute stats
  const activeNow = activeAdmins.filter((a) => a.is_active).length;
  const recentlyActive = activeAdmins.filter(
    (a) =>
      !a.is_active &&
      a.seconds_since_heartbeat != null &&
      a.seconds_since_heartbeat < 600,
  ).length;
  const offline = activeAdmins.length - activeNow - recentlyActive;
  const with2FA = activeAdmins.filter((a) => a.totp_enabled).length;

  const expiredInvites = pendingInvites.filter(
    (invite) => inviteExpiry(invite.expires_at).state === "expired",
  ).length;

  const handleStatusFilter = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setStaffPage(1);
  };

  const handleSort = (column: SortColumn) => {
    const next = nextSortDirection(column, sortColumn, sortDirection);
    setSortColumn(next.column as SortColumn | null);
    setSortDirection(next.direction);
  };

  const filteredAdmins = activeAdmins.filter((admin) => {
    if (statusFilter === "all") return true;
    const { isActive, isRecentlyActive } = getStatusInfo(admin);
    if (statusFilter === "active") return isActive;
    if (statusFilter === "recent") return isRecentlyActive;
    return !isActive && !isRecentlyActive;
  });

  const sortedAdmins = sortColumn
    ? [...filteredAdmins].sort((a, b) => {
        const diff =
          sortColumn === "created_at"
            ? new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
            : a.total_actions - b.total_actions;
        return sortDirection === "asc" ? diff : -diff;
      })
    : filteredAdmins;

  const { totalPages, getPage } = usePagination(sortedAdmins, staffPageSize);
  const pagedStaff = getPage(staffPage);

  return (
    <>
      {/* Staff detail modal */}
      {selectedAdmin && (
        <ModalShell
          open
          onClose={() => setSelectedAdmin(null)}
          size="lg"
          title={selectedAdmin.name || selectedAdmin.email.split("@")[0]}
          description={<span className="font-mono">{selectedAdmin.email}</span>}
          icon={
            <div className="relative shrink-0">
              <UserAvatar
                name={selectedAdmin.name}
                email={selectedAdmin.email}
                avatarUrl={selectedAdmin.avatar_url}
                size="lg"
              />
              {(() => {
                const { presence } = getStatusInfo(selectedAdmin);
                return (
                  <div
                    aria-hidden="true"
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-card",
                      PRESENCE_DOT[presence],
                    )}
                  />
                );
              })()}
            </div>
          }
          bodyClassName="space-y-6"
        >
          {/* Role, presence and 2FA. These sat in the old hand-rolled header,
              which the header band cannot take: they are Badge divs and the
              band's description is a <p>. */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              className={cn(
                "text-[10px] px-2 py-0.5 font-medium",
                ROLE_BADGE_STYLES[selectedAdmin.role] || ROLE_BADGE_STYLES.user,
              )}
            >
              {STAFF_ROLE_LABELS[selectedAdmin.role] || selectedAdmin.role}
            </Badge>
            {(() => {
              const { presence, statusDisplay } = getStatusInfo(selectedAdmin);
              return (
                <Badge
                  className={cn(
                    "text-[10px] px-2 py-0.5 font-medium flex items-center gap-1",
                    PRESENCE_BADGE[presence],
                  )}
                >
                  <Dot className="h-2 w-2 fill-current" aria-hidden="true" />
                  {statusDisplay}
                </Badge>
              );
            })()}
            {selectedAdmin.totp_enabled && (
              <Badge className="bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20 text-[10px] px-2 py-0.5 font-medium">
                2FA
              </Badge>
            )}
          </div>

          {/* Quick stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50 flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Monitor className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-semibold leading-tight tabular-nums">
                  {selectedAdmin.active_sessions}
                </p>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                  Sessions
                </span>
              </div>
            </div>
            {/* --chart-4 rather than purple-500: this hand-rolled copy of
                    the stat tile was missed when the same raw-palette drift was
                    removed from StatBar (see shared/stat-card.tsx). */}
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50 flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-[hsl(var(--chart-4))]/10 flex items-center justify-center shrink-0">
                <Activity
                  className="h-4 w-4 text-[hsl(var(--chart-4))]"
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-semibold leading-tight tabular-nums">
                  {selectedAdmin.total_actions}
                </p>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                  Total Actions
                </span>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50 flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-[hsl(var(--warning))]/10 flex items-center justify-center shrink-0">
                <Zap
                  className="h-4 w-4 text-[hsl(var(--warning))]"
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-semibold leading-tight tabular-nums">
                  {selectedAdmin.actions_24h}
                </p>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                  Today
                </span>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50 flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-[hsl(var(--success))]/10 flex items-center justify-center shrink-0">
                <Clock
                  className="h-4 w-4 text-[hsl(var(--success))]"
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-semibold leading-tight tabular-nums">
                  {selectedAdmin.recent_actions || 0}
                </p>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                  Last 5 min
                </span>
              </div>
            </div>
          </div>

          {/* Current Activity */}
          {selectedAdmin.is_active && selectedAdmin.current_section && (
            <div className="p-4 rounded-lg bg-accent/10 border border-accent/30">
              <div className="flex items-center gap-2">
                <Monitor
                  className="h-4 w-4 text-accent-foreground"
                  aria-hidden="true"
                />
                <span className="text-sm font-medium text-accent-foreground">
                  Currently viewing: {selectedAdmin.current_section}
                </span>
              </div>
            </div>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Account Details
              </h4>
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                  <User
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      User ID
                    </p>
                    {/* break-all: an id is one unbreakable token. */}
                    <p className="text-sm font-mono break-all">
                      {selectedAdmin.id}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                  <Calendar
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Admin Since
                    </p>
                    <p className="text-sm">
                      {new Date(selectedAdmin.created_at).toLocaleDateString(
                        "en-US",
                        {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        },
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                  <ShieldCheck
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      2FA Status
                    </p>
                    {/* The same bit is a coloured badge in this modal's
                            own header. It was plain prose here, so whether an
                            admin account has 2FA depended on which half of the
                            dialog you read. Missing 2FA on a staff account is
                            amber rather than grey: it is a gap, not an
                            inapplicable field. */}
                    <div className="mt-0.5">
                      <StatusPill
                        tone={selectedAdmin.totp_enabled ? "ok" : "warn"}
                      >
                        {selectedAdmin.totp_enabled ? "Enabled" : "Not enabled"}
                      </StatusPill>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Session & Activity
              </h4>
              <div className="space-y-2">
                {selectedAdmin.last_ip && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                    <Globe
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        Last IP
                      </p>
                      {/* break-all: a full IPv6 is 39 mono characters, wider
                          than this grid cell on a phone. */}
                      <p className="text-sm font-mono break-all">
                        {selectedAdmin.last_ip}
                      </p>
                    </div>
                  </div>
                )}
                {selectedAdmin.last_session_created && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                    <Key
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        Last Session Created
                      </p>
                      <p className="text-sm">
                        {new Date(
                          selectedAdmin.last_session_created,
                        ).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                )}
                {selectedAdmin.last_heartbeat &&
                  selectedAdmin.seconds_since_heartbeat !== undefined && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                      <Clock
                        className="h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          Last Seen
                        </p>
                        {/* formatRelativeTime, not a raw minute count:
                                the old form printed "400 minutes ago" and "2
                                minutes ago" at the same weight and shape, so
                                a stale session read like a live one. */}
                        <p className="text-sm">
                          {formatRelativeTime(selectedAdmin.last_heartbeat)}
                        </p>
                      </div>
                    </div>
                  )}
              </div>
            </div>
          </div>

          {/* Last action */}
          {selectedAdmin.last_admin_action && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Last Admin Action
              </h4>
              <div className="p-4 rounded-lg bg-muted/20 border border-border/40">
                <div className="flex items-center gap-3">
                  <ActionBadge action={selectedAdmin.last_action_type || ""} />
                  <span className="text-sm text-muted-foreground">
                    {new Date(selectedAdmin.last_admin_action).toLocaleString(
                      "en-US",
                      {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </ModalShell>
      )}

      {/* Invite staff modal */}
      {inviteOpen && (
        <ModalShell
          open
          onClose={closeInviteModal}
          size="md"
          title="Invite staff"
          description="We email them a link to accept. No prior account needed."
          bodyClassName="space-y-4"
          footer={
            <>
              <Button variant="outline" onClick={closeInviteModal}>
                Close
              </Button>
              <Button
                onClick={requestSendInvite}
                disabled={inviting || !inviteEmail.trim()}
                className="gap-2"
              >
                {inviting && (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                )}
                {inviting ? "Sending..." : "Send invite"}
              </Button>
            </>
          }
        >
          {inviteError && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
            >
              {inviteError}
            </div>
          )}
          {inviteSuccess && (
            <div
              role="status"
              className="rounded-lg border border-[hsl(var(--success))]/25 bg-[hsl(var(--success))]/10 px-3.5 py-3 text-sm text-[hsl(var(--success))] flex items-center gap-2"
            >
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              {inviteSuccess}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff-invite-email">Email address</Label>
            <Input
              id="staff-invite-email"
              type="email"
              autoComplete="email"
              placeholder="teammate@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && requestSendInvite()}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff-invite-role">Role</Label>
            <select
              id="staff-invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as StaffRole)}
              className="h-10 rounded-md border border-input bg-background px-3 text-base sm:text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              {INVITABLE_STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {STAFF_ROLE_LABELS[role] || role}
                </option>
              ))}
            </select>
          </div>

          {/* Pending invites: the outstanding ones nobody has accepted
                  yet. Revoke deletes the row, which is the whole revoke --
                  the emailed link stops resolving the moment it is gone. */}
          <div className="pt-4 border-t border-border/50">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h4 className="text-sm font-semibold text-foreground">
                Pending invites
              </h4>
              {pendingInvites.length > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[11px] font-medium h-5 px-2 tabular-nums"
                >
                  {pendingInvites.length}
                </Badge>
              )}
            </div>

            {invitesLoading && pendingInvites.length === 0 ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading pending invites...
              </div>
            ) : pendingInvites.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                No invites are waiting to be accepted.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {pendingInvites.map((invite) => {
                  const expiry = inviteExpiry(invite.expires_at);
                  return (
                    <li
                      key={invite.id}
                      className={cn(
                        // Stacked below sm: the revoke button opposite is
                        // shrink-0 and the left column has no flex-1, so an
                        // invited address had almost nothing to render into.
                        "flex flex-col gap-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
                        expiry.state === "expired"
                          ? "border-destructive/30 bg-destructive/5"
                          : "border-border/50 bg-muted/30",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {invite.email}
                        </p>
                        {/* The role is the whole point of an invite, so it
                                gets the same badge the directory gives a live
                                staff member. As plain grey text it read like
                                the word "expires" next to it. */}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge
                            className={cn(
                              "text-[10px] px-1.5 py-0 font-medium",
                              ROLE_BADGE_STYLES[invite.role] ||
                                ROLE_BADGE_STYLES.user,
                            )}
                          >
                            {STAFF_ROLE_LABELS[invite.role] || invite.role}
                          </Badge>
                          {expiry.state === "ok" ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar
                                className="h-3 w-3 shrink-0"
                                aria-hidden="true"
                              />
                              {expiry.label}
                            </span>
                          ) : (
                            <StatusPill
                              tone={
                                expiry.state === "expired" ? "crit" : "warn"
                              }
                            >
                              {expiry.label}
                            </StatusPill>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => handleRevokeInvite(invite.id)}
                        disabled={revokingId === invite.id}
                        aria-label={`Revoke invite for ${invite.email}`}
                      >
                        {revokingId === invite.id ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        )}
                        <span className="hidden sm:inline">Revoke</span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </ModalShell>
      )}

      <div className="space-y-4">
        {/* Stats row */}
        {adminsLoading ? (
          <StatBarSkeleton segments={5} />
        ) : (
          <StatBar
            items={[
              {
                label: "Total Staff",
                value: activeAdmins.length,
                icon: Users,
                tone: "primary",
                onClick: () => handleStatusFilter("all"),
                active: statusFilter === "all",
              },
              {
                label: "Active Now",
                value: activeNow,
                icon: Zap,
                tone: "success",
                onClick: () => handleStatusFilter("active"),
                active: statusFilter === "active",
              },
              {
                label: "Recently Active",
                value: recentlyActive,
                icon: Clock,
                tone: "muted",
                onClick: () => handleStatusFilter("recent"),
                active: statusFilter === "recent",
              },
              {
                label: "Offline",
                value: offline,
                icon: CircleOff,
                tone: "muted",
                onClick: () => handleStatusFilter("offline"),
                active: statusFilter === "offline",
              },
              {
                label: "2FA Enabled",
                value: with2FA,
                icon: ShieldCheck,
                tone: "success",
              },
            ]}
          />
        )}

        {/* Staff table */}
        <Card className="border-border/50 bg-card/50 overflow-hidden">
          <AdminPanelHeader
            icon={Shield}
            title="Staff Directory"
            subtitle="All staff members and their current activity"
            status={
              <>
                <Badge
                  variant="secondary"
                  className="text-[11px] font-medium h-5 px-2 tabular-nums"
                >
                  {activeAdmins.length}
                </Badge>
                {/* Outstanding invites were only visible inside the invite
                    modal, below the send form. An invite is a live grant of a
                    staff role, so its count belongs on the directory header,
                    and it opens the modal that manages them. */}
                {pendingInvites.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setInviteOpen(true)}
                    aria-label={
                      expiredInvites > 0
                        ? `${expiredInvites} staff invites expired unaccepted, open pending invites`
                        : `${pendingInvites.length} staff invites pending, open pending invites`
                    }
                    className="rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <StatusPill
                      tone={expiredInvites > 0 ? "crit" : "warn"}
                      icon={Mail}
                    >
                      {expiredInvites > 0
                        ? `${expiredInvites} expired`
                        : `${pendingInvites.length} pending`}
                    </StatusPill>
                  </button>
                )}
              </>
            }
            actions={
              <>
                <Button
                  size="sm"
                  className="h-9 px-3 gap-2"
                  onClick={() => setInviteOpen(true)}
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Invite staff</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 gap-2 border-border/40"
                  onClick={fetchActiveAdmins}
                  aria-label="Refresh staff list"
                >
                  <RefreshCw
                    className={cn("h-4 w-4", adminsLoading && "animate-spin")}
                    aria-hidden="true"
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
              </>
            }
          />
          <CardContent className="p-0">
            {adminsLoading ? (
              <div className="p-4 sm:p-5">
                <DataTableSkeleton rows={6} />
              </div>
            ) : activeAdmins.length === 0 ? (
              <EmptyState
                icon={Shield}
                title="No staff members found"
                description="Staff will appear here once assigned."
              />
            ) : filteredAdmins.length === 0 ? (
              <EmptyState
                icon={Shield}
                title="No staff match this filter"
                description="Try a different status filter."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => handleStatusFilter("all")}
                  >
                    Clear filter
                  </Button>
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
                            Staff Member
                          </TableHead>
                          <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Status
                          </TableHead>
                          <TableHead className="px-4 h-10">
                            <SortableHeader
                              label="Activity"
                              active={sortColumn === "total_actions"}
                              direction={
                                sortColumn === "total_actions"
                                  ? sortDirection
                                  : null
                              }
                              onClick={() => handleSort("total_actions")}
                            />
                          </TableHead>
                          <TableHead className="px-4 h-10">
                            <SortableHeader
                              label="Admin Since"
                              active={sortColumn === "created_at"}
                              direction={
                                sortColumn === "created_at"
                                  ? sortDirection
                                  : null
                              }
                              onClick={() => handleSort("created_at")}
                            />
                          </TableHead>
                          <TableHead className="px-5 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedStaff.map((admin) => {
                          const { isActive, presence, statusDisplay } =
                            getStatusInfo(admin);
                          const displayName =
                            admin.name || admin.email.split("@")[0];
                          return (
                            /* a11y (SC 2.1.1): row click was the only route to
                               a staff member's detail panel and a <tr> is not
                               keyboard reachable. See the note on the same
                               fix in components/admin/users/users-tab.tsx. */
                            <TableRow
                              key={admin.id}
                              tabIndex={0}
                              className="border-border/40 cursor-pointer group focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                              onClick={() => setSelectedAdmin(admin)}
                              onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedAdmin(admin);
                                }
                              }}
                            >
                              <TableCell className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="relative shrink-0">
                                    <UserAvatar
                                      name={admin.name}
                                      email={admin.email}
                                      avatarUrl={admin.avatar_url}
                                    />
                                    <div
                                      aria-hidden="true"
                                      className={cn(
                                        "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                                        PRESENCE_DOT[presence],
                                      )}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-medium truncate">
                                        {displayName}
                                      </p>
                                      <Badge
                                        className={cn(
                                          "text-[10px] px-1.5 py-0 font-medium",
                                          ROLE_BADGE_STYLES[admin.role] ||
                                            ROLE_BADGE_STYLES.user,
                                        )}
                                      >
                                        {STAFF_ROLE_LABELS[admin.role] ||
                                          admin.role}
                                      </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate font-mono">
                                      {admin.email}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-4">
                                <div className="flex flex-col gap-1">
                                  <Badge
                                    className={cn(
                                      "text-[10px] px-2 py-0.5 font-medium flex items-center gap-1 w-fit",
                                      PRESENCE_BADGE[presence],
                                    )}
                                  >
                                    <Dot
                                      className="h-2 w-2 fill-current"
                                      aria-hidden="true"
                                    />
                                    {statusDisplay}
                                  </Badge>
                                  {isActive && admin.current_section && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                      <Monitor
                                        className="h-3 w-3"
                                        aria-hidden="true"
                                      />
                                      {admin.current_section}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              {/* Three counts, three jobs. They used to run
                                  together as one grey sentence at one size, so
                                  "412 actions / 3 today, 1 recent" read as
                                  prose rather than as numbers you compare down
                                  the column. */}
                              <TableCell className="px-4 py-4">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-sm font-medium tabular-nums text-foreground">
                                    {admin.total_actions}{" "}
                                    <span className="text-xs text-muted-foreground font-normal">
                                      total
                                    </span>
                                  </span>
                                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <span>
                                      <span className="font-medium tabular-nums text-foreground">
                                        {admin.actions_24h}
                                      </span>{" "}
                                      today
                                    </span>
                                    {admin.recent_actions ? (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span>
                                          <span className="font-medium tabular-nums text-foreground">
                                            {admin.recent_actions}
                                          </span>{" "}
                                          recent
                                        </span>
                                      </>
                                    ) : null}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap tabular-nums">
                                {new Date(admin.created_at).toLocaleDateString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  },
                                )}
                              </TableCell>
                              <TableCell className="px-5 py-4">
                                <div className="flex items-center justify-end">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedAdmin(admin);
                                    }}
                                    aria-label={`View details for ${displayName}`}
                                  >
                                    <Eye
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                    />
                                    <span className="text-xs">View</span>
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
                <div className="md:hidden flex flex-col">
                  {pagedStaff.map((admin) => {
                    const { presence, statusDisplay } = getStatusInfo(admin);
                    const displayName = admin.name || admin.email.split("@")[0];
                    return (
                      <button
                        key={admin.id}
                        type="button"
                        onClick={() => setSelectedAdmin(admin)}
                        aria-label={`View details for ${displayName}, ${statusDisplay}`}
                        className="flex items-center gap-3 px-5 py-4 border-b border-border/40 last:border-0 hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset transition-colors text-left w-full"
                      >
                        <div className="relative shrink-0">
                          <UserAvatar
                            name={admin.name}
                            email={admin.email}
                            size="sm"
                            avatarUrl={admin.avatar_url}
                          />
                          <div
                            aria-hidden="true"
                            className={cn(
                              "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                              PRESENCE_DOT[presence],
                            )}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-medium truncate">
                              {displayName}
                            </p>
                            <Badge
                              className={cn(
                                ROLE_BADGE_STYLES[admin.role],
                                "text-[10px] px-1.5 shrink-0",
                              )}
                            >
                              {STAFF_ROLE_LABELS[admin.role] || admin.role}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate font-mono">
                            {admin.email}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <Badge
                              className={cn(
                                "text-[10px] px-1.5 py-0 font-medium flex items-center gap-1",
                                PRESENCE_BADGE[presence],
                              )}
                            >
                              <Dot
                                className="h-2 w-2 fill-current"
                                aria-hidden="true"
                              />
                              {statusDisplay}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">
                              <span className="font-medium tabular-nums text-foreground">
                                {admin.total_actions}
                              </span>{" "}
                              actions
                            </span>
                          </div>
                        </div>
                        <Eye
                          className="h-4 w-4 text-muted-foreground/50 shrink-0"
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="px-5 py-4 border-t border-border/40 bg-muted/20">
                    <PaginationControl
                      currentPage={staffPage}
                      totalPages={totalPages}
                      onPageChange={setStaffPage}
                      pageSize={staffPageSize}
                      onPageSizeChange={(s) => {
                        setStaffPageSize(s);
                        setStaffPage(1);
                      }}
                      totalItems={sortedAdmins.length}
                    />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <AdminPasswordConfirmDialog
        open={invitePasswordOpen}
        onOpenChange={setInvitePasswordOpen}
        title="Send staff invite"
        description={`This emails ${inviteEmail.trim() || "this address"} a link that grants the ${
          STAFF_ROLE_LABELS[inviteRole] || inviteRole
        } role. Re-enter your password to confirm.`}
        confirmLabel="Send invite"
        onConfirm={handleSendInvite}
      />
    </>
  );
}
