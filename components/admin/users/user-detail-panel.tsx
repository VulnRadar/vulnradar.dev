"use client";

import { useState, useEffect } from "react";
import {
  Key,
  ShieldCheck,
  ShieldOff,
  Trash2,
  CrownIcon,
  Loader2,
  KeyRound,
  LogOut,
  Ban,
  BotOff,
  CheckCircle2,
  ArrowLeft,
  Clock,
  AlertTriangle,
  FileText,
  RefreshCw,
  Shield,
  X,
  UserCog,
  Globe,
  Award,
  Plus,
  Tag,
  Pencil,
  Mail,
  MailCheck,
  MailX,
  User,
  CreditCard,
  CalendarOff,
  ImageOff,
  UserX,
  Gift,
  StickyNote,
  Send,
  Webhook,
  Activity,
  Save,
  Bell,
  Gauge,
  Sparkles,
} from "lucide-react";
import { FaGithub, FaDiscord } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/ui/utils";
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  STAFF_ROLE_HIERARCHY,
  ROUTES,
} from "@/lib/config/constants";
import { PLANS, getPlanById } from "@/lib/billing/catalog";
import {
  hasStaffPermission,
  hasGodMode,
  STAFF_PERMISSIONS,
} from "@/lib/auth/permissions-client";
import {
  SaveConfirmationModal,
  type ChangeItem,
  type AffectedUser,
} from "@/components/shared/save-confirmation-modal";
import type { UserDetail, BadgeDef } from "@/components/admin/types";
import { formatRelativeTime } from "@/components/admin/utils";
import { PASSWORD_GATED_ACTIONS } from "@/components/admin/config";
import {
  UserAvatar,
  ActionCard,
  AdminMobileToc,
  AdminMobileTocTrigger,
  Skeleton,
  AdminPasswordConfirmDialog,
  type AdminTocItem,
} from "@/components/admin/shared";
import { useAdminPermissions } from "@/components/admin/hooks";
import { GiftSubscriptionModal } from "./gift-subscription-modal";

interface UserDetailPanelProps {
  detail: UserDetail;
  detailLoading: boolean;
  actionLoading: string | null;
  onClose: () => void;
  onAction: (
    userId: number,
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<{
    ok: boolean;
    error?: string;
    change?: { field: string; oldValue: string; newValue: string };
  }>;
  callerRole: string;
  allBadges: BadgeDef[];
  onBadgesChanged: (awardedIds: number[], revokedIds: number[]) => void;
}

export function UserDetailPanel({
  detail,
  detailLoading,
  actionLoading,
  onClose,
  onAction,
  callerRole,
  allBadges,
  onBadgesChanged,
}: UserDetailPanelProps) {
  const u = detail.user;
  const perms = useAdminPermissions(callerRole);
  const isLoading = (action: string) => actionLoading === `${u.id}-${action}`;
  const [showBadgePicker, setShowBadgePicker] = useState(false);
  const [showCreateBadge, setShowCreateBadge] = useState(false);
  const [showManageBadges, setShowManageBadges] = useState(false);
  const [newNote, setNewNote] = useState("");
  async function addNote() {
    const result = await onAction(u.id, "add_note", { note: newNote.trim() });
    if (result.ok) setNewNote("");
  }
  const [editingNote, setEditingNote] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const [newBadgeName, setNewBadgeName] = useState("");
  const [newBadgeDisplay, setNewBadgeDisplay] = useState("");
  const [newBadgeColor, setNewBadgeColor] = useState("#6366f1");
  const [pendingDeleteBadge, setPendingDeleteBadge] = useState<BadgeDef | null>(
    null,
  );
  const [pendingDeleteNote, setPendingDeleteNote] = useState<{
    id: number;
    text: string;
  } | null>(null);

  const awardedIds = new Set(detail.badges.map((b) => b.id));
  const unawardedBadges = allBadges.filter((b) => !awardedIds.has(b.id));

  // Pending changes state - batch all changes and save together
  interface PendingAdminChanges {
    name?: string;
    email?: string;
    plan?: string;
    role?: string;
  }
  const [pendingChanges, setPendingChanges] = useState<PendingAdminChanges>({});
  const [pendingBadgeAwards, setPendingBadgeAwards] = useState<number[]>([]);
  const [pendingBadgeRevokes, setPendingBadgeRevokes] = useState<number[]>([]);
  const [accountEditMode, setAccountEditMode] = useState(false);
  const [editName, setEditName] = useState(u.name || "");
  const [editEmail, setEditEmail] = useState(u.email);
  const [editPlan, setEditPlan] = useState(u.plan || "free");
  const [editRole, setEditRole] = useState(u.role || "user");
  const [isSaving, setIsSaving] = useState(false);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [notifyUserOnSave, setNotifyUserOnSave] = useState(true);
  const [showNotifDialog, setShowNotifDialog] = useState(false);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");
  const [tocOpen, setTocOpen] = useState(false);

  // Password re-auth state. update_email/set_role (saveAllChanges) and
  // disable/reset_password/delete (support actions) are all in
  // PASSWORD_GATED_ACTIONS, so the backend rejects them with 403 unless
  // currentAdminPassword is sent. These gate the existing confirmation
  // modals with one more step instead of replacing them.
  const [showSavePasswordDialog, setShowSavePasswordDialog] = useState(false);
  const [showSupportPasswordDialog, setShowSupportPasswordDialog] =
    useState(false);
  const [supportNotify, setSupportNotify] = useState(true);

  // Support action confirmation state
  const [pendingSupportAction, setPendingSupportAction] = useState<{
    action: string;
    label: string;
    description: string;
    variant?: "default" | "destructive";
    extraPayload?: Record<string, unknown>;
  } | null>(null);

  // Track if there are unsaved changes
  const hasChanges =
    Object.keys(pendingChanges).length > 0 ||
    pendingBadgeAwards.length > 0 ||
    pendingBadgeRevokes.length > 0;

  // Validation: email cannot be empty if it's being changed
  const hasEmailError =
    pendingChanges.email !== undefined &&
    (pendingChanges.email as string).trim() === "";
  const canSave = hasChanges && !hasEmailError;

  // Build changes array for the modal
  const modalChanges: ChangeItem[] = [
    ...(pendingChanges.name !== undefined
      ? [
          {
            field: "name",
            label: "Display Name",
            oldValue: u.name || "",
            newValue: pendingChanges.name as string,
          },
        ]
      : []),
    ...(pendingChanges.email !== undefined
      ? [
          {
            field: "email",
            label: "Email Address",
            oldValue: u.email,
            newValue: pendingChanges.email as string,
          },
        ]
      : []),
    ...(pendingChanges.plan !== undefined
      ? [
          {
            field: "plan",
            label: "Subscription Plan",
            oldValue: u.plan || "free",
            newValue: pendingChanges.plan as string,
          },
        ]
      : []),
    ...(pendingChanges.role !== undefined
      ? [
          {
            field: "role",
            label: "Staff Role",
            oldValue: u.role || "user",
            newValue: pendingChanges.role as string,
          },
        ]
      : []),
    ...(pendingBadgeAwards.length > 0
      ? [
          {
            field: "badges",
            label: "Badges to Award",
            oldValue: "",
            newValue: `+${pendingBadgeAwards.length} badge${pendingBadgeAwards.length !== 1 ? "s" : ""}`,
          },
        ]
      : []),
    ...(pendingBadgeRevokes.length > 0
      ? [
          {
            field: "badges",
            label: "Badges to Remove",
            oldValue: `${pendingBadgeRevokes.length} badge${pendingBadgeRevokes.length !== 1 ? "s" : ""}`,
            newValue: "",
          },
        ]
      : []),
  ];

  const affectedUser: AffectedUser = {
    id: u.id,
    email: u.email,
    name: u.name || undefined,
  };

  // Reset pending changes when user changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets local edit-buffer state to match a new u.id identity (switching which user is being viewed), gated on the dependency array so it only fires on an actual prop change, not every render
    setPendingChanges({});
    setPendingBadgeAwards([]);
    setPendingBadgeRevokes([]);
    setEditName(u.name || "");
    setEditEmail(u.email);
    setEditPlan(u.plan || "free");
    setEditRole(u.role || "user");
  }, [u.id, u.name, u.email, u.plan, u.role]);

  // Add a change to pending
  const addPendingChange = (
    key: keyof PendingAdminChanges,
    value: string,
    originalValue: unknown,
  ) => {
    if (value === originalValue) {
      setPendingChanges((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      setPendingChanges((prev) => ({ ...prev, [key]: value }));
    }
  };

  // Queue a support action for confirmation. Decides which dialog to show
  // up front, not mid-flow: password-gated actions go straight to
  // AdminPasswordConfirmDialog, skipping SaveConfirmationModal entirely.
  //
  // This used to always open SaveConfirmationModal first, and for a gated
  // action, its own onConfirm would set showSupportPasswordDialog(true)
  // and return -- but SaveConfirmationModal's handleConfirm has no way to
  // know that "return" meant "we switched to a different dialog" instead
  // of "the action is done". It always follows a resolved onConfirm with
  // setSuccess(true) and a 1.5s setTimeout(() => { ...; onClose(); }).
  // That timeout kept running in the background even though the modal was
  // already hidden (isOpen recomputes to false, but the component stays
  // mounted) -- 1.5s later it fired onClose(), which called
  // setPendingSupportAction(null) out from under the ALREADY-OPEN password
  // dialog, which reads its own title/description from that exact state.
  // The result: the password dialog would visibly degrade from
  // "Delete Account" (specific) to generic "Confirm Action" text mid-flow,
  // and if the admin hadn't submitted yet, executeSupportAction's
  // `if (!pendingSupportAction) return { ok: true }` guard made the next
  // Confirm click silently no-op -- reporting success without ever
  // calling the API. Skipping the redundant first dialog for gated
  // actions removes the stale-timeout race entirely, not just the visible
  // symptom.
  const queueSupportAction = (
    action: string,
    label: string,
    description: string,
    variant?: "default" | "destructive",
    extraPayload?: Record<string, unknown>,
  ) => {
    setPendingSupportAction({
      action,
      label,
      description,
      variant,
      extraPayload,
    });
    if (PASSWORD_GATED_ACTIONS.has(action)) {
      setSupportNotify(true);
      setShowSupportPasswordDialog(true);
    }
  };

  // Execute the pending support action. `password` is only sent when the
  // action is in PASSWORD_GATED_ACTIONS (see queueSupportAction's caller
  // in the support-action confirmation modal below).
  const executeSupportAction = async (
    notifyUser: boolean,
    password?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!pendingSupportAction) return { ok: true };
    const result = await onAction(u.id, pendingSupportAction.action, {
      ...pendingSupportAction.extraPayload,
      notifyUser,
      ...(password ? { currentAdminPassword: password } : {}),
    });
    if (result.ok) {
      if (pendingSupportAction.action === "impersonate") {
        // The browser's session cookie now points at the target user's
        // session (see lib/auth/impersonation.ts) -- a full reload, not
        // just clearing local state, so every already-cached piece of
        // page state for the admin's own identity is gone and the
        // dashboard loads fresh as the impersonated user.
        window.location.href = ROUTES.DASHBOARD;
        return result;
      }
      setPendingSupportAction(null);
    }
    return result;
  };

  // Save all pending changes. `password` is only sent when the batch
  // includes a gated field (email/role) - see the Save Changes modal below.
  //
  // name/plan/role/badge changes are individually notifyUser:false here --
  // each still applies its own DB write and audit log entry, but the
  // per-field email is suppressed. Their `change` descriptors are collected
  // into changesForEmail and sent as ONE consolidated email at the end via
  // "notify_account_changes", instead of the user getting a separate email
  // for every field touched in a single Save (e.g. 4 emails for a save that
  // changed role + 3 badges). update_email is deliberately excluded from
  // batching: it always sends its own immediate dual notification (old +
  // new address) for account-security reasons.
  const saveAllChanges = async (
    password?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    setIsSaving(true);
    const pw = password ? { currentAdminPassword: password } : {};
    const changesForEmail: {
      field: string;
      oldValue: string;
      newValue: string;
    }[] = [];
    try {
      for (const [key, value] of Object.entries(pendingChanges)) {
        let result:
          | {
              ok: boolean;
              error?: string;
              change?: (typeof changesForEmail)[number];
            }
          | undefined;
        if (key === "name")
          result = await onAction(u.id, "update_name", {
            name: value as string,
            notifyUser: false,
          });
        else if (key === "email")
          result = await onAction(u.id, "update_email", {
            email: value as string,
            notifyUser: notifyUserOnSave,
            ...pw,
          });
        else if (key === "plan")
          result = await onAction(u.id, "update_plan", {
            plan: value as string,
            notifyUser: false,
          });
        else if (key === "role")
          result = await onAction(u.id, "set_role", {
            role: value as string,
            notifyUser: false,
            ...pw,
          });
        if (result && !result.ok) return result;
        if (result?.change && key !== "email")
          changesForEmail.push(result.change);
      }
      const awardedThisSave = [...pendingBadgeAwards];
      const revokedThisSave = [...pendingBadgeRevokes];
      if (awardedThisSave.length > 0 || revokedThisSave.length > 0) {
        const badgeResults = await Promise.all([
          ...awardedThisSave.map((id) =>
            onAction(u.id, "award_badge", {
              badgeId: String(id),
              notifyUser: false,
            }),
          ),
          ...revokedThisSave.map((id) =>
            onAction(u.id, "revoke_badge", {
              badgeId: String(id),
              notifyUser: false,
            }),
          ),
        ]);
        for (const r of badgeResults)
          if (r.change) changesForEmail.push(r.change);
        onBadgesChanged(awardedThisSave, revokedThisSave);
      }
      if (notifyUserOnSave && changesForEmail.length > 0) {
        await onAction(u.id, "notify_account_changes", {
          changes: changesForEmail,
          notifyUser: true,
        });
      }
      setPendingChanges({});
      setPendingBadgeAwards([]);
      setPendingBadgeRevokes([]);
      return { ok: true };
    } finally {
      setIsSaving(false);
    }
  };

  // Discard all changes
  const discardChanges = () => {
    setPendingChanges({});
    setPendingBadgeAwards([]);
    setPendingBadgeRevokes([]);
    setEditName(u.name || "");
    setEditEmail(u.email);
    setEditPlan(u.plan || "free");
    setEditRole(u.role || "user");
  };

  // Handle save button click - open confirmation modal. Decided up front
  // (same reasoning as queueSupportAction above) rather than switching
  // dialogs mid-flow inside SaveConfirmationModal's onConfirm: a batch
  // touching email or role is password-gated server-side, so it skips the
  // plain "confirm changes" step and goes straight to the password
  // dialog.
  const handleSaveClick = () => {
    if (
      pendingChanges.email !== undefined ||
      pendingChanges.role !== undefined
    ) {
      setShowSavePasswordDialog(true);
    } else {
      setShowSaveModal(true);
    }
  };

  // "On this page" jump list: only offer entries whose section actually
  // renders for this caller's permissions, so a support-role viewer never
  // sees a link to a card they can't see below.
  const tocItems: AdminTocItem[] = [
    { id: "profile-overview", label: "Overview" },
    ...(perms.canBanUsers
      ? [{ id: "account-management", label: "Account Management" }]
      : []),
    ...(perms.canDeleteUsers
      ? [{ id: "roles-badges", label: "Staff Role & Badges" }]
      : []),
    { id: "admin-notes", label: "Admin Notes" },
    { id: "support-actions", label: "Support Actions" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Back + header card */}
      <Card
        id="profile-overview"
        className="border-border/50 bg-card/50 overflow-hidden"
      >
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0 -ml-1 -mt-0.5 border-border/60 bg-muted/40"
              onClick={onClose}
              aria-label="Back to user list"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <UserAvatar
              name={u.name}
              email={u.email}
              avatarUrl={u.avatar_url}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold tracking-tight">
                  {u.name || "Unnamed User"}
                </h2>
                {u.role && u.role !== "user" && ROLE_BADGE_STYLES[u.role] && (
                  <Badge
                    className={cn(
                      ROLE_BADGE_STYLES[u.role],
                      "text-[10px] font-medium",
                    )}
                  >
                    {STAFF_ROLE_LABELS[u.role] || u.role}
                  </Badge>
                )}
                {u.disabled_at && (
                  <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] font-medium">
                    Disabled
                  </Badge>
                )}
                {u.ai_chat_banned && (
                  <Badge className="bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20 text-[10px] font-medium">
                    AI banned
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5 font-mono">
                {u.email}
              </p>
            </div>
          </div>

          {detailLoading ? (
            <div
              role="status"
              aria-live="polite"
              aria-label="Loading user details"
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-card/30"
                  >
                    <Skeleton className="h-7 w-7 rounded-lg shrink-0" />
                    <div className="min-w-0 space-y-1.5">
                      <Skeleton className="h-2.5 w-10" />
                      <Skeleton className="h-3.5 w-12" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-border/50">
                <Skeleton className="h-2.5 w-16 mb-2.5" />
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-6 w-24 rounded-full" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Quick stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                {[
                  {
                    label: "Scans",
                    value: u.scan_count,
                    icon: Activity,
                    color: "text-primary",
                    bg: "bg-primary/10",
                  },
                  {
                    label: "API Keys",
                    value: u.api_key_count,
                    icon: Key,
                    color: "text-[hsl(var(--severity-medium))]",
                    bg: "bg-[hsl(var(--severity-medium))]/10",
                  },
                  {
                    label: "Sessions",
                    value: String(u.session_count),
                    icon: Globe,
                    color: "text-[hsl(var(--success))]",
                    bg: "bg-[hsl(var(--success))]/10",
                  },
                  {
                    label: "Joined",
                    value: new Date(u.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }),
                    icon: Clock,
                    color: "text-muted-foreground",
                    bg: "bg-muted/50",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-card/30"
                  >
                    <div className={cn("p-1.5 rounded-lg shrink-0", item.bg)}>
                      <item.icon
                        className={cn("h-3.5 w-3.5", item.color)}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        {item.label}
                      </p>
                      <p className="text-sm font-semibold truncate">
                        {item.value}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Security status */}
              <div className="mt-4 pt-4 border-t border-border/50">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2.5">
                  Security
                </p>
                <div className="flex flex-wrap gap-2">
                  <div
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border",
                      u.totp_enabled
                        ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-500"
                        : "bg-muted/50 border-border/50 text-muted-foreground",
                    )}
                  >
                    {u.totp_enabled ? (
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <ShieldOff className="h-3 w-3" aria-hidden="true" />
                    )}
                    {u.totp_enabled ? "2FA Enabled" : "No 2FA"}
                  </div>
                  {u.totp_enabled && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/50 border border-border/50 text-muted-foreground">
                      <KeyRound className="h-3 w-3" aria-hidden="true" />
                      {u.has_backup_codes
                        ? "Has backup codes"
                        : "No backup codes"}
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border",
                      u.email_verified_at
                        ? "bg-muted/50 border-border/50 text-muted-foreground"
                        : "bg-[hsl(var(--severity-high))]/5 border-[hsl(var(--severity-high))]/20 text-[hsl(var(--severity-high))]",
                    )}
                  >
                    {u.email_verified_at ? (
                      <MailCheck className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <MailX className="h-3 w-3" aria-hidden="true" />
                    )}
                    {u.email_verified_at
                      ? "Email Verified"
                      : "Email Unverified"}
                  </div>
                  <div
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border",
                      u.tos_accepted_at
                        ? "bg-muted/50 border-border/50 text-muted-foreground"
                        : "bg-[hsl(var(--severity-medium))]/5 border-[hsl(var(--severity-medium))]/20 text-[hsl(var(--severity-medium))]",
                    )}
                  >
                    <FileText className="h-3 w-3" aria-hidden="true" />
                    {u.tos_accepted_at ? "TOS Accepted" : "TOS Not Accepted"}
                  </div>
                </div>
              </div>

              {/* Connected accounts */}
              <div className="mt-4 pt-4 border-t border-border/50">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2.5">
                  Connected Accounts
                </p>
                <div className="flex flex-wrap gap-2">
                  {u.google_id ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/50 border border-border/50">
                      <FcGoogle className="h-3 w-3" aria-hidden="true" />
                      {u.google_email ?? u.google_name ?? "Google linked"}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/50 border border-border/50 text-muted-foreground">
                      <FcGoogle className="h-3 w-3" aria-hidden="true" />
                      No Google sign-in
                    </div>
                  )}
                  {u.github_id ? (
                    u.github_login ? (
                      // Real @handle captured at sign-in: link straight to the
                      // profile. github.com/<login> resolves; the display name
                      // does not, which is why it was never linkable before.
                      <a
                        href={`https://github.com/${u.github_login}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-foreground/10 border border-foreground/25 hover:bg-foreground/20 hover:underline transition-colors"
                      >
                        <FaGithub className="h-3 w-3" aria-hidden="true" />@
                        {u.github_login}
                        {u.github_name && (
                          <span className="opacity-70">({u.github_name})</span>
                        )}
                      </a>
                    ) : (
                      // Row predates the github_login column: show the display
                      // name plus the numeric id (resolvable via
                      // api.github.com/user/<id>). Never a github.com/<name>
                      // link, which 404s for most display names.
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-foreground/10 border border-foreground/25">
                        <FaGithub className="h-3 w-3" aria-hidden="true" />
                        {u.github_name ?? u.github_email ?? "GitHub sign-in"}
                        <span className="opacity-70">
                          &middot; id {u.github_id}
                        </span>
                      </div>
                    )
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/50 border border-border/50 text-muted-foreground">
                      <FaGithub className="h-3 w-3" aria-hidden="true" />
                      No GitHub sign-in
                    </div>
                  )}
                  {detail.githubRepoConnection ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-foreground/10 border border-foreground/25">
                      <FaGithub className="h-3 w-3" aria-hidden="true" />
                      {detail.githubRepoConnection.github_username}
                      <span className="opacity-70">&middot; repo access</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/50 border border-border/50 text-muted-foreground">
                      <FaGithub className="h-3 w-3" aria-hidden="true" />
                      No repo connected
                    </div>
                  )}
                  {detail.discordConnection ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#5865F2]/10 border border-[#5865F2]/25 text-[#5865F2]">
                      <FaDiscord className="h-3 w-3" aria-hidden="true" />
                      {detail.discordConnection.discord_username}
                      {detail.discordConnection.guild_joined && (
                        <span className="opacity-70">&middot; in server</span>
                      )}
                    </div>
                  ) : u.discord_id ? (
                    // Discord SIGN-IN with no discord_connections row: created
                    // by "Sign in with Discord" (users.discord_id set) without
                    // ever going through the server-join connect flow. Mirrors
                    // the google_id / github_id sign-in chips above so a
                    // Discord-signup account no longer reads as unlinked.
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#5865F2]/10 border border-[#5865F2]/25 text-[#5865F2]">
                      <FaDiscord className="h-3 w-3" aria-hidden="true" />
                      {u.discord_username ??
                        u.discord_email ??
                        "Discord sign-in"}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/50 border border-border/50 text-muted-foreground">
                      <FaDiscord className="h-3 w-3" aria-hidden="true" />
                      No Discord linked
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Account Management - admin/mod can edit */}
      {!detailLoading && perms.canBanUsers && (
        <Card id="account-management" className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCog className="h-4 w-4 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium">Account Management</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => {
                  if (accountEditMode) {
                    setEditName(u.name || "");
                    setEditEmail(u.email || "");
                    setEditPlan(u.plan || "free");
                    setPendingChanges((prev) => {
                      const next = { ...prev };
                      delete next.name;
                      delete next.email;
                      delete next.plan;
                      return next;
                    });
                  }
                  setAccountEditMode((m) => !m);
                }}
              >
                {accountEditMode ? (
                  <>
                    <X className="h-3 w-3" aria-hidden="true" />
                    Cancel
                  </>
                ) : (
                  <>
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    Edit
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {!accountEditMode ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1 p-3 rounded-lg border border-border/40 bg-card/30">
                  <div className="flex items-center gap-2 mb-1">
                    <User
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      Display Name
                    </span>
                  </div>
                  <span className="text-sm font-medium truncate">
                    {u.name || (
                      <span className="text-muted-foreground italic">
                        Not set
                      </span>
                    )}
                  </span>
                </div>
                {perms.canManageStaff && (
                  <div className="flex flex-col gap-1 p-3 rounded-lg border border-border/40 bg-card/30">
                    <div className="flex items-center gap-2 mb-1">
                      <Mail
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">
                        Email Address
                      </span>
                    </div>
                    <span className="text-sm font-medium truncate font-mono">
                      {u.email}
                    </span>
                  </div>
                )}
                {perms.canManageStaff && (
                  <div className="flex flex-col gap-1 p-3 rounded-lg border border-border/40 bg-card/30">
                    <div className="flex items-center gap-2 mb-1">
                      <CreditCard
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">
                        Subscription Plan
                      </span>
                    </div>
                    <span className="text-xs font-medium text-foreground flex items-center gap-2">
                      {(() => {
                        const effectivePlan = u.gifted_plan || u.plan;
                        const label = effectivePlan
                          ? getPlanById(effectivePlan)?.name || effectivePlan
                          : "Free";
                        return (
                          <>
                            {label}
                            {u.gifted_plan && (
                              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                Gifted
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Edit Name */}
                  <div
                    className={cn(
                      "flex flex-col gap-2 p-3 rounded-lg border transition-colors",
                      pendingChanges.name
                        ? "bg-primary/5 border-primary/30"
                        : "bg-card/30 border-border/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <User
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">
                        Display Name
                      </span>
                      {pendingChanges.name && (
                        <span className="text-[9px] text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10">
                          Modified
                        </span>
                      )}
                    </div>
                    <Input
                      value={editName}
                      onChange={(e) => {
                        setEditName(e.target.value);
                        addPendingChange(
                          "name",
                          e.target.value.trim(),
                          u.name || "",
                        );
                      }}
                      placeholder="Enter name"
                      className="h-8 text-xs"
                    />
                  </div>

                  {/* Edit Email - admin only */}
                  {perms.canManageStaff && (
                    <div
                      className={cn(
                        "flex flex-col gap-2 p-3 rounded-lg border transition-colors",
                        pendingChanges.email
                          ? "bg-primary/5 border-primary/30"
                          : "bg-card/30 border-border/40",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Mail
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">
                          Email Address
                        </span>
                        {pendingChanges.email && (
                          <span className="text-[9px] text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10">
                            Modified
                          </span>
                        )}
                      </div>
                      <Input
                        type="email"
                        value={editEmail}
                        onChange={(e) => {
                          setEditEmail(e.target.value);
                          addPendingChange(
                            "email",
                            e.target.value.trim().toLowerCase(),
                            u.email,
                          );
                        }}
                        placeholder="Email address"
                        className={cn(
                          "h-8 text-xs",
                          hasEmailError &&
                            "border-destructive focus-visible:ring-destructive",
                        )}
                        required
                      />
                      {hasEmailError && (
                        <p className="text-[10px] text-destructive">
                          Email is required
                        </p>
                      )}
                    </div>
                  )}

                  {/* Edit Plan - admin only */}
                  {perms.canManageStaff && (
                    <div
                      className={cn(
                        "flex flex-col gap-2 p-3 rounded-lg border transition-colors",
                        u.gifted_plan
                          ? "bg-amber-500/5 border-amber-500/30"
                          : pendingChanges.plan
                            ? "bg-primary/5 border-primary/30"
                            : "bg-card/30 border-border/40",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <CreditCard
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">
                          Subscription Plan
                        </span>
                        {u.gifted_plan && (
                          <span className="text-[9px] text-amber-500 font-medium px-1.5 py-0.5 rounded bg-amber-500/10">
                            Gifted
                          </span>
                        )}
                        {pendingChanges.plan && !u.gifted_plan && (
                          <span className="text-[9px] text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10">
                            Modified
                          </span>
                        )}
                      </div>
                      {u.gifted_plan ? (
                        <div className="flex flex-col gap-1.5">
                          <div className="h-8 text-xs rounded-md border border-amber-500/30 bg-amber-500/5 px-2 flex items-center gap-2 text-amber-500">
                            <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                            {getPlanById(u.gifted_plan)?.name || u.gifted_plan}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            Gifted until{" "}
                            {u.gift_end_date
                              ? new Date(u.gift_end_date).toLocaleDateString()
                              : "N/A"}
                            . Use the Gift button above to modify.
                          </p>
                        </div>
                      ) : (
                        <select
                          value={editPlan}
                          onChange={(e) => {
                            setEditPlan(e.target.value);
                            addPendingChange(
                              "plan",
                              e.target.value,
                              u.plan || "free",
                            );
                          }}
                          className="h-8 text-xs rounded-md border border-border bg-background px-2"
                        >
                          {PLANS.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>

                {/* Safety note */}
                <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-muted/30 border border-border/40">
                  <AlertTriangle
                    className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Changes are logged in the audit log. Email changes require
                    confirmation input to prevent accidents. Plan changes take
                    effect immediately.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Role + Badge management - admin only */}
      {!detailLoading && perms.canDeleteUsers && (
        <div
          id="roles-badges"
          className="grid grid-cols-1 lg:grid-cols-2 gap-4"
        >
          {/* Staff Role - dropdown */}
          <Card
            className={cn(
              "border-border/50 bg-card/50 transition-colors",
              pendingChanges.role && "border-primary/30",
            )}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium">Staff Role</p>
                {pendingChanges.role && (
                  <span className="text-[9px] text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10">
                    Modified
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {hasGodMode(u.role)
                  ? "The super admin's role can't be changed."
                  : "Select a permission level for this user."}
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <select
                value={editRole}
                disabled={hasGodMode(u.role)}
                onChange={(e) => {
                  setEditRole(e.target.value);
                  addPendingChange("role", e.target.value, u.role || "user");
                }}
                className="w-full h-10 rounded-lg border border-border/40 bg-card/30 px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {Object.values(STAFF_ROLES)
                  .filter(
                    (role) =>
                      role !== STAFF_ROLES.SUPER_ADMIN || hasGodMode(u.role),
                  )
                  .map((role) => {
                    const isOriginal = (u.role || "user") === role;
                    return (
                      <option key={role} value={role}>
                        {STAFF_ROLE_LABELS[role] || role}
                        {isOriginal ? " (current)" : ""}
                      </option>
                    );
                  })}
              </select>
            </CardContent>
          </Card>

          {/* Badges - multi select */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium">Badges</p>
                <Badge variant="secondary" className="text-[10px] h-5 ml-auto">
                  {detail.badges.length} awarded
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Cosmetic badges shown on the user&apos;s profile.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 flex flex-col gap-3">
              {/* Awarded badges */}
              {detail.badges.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {detail.badges.map((badge) => {
                    const isPendingRevoke = pendingBadgeRevokes.includes(
                      badge.id,
                    );
                    return (
                      <button
                        key={badge.id}
                        onClick={() => {
                          if (isPendingRevoke) {
                            setPendingBadgeRevokes((p) =>
                              p.filter((id) => id !== badge.id),
                            );
                          } else {
                            setPendingBadgeRevokes((p) => [...p, badge.id]);
                          }
                        }}
                        title={
                          isPendingRevoke
                            ? "Click to undo remove"
                            : "Click to remove badge"
                        }
                        className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all cursor-pointer hover:scale-105",
                          isPendingRevoke && "opacity-50 line-through",
                        )}
                        style={{
                          borderColor: `${badge.color}40`,
                          backgroundColor: `${badge.color}15`,
                          color: badge.color || undefined,
                        }}
                      >
                        <Tag className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {badge.display_name}
                        {isPendingRevoke && (
                          <RefreshCw
                            className="h-3 w-3 ml-0.5"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No badges awarded yet.
                </p>
              )}
              {pendingBadgeRevokes.length > 0 && (
                <p className="text-[10px] text-destructive">
                  {pendingBadgeRevokes.length} badge(s) will be removed on save
                </p>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {unawardedBadges.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 bg-transparent flex-1"
                    onClick={() => setShowBadgePicker(true)}
                  >
                    <Award className="h-3.5 w-3.5" aria-hidden="true" /> Award
                    Badge
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 bg-transparent flex-1"
                  onClick={() => setShowCreateBadge(true)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Create
                  Badge
                </Button>
                {hasStaffPermission(
                  callerRole,
                  STAFF_PERMISSIONS.DELETE_BADGE,
                ) &&
                  allBadges.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 bg-transparent text-destructive border-destructive/30 hover:bg-destructive/10 flex-1"
                      onClick={() => setShowManageBadges(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                      Manage Badges
                    </Button>
                  )}
              </div>

              {/* Award Badge Modal */}
              <Dialog open={showBadgePicker} onOpenChange={setShowBadgePicker}>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                      <Award
                        className="h-4 w-4 text-primary"
                        aria-hidden="true"
                      />{" "}
                      Award Badge
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-muted-foreground">
                      Select badges to award. Changes will apply when you save.
                    </p>
                    {unawardedBadges.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {unawardedBadges.map((badge) => {
                          const isPending = pendingBadgeAwards.includes(
                            badge.id,
                          );
                          return (
                            <button
                              key={badge.id}
                              onClick={() => {
                                if (isPending) {
                                  setPendingBadgeAwards((p) =>
                                    p.filter((id) => id !== badge.id),
                                  );
                                } else {
                                  setPendingBadgeAwards((p) => [
                                    ...p,
                                    badge.id,
                                  ]);
                                }
                              }}
                              className={cn(
                                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs font-medium transition-all",
                                isPending
                                  ? "ring-2 ring-primary scale-105"
                                  : "hover:scale-105 hover:opacity-80",
                              )}
                              style={{
                                borderColor: `${badge.color}40`,
                                backgroundColor: `${badge.color}15`,
                                color: badge.color || undefined,
                              }}
                            >
                              <Tag
                                className="h-3 w-3 shrink-0"
                                aria-hidden="true"
                              />
                              {badge.display_name}
                              {isPending && (
                                <CheckCircle2
                                  className="h-3 w-3 ml-0.5"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-4 text-center">
                        All badges have already been awarded.
                      </p>
                    )}
                    {pendingBadgeAwards.length > 0 && (
                      <p className="text-[10px] text-primary">
                        {pendingBadgeAwards.length} badge(s) queued to award on
                        save
                      </p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowBadgePicker(false)}
                    >
                      Done
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Create Badge Modal */}
              <Dialog
                open={showCreateBadge}
                onOpenChange={(open) => {
                  setShowCreateBadge(open);
                  if (!open) {
                    setNewBadgeName("");
                    setNewBadgeDisplay("");
                    setNewBadgeColor("#6366f1");
                  }
                }}
              >
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                      <Plus
                        className="h-4 w-4 text-primary"
                        aria-hidden="true"
                      />{" "}
                      Create New Badge
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4">
                    {/* Preview */}
                    {(newBadgeName || newBadgeDisplay) && (
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          Preview:
                        </p>
                        <div
                          className="flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium"
                          style={{
                            borderColor: `${newBadgeColor}40`,
                            backgroundColor: `${newBadgeColor}15`,
                            color: newBadgeColor,
                          }}
                        >
                          <Tag
                            className="h-3 w-3 shrink-0"
                            aria-hidden="true"
                          />
                          {newBadgeDisplay || newBadgeName}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium">
                        Badge ID{" "}
                        <span className="text-muted-foreground">
                          (internal name)
                        </span>
                      </label>
                      <Input
                        placeholder="e.g. power_user"
                        value={newBadgeName}
                        onChange={(e) =>
                          setNewBadgeName(
                            e.target.value.toLowerCase().replace(/\s+/g, "_"),
                          )
                        }
                        className="h-9 border-border/40"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium">
                        Display Name
                      </label>
                      <Input
                        placeholder="e.g. Power User"
                        value={newBadgeDisplay}
                        onChange={(e) => setNewBadgeDisplay(e.target.value)}
                        className="h-9 border-border/40"
                      />
                    </div>
                    {/* Color picker */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium">Color</label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { color: "#ef4444", name: "Red" },
                          { color: "#f97316", name: "Orange" },
                          { color: "#eab308", name: "Yellow" },
                          { color: "#22c55e", name: "Green" },
                          { color: "#10b981", name: "Emerald" },
                          { color: "#14b8a6", name: "Teal" },
                          { color: "#06b6d4", name: "Cyan" },
                          { color: "#3b82f6", name: "Blue" },
                          { color: "#6366f1", name: "Indigo" },
                          { color: "#8b5cf6", name: "Violet" },
                          { color: "#a855f7", name: "Purple" },
                          { color: "#ec4899", name: "Pink" },
                          { color: "#f43f5e", name: "Rose" },
                          { color: "#64748b", name: "Slate" },
                        ].map((c) => (
                          <button
                            key={c.color}
                            type="button"
                            onClick={() => setNewBadgeColor(c.color)}
                            className={cn(
                              "w-7 h-7 rounded-full transition-all border-2",
                              newBadgeColor === c.color
                                ? "border-foreground scale-110 shadow-xs"
                                : "border-transparent hover:scale-105",
                            )}
                            style={{ backgroundColor: c.color }}
                            title={c.name}
                            aria-label={`Set badge color to ${c.name}`}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {/* Native color picker: full color spectrum */}
                        <label
                          className="relative cursor-pointer"
                          title="Open color picker"
                        >
                          <div
                            className="w-7 h-7 rounded-full border-2 border-border/50 shrink-0 transition-all hover:scale-110 hover:border-border"
                            style={{ backgroundColor: newBadgeColor }}
                            aria-hidden="true"
                          />
                          <input
                            type="color"
                            value={newBadgeColor}
                            onChange={(e) => setNewBadgeColor(e.target.value)}
                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                            aria-label="Open full color picker"
                          />
                        </label>
                        <Input
                          value={newBadgeColor}
                          onChange={(e) => {
                            const v = e.target.value;
                            setNewBadgeColor(v.startsWith("#") ? v : `#${v}`);
                          }}
                          placeholder="#6366f1"
                          className="h-8 text-xs font-mono w-32 border-border/40"
                          maxLength={7}
                        />
                        <p className="text-xs text-muted-foreground">
                          Click swatch for full picker
                        </p>
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowCreateBadge(false);
                        setNewBadgeName("");
                        setNewBadgeDisplay("");
                        setNewBadgeColor("#6366f1");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !newBadgeName.trim() ||
                        !newBadgeDisplay.trim() ||
                        isLoading("create_badge")
                      }
                      onClick={async () => {
                        const result = await onAction(u.id, "create_badge", {
                          name: newBadgeName.trim(),
                          displayName: newBadgeDisplay.trim(),
                          color: newBadgeColor,
                        });
                        if (result.ok) {
                          setShowCreateBadge(false);
                          setNewBadgeName("");
                          setNewBadgeDisplay("");
                          setNewBadgeColor("#6366f1");
                        }
                      }}
                    >
                      {isLoading("create_badge") && (
                        <Loader2
                          className="h-3.5 w-3.5 mr-1.5 animate-spin"
                          aria-hidden="true"
                        />
                      )}
                      Create &amp; Award
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Manage/Delete Badges Modal */}
              {hasStaffPermission(
                callerRole,
                STAFF_PERMISSIONS.DELETE_BADGE,
              ) && (
                <Dialog
                  open={showManageBadges}
                  onOpenChange={(open) => {
                    setShowManageBadges(open);
                    if (!open) setPendingDeleteBadge(null);
                  }}
                >
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-base">
                        <Trash2
                          className="h-4 w-4 text-destructive"
                          aria-hidden="true"
                        />{" "}
                        Manage All Badges
                      </DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-3">
                      {/* Inline delete confirmation */}
                      {pendingDeleteBadge ? (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex flex-col gap-3">
                          <div className="flex items-start gap-3">
                            <AlertTriangle
                              className="h-4 w-4 text-destructive shrink-0 mt-0.5"
                              aria-hidden="true"
                            />
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                Delete &quot;{pendingDeleteBadge.display_name}
                                &quot;?
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                This will permanently remove the badge from the
                                system and revoke it from all users who
                                currently hold it.
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setPendingDeleteBadge(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={isLoading("delete_badge")}
                              onClick={async () => {
                                const result = await onAction(
                                  u.id,
                                  "delete_badge",
                                  { badgeId: String(pendingDeleteBadge.id) },
                                );
                                if (result.ok) {
                                  setPendingDeleteBadge(null);
                                  setShowManageBadges(false);
                                }
                              }}
                            >
                              {isLoading("delete_badge") ? (
                                <Loader2
                                  className="h-3.5 w-3.5 mr-1.5 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Trash2
                                  className="h-3.5 w-3.5 mr-1.5"
                                  aria-hidden="true"
                                />
                              )}
                              Delete Permanently
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">
                            Click the trash icon to permanently delete a badge
                            from the system.
                          </p>
                          {allBadges.length > 0 ? (
                            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                              {allBadges.map((badge) => (
                                <div
                                  key={badge.id}
                                  className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-card/30 hover:bg-muted/40 transition-colors"
                                >
                                  <div
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium"
                                    style={{
                                      borderColor: `${badge.color}40`,
                                      backgroundColor: `${badge.color}15`,
                                      color: badge.color || undefined,
                                    }}
                                  >
                                    <Tag
                                      className="h-3 w-3 shrink-0"
                                      aria-hidden="true"
                                    />
                                    {badge.display_name}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    onClick={() => setPendingDeleteBadge(badge)}
                                    title={`Delete "${badge.display_name}" permanently`}
                                    aria-label={`Delete ${badge.display_name} badge permanently`}
                                  >
                                    <Trash2
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                    />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground text-center py-4">
                              No badges exist yet.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowManageBadges(false);
                          setPendingDeleteBadge(null);
                        }}
                      >
                        Close
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Admin Notes */}
      {!detailLoading && (
        <Card id="admin-notes" className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-primary" aria-hidden="true" />
              <p className="text-sm font-medium">Admin Notes</p>
              <Badge variant="secondary" className="text-[10px] h-5 ml-auto">
                {detail.notes?.length || 0}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Admin-only notes. Only visible when extracting user data. Not
              shown to the user unless they request a data export.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0 flex flex-col gap-3">
            {/* Add note form */}
            <div className="flex gap-2">
              <Input
                placeholder="Add a note about this user..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="h-9 text-sm flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newNote.trim()) {
                    void addNote();
                  }
                }}
              />
              <Button
                size="sm"
                className="h-9 gap-1.5"
                disabled={!newNote.trim() || isLoading("add_note")}
                onClick={() => {
                  if (newNote.trim()) void addNote();
                }}
              >
                {isLoading("add_note") ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Add
              </Button>
            </div>

            {/* Notes list */}
            {detail.notes && detail.notes.length > 0 ? (
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {detail.notes.map((note) => (
                  <div
                    key={note.id}
                    className="group flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/40 hover:bg-muted/50 transition-colors"
                  >
                    <UserAvatar
                      name={note.admin_name}
                      email={note.admin_email}
                      size="sm"
                      avatarUrl={note.admin_avatar_url}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-foreground">
                          {note.admin_name || note.admin_email.split("@")[0]}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(new Date(note.created_at))}
                        </span>
                      </div>
                      {editingNote?.id === note.id ? (
                        <div className="flex gap-2 mt-1">
                          <Input
                            value={editingNote.text}
                            onChange={(e) =>
                              setEditingNote({
                                ...editingNote,
                                text: e.target.value,
                              })
                            }
                            className="h-8 text-xs flex-1"
                            autoFocus
                            onKeyDown={(e) => {
                              if (
                                e.key === "Enter" &&
                                editingNote.text.trim()
                              ) {
                                onAction(u.id, "edit_note", {
                                  noteId: note.id,
                                  note: editingNote.text.trim(),
                                });
                                setEditingNote(null);
                              }
                              if (e.key === "Escape") setEditingNote(null);
                            }}
                          />
                          <Button
                            size="sm"
                            className="h-8 px-2 text-xs"
                            disabled={!editingNote.text.trim()}
                            onClick={() => {
                              onAction(u.id, "edit_note", {
                                noteId: note.id,
                                note: editingNote.text.trim(),
                              });
                              setEditingNote(null);
                            }}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            onClick={() => setEditingNote(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap wrap-break-word">
                          {note.note}
                        </p>
                      )}
                    </div>
                    {editingNote?.id !== note.id && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() =>
                            setEditingNote({ id: note.id, text: note.note })
                          }
                          className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          aria-label="Edit note"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          onClick={() =>
                            setPendingDeleteNote({
                              id: note.id,
                              text: note.note,
                            })
                          }
                          className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          aria-label="Delete note"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                No notes yet. Add one above.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Support actions */}
      {!detailLoading && (
        <Card id="support-actions" className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <UserCog className="h-4 w-4 text-primary" aria-hidden="true" />
              <p className="text-sm font-medium">
                {!perms.canBanUsers ? "Account Information" : "Support Actions"}
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {!perms.canBanUsers ? (
              <p className="text-xs text-muted-foreground">
                You have view-only access. Contact an admin or moderator to
                perform actions on this user.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Session & Security */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                    Session &amp; Security
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <ActionCard
                      icon={LogOut}
                      label="Force Logout"
                      description={`Revoke all ${u.session_count} active session(s)`}
                      color="text-primary"
                      bg="bg-primary/10"
                      loading={isLoading("revoke_sessions")}
                      onClick={() =>
                        queueSupportAction(
                          "revoke_sessions",
                          "Force Logout",
                          `Revoke all ${u.session_count} active session(s) for ${u.name || u.email}`,
                        )
                      }
                    />
                    <ActionCard
                      icon={Key}
                      label="Revoke API Keys"
                      description={`Invalidate all ${u.api_key_count} API key(s)`}
                      color="text-[hsl(var(--severity-medium))]"
                      bg="bg-[hsl(var(--severity-medium))]/10"
                      loading={isLoading("revoke_api_keys")}
                      onClick={() =>
                        queueSupportAction(
                          "revoke_api_keys",
                          "Revoke API Keys",
                          `Invalidate all ${u.api_key_count} API key(s) for ${u.name || u.email}`,
                        )
                      }
                    />
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.RESET_USER_PASSWORD,
                    ) && (
                      <ActionCard
                        icon={KeyRound}
                        label="Reset Password"
                        description={
                          u.totp_enabled
                            ? "Unavailable: 2FA enabled"
                            : "Email a reset link"
                        }
                        color="text-[hsl(var(--severity-medium))]"
                        bg="bg-[hsl(var(--severity-medium))]/10"
                        disabled={u.totp_enabled}
                        loading={isLoading("reset_password")}
                        onClick={() =>
                          queueSupportAction(
                            "reset_password",
                            "Reset Password",
                            `Send a password reset link to ${u.name || u.email}. They'll set their own new password -- you won't see it.`,
                          )
                        }
                      />
                    )}
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.MANAGE_RATE_LIMITS,
                    ) && (
                      <ActionCard
                        icon={RefreshCw}
                        label="Clear Rate Limits"
                        description="Reset rate limit counters"
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("clear_rate_limits")}
                        onClick={() =>
                          queueSupportAction(
                            "clear_rate_limits",
                            "Clear Rate Limits",
                            `Reset rate limit counters for ${u.name || u.email}`,
                          )
                        }
                      />
                    )}
                    <ActionCard
                      icon={UserX}
                      label="Force Logout All"
                      description="Logout + revoke all API keys"
                      color="text-[hsl(var(--severity-medium))]"
                      bg="bg-[hsl(var(--severity-medium))]/10"
                      loading={isLoading("force_logout_all")}
                      onClick={() =>
                        queueSupportAction(
                          "force_logout_all",
                          "Force Logout All",
                          `Logout and revoke all API keys for ${u.name || u.email}`,
                        )
                      }
                    />
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.IMPERSONATE_USER,
                    ) && (
                      <ActionCard
                        icon={UserCog}
                        label="Impersonate"
                        description={
                          (STAFF_ROLE_HIERARCHY[u.role || "user"] ?? 0) > 0
                            ? "Unavailable: staff account"
                            : "Sign in as this user"
                        }
                        color="text-amber-500"
                        bg="bg-amber-500/10"
                        disabled={
                          (STAFF_ROLE_HIERARCHY[u.role || "user"] ?? 0) > 0
                        }
                        loading={isLoading("impersonate")}
                        onClick={() =>
                          queueSupportAction(
                            "impersonate",
                            "Impersonate User",
                            `Start an impersonation session as ${u.name || u.email}. You'll be signed in as them until you stop it (or after 1 hour).`,
                          )
                        }
                      />
                    )}
                  </div>
                </div>

                {/* Usage & Limits */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                    Usage &amp; Limits
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.RESET_USER_DAILY_LIMIT,
                    ) && (
                      <ActionCard
                        icon={Gauge}
                        label="Reset Daily Scan Limit"
                        description="Zero today's scan count"
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("reset_daily_limit")}
                        onClick={() =>
                          queueSupportAction(
                            "reset_daily_limit",
                            "Reset Daily Scan Limit",
                            `Zero today's scan count for ${u.name || u.email}`,
                          )
                        }
                      />
                    )}
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.RESET_USER_AI_USAGE,
                    ) && (
                      <ActionCard
                        icon={Sparkles}
                        label="Reset AI Usage"
                        description="Zero the current AI usage window"
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("reset_ai_usage")}
                        onClick={() =>
                          queueSupportAction(
                            "reset_ai_usage",
                            "Reset AI Usage",
                            `Zero the current AI usage window for ${u.name || u.email}`,
                          )
                        }
                      />
                    )}
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.RESET_USER_GITHUB_REVIEW_USAGE,
                    ) && (
                      <ActionCard
                        icon={FaGithub}
                        label="Reset GitHub Review Usage"
                        description="Zero the current GitHub review window"
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("reset_github_review_usage")}
                        onClick={() =>
                          queueSupportAction(
                            "reset_github_review_usage",
                            "Reset GitHub Review Usage",
                            `Zero the current GitHub review window for ${u.name || u.email}`,
                          )
                        }
                      />
                    )}
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.RESET_USER_FREE_GITHUB_TRIAL,
                    ) && (
                      <ActionCard
                        icon={Clock}
                        label="Reset Free GitHub Trial"
                        description="Let today's free review run again now"
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("reset_free_github_trial")}
                        onClick={() =>
                          queueSupportAction(
                            "reset_free_github_trial",
                            "Reset Free GitHub Trial",
                            `Let today's free GitHub review run again now for ${u.name || u.email}`,
                          )
                        }
                      />
                    )}
                  </div>
                </div>

                {/* Account Management */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                    Account Management
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <ActionCard
                      icon={u.email_verified_at ? MailX : MailCheck}
                      label={
                        u.email_verified_at ? "Unverify Email" : "Verify Email"
                      }
                      description={
                        u.email_verified_at
                          ? "Mark email as unverified"
                          : "Manually verify email address"
                      }
                      color={
                        u.email_verified_at
                          ? "text-[hsl(var(--warning))]"
                          : "text-[hsl(var(--success))]"
                      }
                      bg={
                        u.email_verified_at
                          ? "bg-[hsl(var(--warning))]/10"
                          : "bg-[hsl(var(--success))]/10"
                      }
                      loading={
                        isLoading("verify_email") || isLoading("unverify_email")
                      }
                      onClick={() =>
                        queueSupportAction(
                          u.email_verified_at
                            ? "unverify_email"
                            : "verify_email",
                          u.email_verified_at
                            ? "Unverify Email"
                            : "Verify Email",
                          u.email_verified_at
                            ? `Mark ${u.email} as unverified`
                            : `Manually verify ${u.email}`,
                        )
                      }
                    />
                    <ActionCard
                      icon={ImageOff}
                      label="Clear Avatar"
                      description="Remove profile picture"
                      color="text-muted-foreground"
                      bg="bg-muted/50"
                      loading={isLoading("clear_avatar")}
                      onClick={() =>
                        queueSupportAction(
                          "clear_avatar",
                          "Clear Avatar",
                          `Remove profile picture for ${u.name || u.email}`,
                        )
                      }
                    />
                    <ActionCard
                      icon={Bell}
                      label="Send Notification"
                      description="Send an email notification"
                      color="text-primary"
                      bg="bg-primary/10"
                      loading={isLoading("send_notification")}
                      onClick={() => setShowNotifDialog(true)}
                    />
                  </div>
                </div>

                {/* Send Notification Dialog */}
                {showNotifDialog && (
                  <Dialog
                    open={showNotifDialog}
                    onOpenChange={setShowNotifDialog}
                  >
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>Send Notification</DialogTitle>
                      </DialogHeader>
                      <div className="flex flex-col gap-3 py-2">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-medium">Title</label>
                          <Input
                            placeholder="e.g. Account Update"
                            value={notifTitle}
                            onChange={(e) => setNotifTitle(e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-medium">Message</label>
                          <textarea
                            placeholder="Message to send to the user..."
                            value={notifMessage}
                            onChange={(e) => setNotifMessage(e.target.value)}
                            rows={4}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-hidden focus:ring-2 focus:ring-ring"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          This will send an email notification to {u.email}.
                        </p>
                      </div>
                      <DialogFooter className="gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowNotifDialog(false);
                            setNotifTitle("");
                            setNotifMessage("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          disabled={!notifTitle.trim() || !notifMessage.trim()}
                          onClick={() => {
                            setShowNotifDialog(false);
                            queueSupportAction(
                              "send_notification",
                              "Send Notification",
                              `Send notification "${notifTitle}" to ${u.name || u.email}`,
                              "default",
                              {
                                title: notifTitle,
                                message: notifMessage,
                                type: "info",
                              },
                            );
                            setNotifTitle("");
                            setNotifMessage("");
                          }}
                        >
                          <Send
                            className="mr-1.5 h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          Send
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}

                {/* Gifted Subscription */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                    Gifted Subscription
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {u.gifted_plan &&
                    u.gift_end_date &&
                    new Date(u.gift_end_date) > new Date() ? (
                      <ActionCard
                        icon={CrownIcon}
                        label="Edit Gift Subscription"
                        description={`${getPlanById(u.gifted_plan)?.name || u.gifted_plan} · expires ${new Date(u.gift_end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={
                          isLoading("gift_subscription") ||
                          isLoading("revoke_gift")
                        }
                        onClick={() => setShowGiftModal(true)}
                      />
                    ) : (
                      <ActionCard
                        icon={CrownIcon}
                        label="Gift a Subscription"
                        description={
                          u.gifted_plan
                            ? "Previous gift expired, re-gift"
                            : "Grant temporary premium access"
                        }
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("gift_subscription")}
                        onClick={() => setShowGiftModal(true)}
                      />
                    )}
                  </div>
                </div>

                {showGiftModal && (
                  <GiftSubscriptionModal
                    open={showGiftModal}
                    onClose={() => setShowGiftModal(false)}
                    isLoading={
                      isLoading("gift_subscription") || isLoading("revoke_gift")
                    }
                    existingGift={
                      u.gifted_plan &&
                      u.gift_end_date &&
                      new Date(u.gift_end_date) > new Date()
                        ? { plan: u.gifted_plan, end_date: u.gift_end_date }
                        : null
                    }
                    onGift={(plan, endDate) => {
                      setShowGiftModal(false);
                      queueSupportAction(
                        "gift_subscription",
                        "Gift Subscription",
                        `Gift ${getPlanById(plan)?.name || plan} plan to ${u.name || u.email} until ${new Date(endDate).toLocaleDateString()}`,
                        "default",
                        { giftPlan: plan, giftEndDate: endDate },
                      );
                    }}
                    onRevoke={() => {
                      setShowGiftModal(false);
                      queueSupportAction(
                        "revoke_gift",
                        "Revoke Gift",
                        `Remove gifted subscription from ${u.name || u.email}`,
                        "destructive",
                      );
                    }}
                  />
                )}

                {/* Danger Zone */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-destructive/70 font-medium mb-2">
                    Danger Zone
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <ActionCard
                      icon={u.disabled_at ? CheckCircle2 : Ban}
                      label={
                        u.disabled_at ? "Re-enable Account" : "Disable Account"
                      }
                      description={
                        u.disabled_at
                          ? "Allow user to log in"
                          : "Suspend and force-logout"
                      }
                      color={
                        u.disabled_at
                          ? "text-[hsl(var(--success))]"
                          : "text-destructive"
                      }
                      bg={
                        u.disabled_at
                          ? "bg-[hsl(var(--success))]/10"
                          : "bg-destructive/10"
                      }
                      variant={u.disabled_at ? "success" : "danger"}
                      onClick={() =>
                        queueSupportAction(
                          u.disabled_at ? "enable" : "disable",
                          u.disabled_at
                            ? "Re-enable Account"
                            : "Disable Account",
                          u.disabled_at
                            ? `Allow ${u.name || u.email} to log in again`
                            : `Suspend ${u.name || u.email} and force logout all sessions`,
                          u.disabled_at ? "default" : "destructive",
                        )
                      }
                    />
                    <ActionCard
                      icon={BotOff}
                      label={
                        u.ai_chat_banned
                          ? "Unban from AI Chat"
                          : "Ban from AI Chat"
                      }
                      description={
                        u.ai_chat_banned
                          ? "Restore AI chat access"
                          : "Block access to AI assistant"
                      }
                      color={
                        u.ai_chat_banned
                          ? "text-[hsl(var(--success))]"
                          : "text-[hsl(var(--warning))]"
                      }
                      bg={
                        u.ai_chat_banned
                          ? "bg-[hsl(var(--success))]/10"
                          : "bg-[hsl(var(--warning))]/10"
                      }
                      variant={u.ai_chat_banned ? "success" : "danger"}
                      loading={isLoading("toggle_ai_ban")}
                      onClick={() =>
                        queueSupportAction(
                          "toggle_ai_ban",
                          u.ai_chat_banned
                            ? "Unban from AI Chat"
                            : "Ban from AI Chat",
                          u.ai_chat_banned
                            ? `Restore AI chat access for ${u.name || u.email}`
                            : `Block ${u.name || u.email} from using the AI assistant`,
                          u.ai_chat_banned ? "default" : "destructive",
                        )
                      }
                    />
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.DELETE_ANY_SCAN,
                    ) && (
                      <ActionCard
                        icon={Activity}
                        label="Delete All Scans"
                        description={`Remove all ${u.scan_count} scan(s)`}
                        color="text-destructive"
                        bg="bg-destructive/10"
                        variant="danger"
                        loading={isLoading("delete_scans")}
                        onClick={() =>
                          queueSupportAction(
                            "delete_scans",
                            "Delete All Scans",
                            `Remove all ${u.scan_count} scan(s) for ${u.name || u.email}`,
                            "destructive",
                          )
                        }
                      />
                    )}
                    <ActionCard
                      icon={Webhook}
                      label="Delete Webhooks"
                      description="Remove all webhooks"
                      color="text-destructive"
                      bg="bg-destructive/10"
                      variant="danger"
                      loading={isLoading("delete_webhooks")}
                      onClick={() =>
                        queueSupportAction(
                          "delete_webhooks",
                          "Delete Webhooks",
                          `Remove all webhooks for ${u.name || u.email}`,
                          "destructive",
                        )
                      }
                    />
                    <ActionCard
                      icon={CalendarOff}
                      label="Delete Schedules"
                      description="Remove scheduled scans"
                      color="text-destructive"
                      bg="bg-destructive/10"
                      variant="danger"
                      loading={isLoading("delete_schedules")}
                      onClick={() =>
                        queueSupportAction(
                          "delete_schedules",
                          "Delete Schedules",
                          `Remove all scheduled scans for ${u.name || u.email}`,
                          "destructive",
                        )
                      }
                    />
                    {perms.canDeleteUsers && (
                      <ActionCard
                        icon={Trash2}
                        label="Delete Account"
                        description="Permanently remove user"
                        color="text-destructive"
                        bg="bg-destructive/10"
                        variant="danger"
                        onClick={() =>
                          queueSupportAction(
                            "delete",
                            "Delete Account",
                            `Permanently remove ${u.name || u.email}'s account. This cannot be undone.`,
                            "destructive",
                          )
                        }
                      />
                    )}
                  </div>
                </div>

                {u.totp_enabled && (
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[hsl(var(--severity-medium))]/5 border border-[hsl(var(--severity-medium))]/20">
                    <AlertTriangle
                      className="h-4 w-4 text-[hsl(var(--severity-medium))] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="text-sm font-medium">
                        Password reset is unavailable for this user
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                        This user has two-factor authentication enabled, so an
                        admin can&apos;t reset their password. For account
                        recovery, they need to use their own backup codes or
                        their own account recovery flow. Admins can&apos;t
                        remove a user&apos;s 2FA either, for the same reason.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Info section - Recent Scans, API Keys, Webhooks, Active Sessions */}
      {!detailLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent Scans */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium">Recent Scans</p>
                <Badge variant="secondary" className="text-[10px] h-5 ml-auto">
                  {detail.recentScans?.length || 0}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {detail.recentScans && detail.recentScans.length > 0 ? (
                <div className="flex flex-col max-h-64 overflow-y-auto">
                  {detail.recentScans.map((scan) => (
                    <div
                      key={scan.id}
                      className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors rounded-md"
                    >
                      <Globe
                        className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium font-mono truncate">
                          {scan.url}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {scan.findings_count} findings via {scan.source}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(scan.scanned_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <Activity
                    className="h-8 w-8 text-muted-foreground/30 mb-2"
                    aria-hidden="true"
                  />
                  <p className="text-xs text-muted-foreground">
                    No recent scans.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* API Keys */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium">API Keys</p>
                <Badge variant="secondary" className="text-[10px] h-5 ml-auto">
                  {detail.apiKeys?.filter((k) => !k.revoked_at)?.length || 0}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {detail.apiKeys &&
              detail.apiKeys.filter((k) => !k.revoked_at).length > 0 ? (
                <div className="flex flex-col max-h-64 overflow-y-auto">
                  {detail.apiKeys
                    .filter((k) => !k.revoked_at)
                    .map((key) => (
                      <div
                        key={key.id}
                        className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors rounded-md"
                      >
                        <Key
                          className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                          aria-hidden="true"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">
                            {key.name || "Unnamed Key"}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {key.key_prefix}...
                          </p>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {key.last_used_at
                            ? formatRelativeTime(new Date(key.last_used_at))
                            : "Never used"}
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <Key
                    className="h-8 w-8 text-muted-foreground/30 mb-2"
                    aria-hidden="true"
                  />
                  <p className="text-xs text-muted-foreground">No API keys.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Webhooks */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium">Webhooks</p>
                <Badge variant="secondary" className="text-[10px] h-5 ml-auto">
                  {detail.webhooks?.length || 0}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {detail.webhooks && detail.webhooks.length > 0 ? (
                <div className="flex flex-col max-h-64 overflow-y-auto">
                  {detail.webhooks.map((webhook) => (
                    <div
                      key={webhook.id}
                      className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors rounded-md"
                    >
                      <Webhook
                        className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{webhook.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">
                          {webhook.url}
                        </p>
                      </div>
                      <Badge
                        variant={webhook.active ? "default" : "secondary"}
                        className="text-[9px]"
                      >
                        {webhook.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <Webhook
                    className="h-8 w-8 text-muted-foreground/30 mb-2"
                    aria-hidden="true"
                  />
                  <p className="text-xs text-muted-foreground">
                    No webhooks configured.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active Sessions */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium">Active Sessions</p>
                <Badge variant="secondary" className="text-[10px] h-5 ml-auto">
                  {detail.activeSessions?.length || 0}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {detail.activeSessions && detail.activeSessions.length > 0 ? (
                <div className="flex flex-col max-h-64 overflow-y-auto">
                  {detail.activeSessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors rounded-md"
                    >
                      <Globe
                        className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium font-mono">
                          {session.id.slice(0, 12)}...
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          <span className="font-mono">
                            {session.ip_address || "Unknown IP"}
                          </span>{" "}
                          &middot;{" "}
                          {session.user_agent?.slice(0, 40) || "Unknown device"}
                          ...
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        expires{" "}
                        {new Date(session.expires_at).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" },
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <Globe
                    className="h-8 w-8 text-muted-foreground/30 mb-2"
                    aria-hidden="true"
                  />
                  <p className="text-xs text-muted-foreground">
                    No active sessions.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Floating save bar */}
      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pointer-events-none">
          <div className="max-w-lg mx-auto pointer-events-auto">
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-card/95 border border-border/50 shadow-xl backdrop-blur-xs">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <Save
                    className="h-3.5 w-3.5 text-primary"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {modalChanges.length} unsaved change
                    {modalChanges.length !== 1 ? "s" : ""}
                  </p>
                  {hasEmailError && (
                    <p className="text-[10px] text-destructive">
                      Email address is required
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={discardChanges}
                  disabled={isSaving}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={handleSaveClick}
                  disabled={isSaving || !canSave}
                >
                  {isSaving ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save confirmation modal -- only ever opens when the batch touches
          neither email nor role now: handleSaveClick sends a batch that
          does straight to the password dialog below instead (those two
          fields are password-gated server-side). */}
      <SaveConfirmationModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onConfirm={async (notify) => {
          setNotifyUserOnSave(notify ?? true);
          return await saveAllChanges();
        }}
        title="Save Changes"
        description={`You're about to save ${modalChanges.length} change${modalChanges.length !== 1 ? "s" : ""} to ${u.name || u.email}'s account.`}
        changes={modalChanges}
        loading={isSaving}
        isAdminAction={true}
        affectedUser={affectedUser}
        confirmText="Save Changes"
      />

      <AdminPasswordConfirmDialog
        open={showSavePasswordDialog}
        onOpenChange={setShowSavePasswordDialog}
        title="Confirm Account Changes"
        description={`Re-enter your password to save these changes to ${u.name || u.email}'s account.`}
        confirmLabel="Save Changes"
        onConfirm={async (password) => {
          const result = await saveAllChanges(password);
          if (result.ok) setShowSavePasswordDialog(false);
          return result;
        }}
      />

      {/* Support action confirmation modal -- only ever opens for a
          NON-gated action now: queueSupportAction sends a password-gated
          one (disable/reset_password/delete/etc, see
          PASSWORD_GATED_ACTIONS) straight to the password dialog below
          instead, so this component's own "success + auto-close in 1.5s"
          sequence never runs concurrently with that dialog being open.
          See queueSupportAction's own comment for the stale-timeout race
          this used to cause. */}
      <SaveConfirmationModal
        isOpen={!!pendingSupportAction && !showSupportPasswordDialog}
        onClose={() => setPendingSupportAction(null)}
        onConfirm={async (notify) => {
          return await executeSupportAction(notify ?? true);
        }}
        title={pendingSupportAction?.label || "Confirm Action"}
        description={
          pendingSupportAction?.description ||
          "Are you sure you want to perform this action?"
        }
        changes={[
          {
            field: "action",
            label: "Action",
            oldValue: "Current State",
            newValue: pendingSupportAction?.label || "Execute Action",
          },
        ]}
        loading={isLoading(pendingSupportAction?.action || "")}
        isAdminAction={true}
        affectedUser={affectedUser}
        confirmText="Confirm"
        variant={pendingSupportAction?.variant}
        forceNotify={true}
      />

      <AdminPasswordConfirmDialog
        open={showSupportPasswordDialog}
        onOpenChange={(o) => {
          setShowSupportPasswordDialog(o);
          if (!o) setPendingSupportAction(null);
        }}
        title={pendingSupportAction?.label || "Confirm Action"}
        description={
          pendingSupportAction?.description
            ? `${pendingSupportAction.description} Re-enter your password to confirm.`
            : "Re-enter your password to confirm this action."
        }
        confirmLabel={pendingSupportAction?.label || "Confirm"}
        variant={pendingSupportAction?.variant}
        onConfirm={async (password) => {
          const result = await executeSupportAction(supportNotify, password);
          if (result.ok) setShowSupportPasswordDialog(false);
          return result;
        }}
      />

      {/* Delete Note Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={!!pendingDeleteNote}
        onClose={() => setPendingDeleteNote(null)}
        onConfirm={async () => {
          if (!pendingDeleteNote) return;
          const result = await onAction(u.id, "delete_note", {
            noteId: pendingDeleteNote.id,
          });
          if (result.ok) setPendingDeleteNote(null);
          return result;
        }}
        title="Delete Note"
        description="This will permanently delete this admin note. This action cannot be undone."
        changes={
          pendingDeleteNote
            ? [
                {
                  field: "note",
                  label: "Note",
                  oldValue:
                    pendingDeleteNote.text.substring(0, 50) +
                    (pendingDeleteNote.text.length > 50 ? "..." : ""),
                  newValue: "Deleted",
                },
              ]
            : []
        }
        loading={isLoading("delete_note")}
        confirmText="Delete"
        variant="destructive"
      />

      {/* Mobile "on this page" nav: this view stacks several long cards
          (overview, account management, roles & badges, notes, support
          actions), long enough to be worth a jump list once loaded. */}
      {!detailLoading && (
        <>
          <AdminMobileTocTrigger
            isOpen={tocOpen}
            onToggle={() => setTocOpen((o) => !o)}
          />
          <AdminMobileToc
            title={u.name || u.email}
            items={tocItems}
            isOpen={tocOpen}
            onClose={() => setTocOpen(false)}
          />
        </>
      )}
    </div>
  );
}
