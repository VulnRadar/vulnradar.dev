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
  X,
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  type SortDirection,
} from "@/components/admin/shared";
import { useModalA11y } from "@/lib/hooks/use-modal-a11y";
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  type StaffRole,
} from "@/lib/config/constants";
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

  // Load the pending list whenever the modal opens, so it reflects invites
  // sent from another admin's session too, not just this tab's own sends.
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

  async function handleSendInvite() {
    setInviteError("");
    setInviteSuccess("");
    if (!inviteEmail.trim()) {
      setInviteError("Enter an email address.");
      return;
    }
    setInviting(true);
    try {
      const res = await fetch("/api/v3/admin/staff-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error || "Failed to send invite.");
        return;
      }
      setInviteSuccess(`Invite sent to ${inviteEmail.trim()}.`);
      setInviteEmail("");
      // Reflect the just-created invite in the pending list right away.
      fetchPendingInvites();
    } catch {
      setInviteError("Something went wrong. Please try again.");
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
    const statusDisplay = isActive
      ? "Active Now"
      : isRecentlyActive
        ? "Recently Active"
        : "Offline";
    return { isActive, isRecentlyActive, statusDisplay };
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

  const {
    dialogProps: staffDialogProps,
    titleProps: staffTitleProps,
    descriptionProps: staffDescriptionProps,
  } = useModalA11y({
    open: !!selectedAdmin,
    onClose: () => setSelectedAdmin(null),
  });

  const {
    dialogProps: inviteDialogProps,
    titleProps: inviteTitleProps,
    descriptionProps: inviteDescriptionProps,
  } = useModalA11y({
    open: inviteOpen,
    onClose: closeInviteModal,
    hasDescription: true,
  });

  return (
    <>
      {/* Staff detail modal */}
      {selectedAdmin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
          onClick={() => setSelectedAdmin(null)}
        >
          <div
            className="bg-card border border-border rounded-xl w-full max-w-2xl mx-4 shadow-2xl max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
            {...staffDialogProps}
          >
            {/* Modal header */}
            <div className="p-6 border-b border-border/50">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <UserAvatar
                      name={selectedAdmin.name}
                      email={selectedAdmin.email}
                      avatarUrl={selectedAdmin.avatar_url}
                      size="lg"
                    />
                    {(() => {
                      const { isActive, isRecentlyActive } =
                        getStatusInfo(selectedAdmin);
                      return (
                        <div
                          aria-hidden="true"
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-card",
                            isActive
                              ? "bg-primary animate-pulse"
                              : isRecentlyActive
                                ? "bg-[hsl(var(--success))]"
                                : "bg-muted-foreground/40",
                          )}
                        />
                      );
                    })()}
                  </div>
                  <div>
                    <h3
                      className="text-lg font-semibold text-foreground"
                      {...staffTitleProps}
                    >
                      {selectedAdmin.name || selectedAdmin.email.split("@")[0]}
                    </h3>
                    <p
                      className="text-sm text-muted-foreground font-mono"
                      {...staffDescriptionProps}
                    >
                      {selectedAdmin.email}
                    </p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge
                        className={cn(
                          "text-[10px] px-2 py-0.5 font-medium",
                          ROLE_BADGE_STYLES[selectedAdmin.role] ||
                            ROLE_BADGE_STYLES.user,
                        )}
                      >
                        {STAFF_ROLE_LABELS[selectedAdmin.role] ||
                          selectedAdmin.role}
                      </Badge>
                      {(() => {
                        const { isActive, isRecentlyActive, statusDisplay } =
                          getStatusInfo(selectedAdmin);
                        return (
                          <Badge
                            className={cn(
                              "text-[10px] px-2 py-0.5 font-medium flex items-center gap-1",
                              isActive
                                ? "bg-accent text-accent-foreground border-accent/30"
                                : isRecentlyActive
                                  ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20"
                                  : "bg-muted text-muted-foreground border-border",
                            )}
                          >
                            <Dot
                              className="h-2 w-2 fill-current"
                              aria-hidden="true"
                            />
                            {statusDisplay}
                          </Badge>
                        );
                      })()}
                      {selectedAdmin.totp_enabled && (
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-2 py-0.5 font-medium">
                          2FA
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedAdmin(null)}
                  className="p-2 rounded-lg hover:bg-muted transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Modal content */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Quick stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50 flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Monitor
                      className="h-4 w-4 text-primary"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl font-bold leading-tight">
                      {selectedAdmin.active_sessions}
                    </p>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                      Sessions
                    </span>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50 flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                    <Activity
                      className="h-4 w-4 text-purple-500"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl font-bold leading-tight">
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
                    <p className="text-xl font-bold leading-tight">
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
                    <p className="text-xl font-bold leading-tight">
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
                        <p className="text-sm font-mono">{selectedAdmin.id}</p>
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
                          {new Date(
                            selectedAdmin.created_at,
                          ).toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
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
                        <p className="text-sm">
                          {selectedAdmin.totp_enabled
                            ? "Enabled"
                            : "Not enabled"}
                        </p>
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
                          <p className="text-sm font-mono">
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
                            <p className="text-sm">
                              {selectedAdmin.seconds_since_heartbeat < 60
                                ? "Just now"
                                : `${Math.floor(selectedAdmin.seconds_since_heartbeat / 60)} minutes ago`}
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
                      <ActionBadge
                        action={selectedAdmin.last_action_type || ""}
                      />
                      <span className="text-sm text-muted-foreground">
                        {new Date(
                          selectedAdmin.last_admin_action,
                        ).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Invite staff modal */}
      {inviteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
          onClick={closeInviteModal}
        >
          <div
            className="bg-card border border-border rounded-xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            {...inviteDialogProps}
          >
            <div className="p-6 border-b border-border/50 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3
                  className="text-lg font-semibold text-foreground"
                  {...inviteTitleProps}
                >
                  Invite staff
                </h3>
                <p
                  className="text-sm text-muted-foreground mt-0.5"
                  {...inviteDescriptionProps}
                >
                  We email them a link to accept. No prior account needed.
                </p>
              </div>
              <button
                onClick={closeInviteModal}
                className="p-2 rounded-lg hover:bg-muted transition-colors shrink-0"
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6 space-y-4">
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
                  onKeyDown={(e) => e.key === "Enter" && handleSendInvite()}
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

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeInviteModal}>
                  Close
                </Button>
                <Button
                  onClick={handleSendInvite}
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
                      className="text-[11px] font-medium h-5 px-2"
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
                    {pendingInvites.map((invite) => (
                      <li
                        key={invite.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {invite.email}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span>
                              {STAFF_ROLE_LABELS[invite.role] || invite.role}
                            </span>
                            <span aria-hidden="true">·</span>
                            <Calendar
                              className="h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                            <span>
                              expires{" "}
                              {new Date(
                                invite.expires_at,
                              ).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </span>
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 shrink-0 text-destructive hover:text-destructive"
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
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
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
          <CardHeader className="pb-4 pt-5 px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <Shield className="h-4 w-4 text-primary" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base font-semibold">
                      Staff Directory
                    </CardTitle>
                    <Badge
                      variant="secondary"
                      className="text-[11px] font-medium h-5 px-2"
                    >
                      {activeAdmins.length}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    All staff members and their current activity
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setInviteOpen(true)}
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Invite staff</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 border-border/40"
                  onClick={fetchActiveAdmins}
                  aria-label="Refresh staff list"
                >
                  <RefreshCw
                    className={cn("h-4 w-4", adminsLoading && "animate-spin")}
                    aria-hidden="true"
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
              </div>
            </div>
          </CardHeader>
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
                          const { isActive, isRecentlyActive, statusDisplay } =
                            getStatusInfo(admin);
                          const displayName =
                            admin.name || admin.email.split("@")[0];
                          return (
                            <TableRow
                              key={admin.id}
                              className="border-border/40 cursor-pointer group"
                              onClick={() => setSelectedAdmin(admin)}
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
                                        isActive
                                          ? "bg-primary animate-pulse"
                                          : isRecentlyActive
                                            ? "bg-[hsl(var(--success))]"
                                            : "bg-muted-foreground/40",
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
                                      isActive
                                        ? "bg-accent text-accent-foreground border-accent/30"
                                        : isRecentlyActive
                                          ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20"
                                          : "bg-muted text-muted-foreground border-border",
                                    )}
                                  >
                                    <Dot
                                      className="h-2 w-2 fill-current"
                                      aria-hidden="true"
                                    />
                                    {statusDisplay}
                                  </Badge>
                                  {isActive && admin.current_section && (
                                    <span className="text-[10px] text-accent-foreground flex items-center gap-1">
                                      <Monitor
                                        className="h-3 w-3"
                                        aria-hidden="true"
                                      />
                                      {admin.current_section}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-4">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-sm font-medium">
                                    {admin.total_actions}{" "}
                                    <span className="text-muted-foreground font-normal">
                                      actions
                                    </span>
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {admin.actions_24h} today
                                    {admin.recent_actions
                                      ? `, ${admin.recent_actions} recent`
                                      : ""}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap">
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
                    const { isActive, isRecentlyActive, statusDisplay } =
                      getStatusInfo(admin);
                    const displayName = admin.name || admin.email.split("@")[0];
                    return (
                      <button
                        key={admin.id}
                        type="button"
                        onClick={() => setSelectedAdmin(admin)}
                        aria-label={`View details for ${displayName}, ${statusDisplay}`}
                        className="flex items-center gap-3 px-5 py-4 border-b border-border/40 last:border-0 hover:bg-muted/20 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset transition-colors text-left w-full"
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
                              isActive
                                ? "bg-primary animate-pulse"
                                : isRecentlyActive
                                  ? "bg-[hsl(var(--success))]"
                                  : "bg-muted-foreground/40",
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
                                isActive
                                  ? "bg-accent text-accent-foreground border-accent/30"
                                  : isRecentlyActive
                                    ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20"
                                    : "bg-muted text-muted-foreground border-border",
                              )}
                            >
                              <Dot
                                className="h-2 w-2 fill-current"
                                aria-hidden="true"
                              />
                              {statusDisplay}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">
                              {admin.total_actions} actions
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
    </>
  );
}
