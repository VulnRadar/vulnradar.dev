"use client";

import Link from "next/link";
import { useState, useId, useMemo } from "react";
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
  StickyNote,
  Send,
  Webhook,
  Activity,
  Bell,
  Gauge,
  Smartphone,
  Sparkles,
  Coins,
} from "lucide-react";
import { FaGithub, FaDiscord } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/ui/utils";
import { pluralize } from "@/lib/ui/plural";
import {
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  STAFF_ROLE_HIERARCHY,
  ROUTES,
} from "@/lib/config/client-constants";
import { getPlanById } from "@/lib/billing/catalog";
import {
  hasStaffPermission,
  canPerformAction,
  hasGodMode,
  STAFF_PERMISSIONS,
} from "@/lib/auth/permissions-client";
import {
  SaveConfirmationModal,
  type AffectedUser,
} from "@/components/shared/save-confirmation-modal";
import type { UserDetail, BadgeDef } from "@/components/admin/types";
import { formatRelativeTime } from "@/components/admin/utils";
import { scanStatusPill } from "@/components/admin/scans/scan-status";
import {
  DANGER_ZONE_ACTIONS,
  SUPPORT_CARD_ACTIONS,
} from "@/components/admin/config";
import { isPasswordGatedAction } from "@/lib/admin/password-gate";
import { FilterChips } from "@/components/admin/shared/filter-chips";
import {
  UserAvatar,
  ActionCard,
  AdminMobileToc,
  AdminMobileTocTrigger,
  Skeleton,
  StatBar,
  StatBarSkeleton,
  StatusPill,
  AdminPasswordConfirmDialog,
  EmptyState,
  type AdminTocItem,
} from "@/components/admin/shared";
import { useAdminPermissions } from "@/components/admin/hooks";
import { GiftSubscriptionModal } from "./gift-subscription-modal";
import { AccountHistory } from "./account-history";
import { UsageReadout } from "./usage-readout";
import { LeadingIcon } from "@/components/shared/leading-icon";
import { Textarea } from "@/components/ui/textarea";
import { useNow } from "@/lib/ui/clock";
import {
  ChangeStaffRoleDialog,
  EditAccountDialog,
  EditBadgesDialog,
  EditNoteDialog,
  NATIVE_SELECT_CLASS,
  type AccountChanges,
  type AccountSaveOptions,
  type SaveResult,
} from "./user-edit-dialogs";

interface UserDetailPanelProps {
  detail: UserDetail;
  detailLoading: boolean;
  actionLoading: string | null;
  onClose: () => void;
  onAction: (
    userId: number,
    action: string,
    extra?: Record<string, unknown>,
    options?: { toast?: string | false },
  ) => Promise<{
    ok: boolean;
    error?: string;
    change?: { field: string; oldValue: string; newValue: string };
  }>;
  callerRole: string;
  allBadges: BadgeDef[];
  onBadgesChanged: (awardedIds: number[], revokedIds: number[]) => void;
}

/**
 * An ActionCard that knows whether this role may run its action.
 *
 * Eleven of the cards in this panel are permission-gated at their render site
 * and eight are not, so for a moderator five of them were guaranteed 403s:
 * revoke keys, verify email, send notification, delete webhooks, delete
 * schedules. Four of those are password-gated, so the operator was asked to
 * type their admin password into a dialog and THEN told they lacked
 * permission. Beyond the wasted step, that is exactly the conditioning that
 * makes a re-auth prompt worthless: it teaches people the prompt is noise
 * that appears before a failure.
 *
 * Gating here rather than at nineteen render sites is what stops the next
 * card drifting. canPerformAction reads the same ADMIN_ACTIONS registry the
 * server consults, so a card and its route cannot disagree about what a role
 * may do. The server still decides; this only stops the panel asking a
 * question whose answer is already known.
 */
function GatedActionCard({
  action,
  callerRole,
  description,
  ...rest
}: React.ComponentProps<typeof ActionCard> & {
  action: string;
  callerRole: string;
}) {
  const allowed = canPerformAction(callerRole, action);
  return (
    <ActionCard
      {...rest}
      description={
        allowed ? description : "Your role cannot perform this action."
      }
      disabled={rest.disabled || !allowed}
    />
  );
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
  // Whether a gifted plan is still running, read against a clock that ticks
  // rather than a `new Date()` in render (see lib/ui/clock.ts).
  const now = useNow();
  const giftActive = Boolean(
    u.gifted_plan &&
    u.gift_end_date &&
    new Date(u.gift_end_date).getTime() > now,
  );
  const canRunSupportActions = useMemo(
    () => SUPPORT_CARD_ACTIONS.some((a) => canPerformAction(callerRole, a)),
    [callerRole],
  );
  const canRunDangerZoneActions = useMemo(
    () => DANGER_ZONE_ACTIONS.some((a) => canPerformAction(callerRole, a)),
    [callerRole],
  );
  const isLoading = (action: string) => actionLoading === `${u.id}-${action}`;
  const [showCreateBadge, setShowCreateBadge] = useState(false);
  const [showManageBadges, setShowManageBadges] = useState(false);
  const [newNote, setNewNote] = useState("");
  async function addNote() {
    const result = await onAction(u.id, "add_note", { note: newNote.trim() });
    if (result.ok) setNewNote("");
  }
  const [creditGrantType, setCreditGrantType] = useState<
    "ai" | "github" | "browser"
  >("ai");
  const [creditGrantAmount, setCreditGrantAmount] = useState("");
  const [creditGrantReason, setCreditGrantReason] = useState("");
  // Remove is the correction for a wrong grant: same form, other direction.
  const [creditMode, setCreditMode] = useState<"grant" | "remove">("grant");
  // Both directions are password-gated (isPasswordGatedAction), so they go
  // through the same queue as the other gated actions; executeSupportAction
  // clears the form.
  function changeCredits() {
    const unit =
      creditGrantType === "browser"
        ? "browser minutes"
        : creditGrantType === "github"
          ? "GitHub review tokens"
          : "AI tokens";
    const payload = {
      creditType: creditGrantType,
      amount: Number(creditGrantAmount),
      reason: creditGrantReason.trim(),
    };
    if (creditMode === "remove") {
      queueSupportAction(
        "adjust_credits",
        "Remove Credits",
        `Take ${creditGrantAmount.trim()} ${unit} off ${u.name || u.email}'s balance. A balance never goes below 0, and your reason is recorded in the audit log.`,
        "destructive",
        payload,
      );
      return;
    }
    queueSupportAction(
      "grant_credits",
      "Grant Credits",
      `Add ${creditGrantAmount.trim()} ${unit} to ${u.name || u.email}'s balance.`,
      "default",
      payload,
    );
  }
  const [editingNote, setEditingNote] = useState<{
    id: number;
    text: string;
    userId: number;
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

  // Which edit dialog is open, and for whom. The panel is not remounted when
  // the admin moves to another user, so a dialog keyed to nothing would
  // carry one person's draft onto the next record.
  const [editing, setEditing] = useState<{
    kind: "account" | "role" | "badges";
    userId: number;
  } | null>(null);
  // Moving to another user drops the open dialog for good. Hidden but kept, it
  // reopened when the admin came back to the first user (browser back).
  if (editing && editing.userId !== u.id) setEditing(null);
  if (editingNote && editingNote.userId !== u.id) setEditingNote(null);
  const isEditing = (kind: "account" | "role" | "badges") =>
    editing?.kind === kind && editing.userId === u.id;
  const closeEditing = () => setEditing(null);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [showNotifDialog, setShowNotifDialog] = useState(false);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");
  const [tocOpen, setTocOpen] = useState(false);

  // Password re-auth state. update_email/set_role (the account and role
  // dialogs) and disable/reset_password/delete (support actions) are all in
  // PASSWORD_GATED_ACTIONS, so the backend rejects them with 403 unless
  // currentAdminPassword is sent.
  const [showSupportPasswordDialog, setShowSupportPasswordDialog] =
    useState(false);
  const [supportNotify, setSupportNotify] = useState(true);

  // Stable ids so each <label htmlFor> names its control. These were plain
  // labels above unlabelled inputs, so a screen reader announced them as
  // unnamed edit fields.
  const badgeIdFieldId = useId();
  const badgeDisplayFieldId = useId();
  const badgeColorLabelId = useId();
  const notifTitleId = useId();
  const notifMessageId = useId();
  const creditTypeFieldId = useId();
  const creditAmountFieldId = useId();
  const creditReasonFieldId = useId();

  // Support action confirmation state
  const [pendingSupportAction, setPendingSupportAction] = useState<{
    action: string;
    label: string;
    description: string;
    variant?: "default" | "destructive";
    extraPayload?: Record<string, unknown>;
  } | null>(null);

  const affectedUser: AffectedUser = {
    id: u.id,
    email: u.email,
    name: u.name || undefined,
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
    // Every support action confirms. Five of them (the quota and rate-limit
    // resets) used to run straight from the click, on the argument that
    // handing capacity back destroys nothing and a dialog nobody needs is a
    // dialog nobody reads. The owner's rule is the other way round and it is
    // the right one for a panel that operates on other people's accounts:
    // these still write to a real user's row, an operator can still click the
    // wrong card in a list of nineteen, and "it was only a reset" is not
    // something you get to say afterwards.
    setPendingSupportAction({
      action,
      label,
      description,
      variant,
      extraPayload,
    });
    // Mirrors the server's directional gate for toggle_ai_ban (see
    // app/api/v3/admin/route.ts): only the ban direction needs re-auth, so
    // un-banning no longer prompts for a password it would not be asked for.
    const unbanning = action === "toggle_ai_ban" && u.ai_chat_banned === true;
    if (isPasswordGatedAction(action) && !unbanning) {
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
      if (
        pendingSupportAction.action === "grant_credits" ||
        pendingSupportAction.action === "adjust_credits"
      ) {
        setCreditGrantAmount("");
        setCreditGrantReason("");
      }
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

  type ChangeForEmail = { field: string; oldValue: string; newValue: string };

  // One account save, from the account dialog or the role dialog.
  //
  // The password-gated writes go first (update_email, set_role), so a
  // mistyped password is refused before anything else in the save has been
  // written. name, plan and role are each sent with notifyUser:false: every
  // one still writes its own row and audit entry, but their `change`
  // descriptors are collected and sent as ONE notify_account_changes email at
  // the end instead of an email per field. update_email is not folded in: it
  // sends its own notice to the old and the new address, and the server sends
  // the old-address one whatever notifyUser says.
  //
  // A moderator can rename an account but is refused notify_account_changes
  // (it needs MANAGE_NOTIFICATIONS, withheld on purpose: see the route), so
  // for a caller without it each write sends its own email instead. Only the
  // name reaches here for that role, so the user still gets exactly one.
  //
  // A refusal part way through still sends the email for the writes before
  // it. Those are on the account now, and the retry measures the draft
  // against the refetched record, so it never sends them again: an email
  // held back for the whole save to succeed would never go out for them.
  const saveAccountChanges = async (
    changes: AccountChanges,
    opts: AccountSaveOptions,
  ): Promise<SaveResult> => {
    const pw = opts.password ? { currentAdminPassword: opts.password } : {};
    const canBatch = canPerformAction(callerRole, "notify_account_changes");
    const notifyUser = canBatch ? false : opts.notifyUser;
    const changesForEmail: ChangeForEmail[] = [];
    const steps: [string, Record<string, unknown>][] = [];
    if (changes.email !== undefined)
      steps.push([
        "update_email",
        { email: changes.email, notifyUser: opts.notifyUser, ...pw },
      ]);
    if (changes.role !== undefined)
      steps.push(["set_role", { role: changes.role, notifyUser, ...pw }]);
    if (changes.name !== undefined)
      steps.push(["update_name", { name: changes.name, notifyUser }]);
    if (changes.plan !== undefined)
      steps.push(["update_plan", { plan: changes.plan, notifyUser }]);
    let outcome: SaveResult = { ok: true };
    for (const [action, extra] of steps) {
      const result = await onAction(u.id, action, extra);
      if (!result.ok) {
        outcome = { ok: false, error: result.error };
        break;
      }
      if (result.change && action !== "update_email")
        changesForEmail.push(result.change);
    }
    if (canBatch && opts.notifyUser && changesForEmail.length > 0) {
      await onAction(u.id, "notify_account_changes", {
        changes: changesForEmail,
        notifyUser: true,
      });
    }
    return outcome;
  };

  // One summary toast for the whole batch, not one per badge: the first call
  // carries it and the rest stay silent.
  //
  // The badge writes are N independent PATCHes, not one transaction, so a
  // partial failure leaves a partial diff applied. That is accepted on
  // purpose: badges are cosmetic profile decoration. What the panel does
  // owe the admin is the truth about it, so only the writes that went
  // through are shown as applied, and a refused one keeps the dialog open
  // with the server's reason.
  const saveBadgeChanges = async (
    awards: number[],
    revokes: number[],
    notifyUser: boolean,
  ): Promise<SaveResult> => {
    const parts: string[] = [];
    if (awards.length > 0) parts.push(`${awards.length} awarded`);
    if (revokes.length > 0) parts.push(`${revokes.length} removed`);
    const badgeSummary = `Badges updated: ${parts.join(", ")}.`;
    let isFirstBadgeCall = true;
    const badgeToast = (): { toast: string | false } => {
      if (isFirstBadgeCall) {
        isFirstBadgeCall = false;
        return { toast: badgeSummary };
      }
      return { toast: false };
    };
    const send = (action: "award_badge" | "revoke_badge", id: number) =>
      onAction(
        u.id,
        action,
        { badgeId: String(id), notifyUser: false },
        badgeToast(),
      ).then((result) => ({ id, result }));
    const [awarded, revoked] = await Promise.all([
      Promise.all(awards.map((id) => send("award_badge", id))),
      Promise.all(revokes.map((id) => send("revoke_badge", id))),
    ]);
    const done = (list: typeof awarded) =>
      list.filter((r) => r.result.ok).map((r) => r.id);
    const awardedIds = done(awarded);
    const revokedIds = done(revoked);
    if (awardedIds.length > 0 || revokedIds.length > 0)
      onBadgesChanged(awardedIds, revokedIds);
    const changesForEmail = [...awarded, ...revoked].flatMap((r) =>
      r.result.ok && r.result.change ? [r.result.change] : [],
    );
    // Silent, because the admin toast is a single slot: the email's "sent"
    // label replaced the summary one round trip after it appeared. A refusal
    // still raises its own error toast.
    if (notifyUser && changesForEmail.length > 0) {
      await onAction(
        u.id,
        "notify_account_changes",
        { changes: changesForEmail, notifyUser: true },
        { toast: false },
      );
    }
    const failed = [...awarded, ...revoked].find((r) => !r.result.ok);
    return failed ? { ok: false, error: failed.result.error } : { ok: true };
  };

  // "On this page" jump list: only offer entries whose section actually
  // renders for this caller's permissions, so a support-role viewer never
  // sees a link to a card they can't see below.
  const tocItems: AdminTocItem[] = [
    { id: "profile-overview", label: "Overview" },
    ...(perms.canBanUsers
      ? [{ id: "account-management", label: "Account Management" }]
      : []),
    ...(perms.canManageStaff || perms.canManageBadges
      ? [{ id: "roles-badges", label: "Staff Role & Badges" }]
      : []),
    { id: "admin-notes", label: "Admin Notes" },
    { id: "support-actions", label: "Support Actions" },
    // The jump list stopped at Support Actions, so the one section a phone
    // could not reach without scrolling the whole panel was the destructive
    // one. It renders under the same condition the card does.
    ...(canRunDangerZoneActions
      ? [{ id: "danger-zone", label: "Danger Zone" }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Back + header card */}
      <Card
        id="profile-overview"
        className="border-border/50 bg-card/50 overflow-hidden"
      >
        <CardContent className="p-5">
          {/* Stacks below sm. This was one row at every width, and the
              action column is shrink-0, so on a phone the identity block was
              squeezed to whatever was left: the display name truncated
              mid-word and the Disable account button overlapped it. Above sm
              there is room for both, so the row returns. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="flex min-w-0 items-start gap-3 sm:contents">
              <Button
                variant="outline"
                size="icon"
                // 44px on a phone. This is the only route back to the user
                // list on a touch screen and it was drawn at 32.
                className="-ml-1 -mt-0.5 h-11 w-11 shrink-0 border-border/60 bg-muted/40 sm:h-8 sm:w-8"
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
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    {u.name || "Unnamed User"}
                  </h2>
                  {u.role && u.role !== "user" && ROLE_BADGE_STYLES[u.role] && (
                    <Badge
                      className={cn(
                        ROLE_BADGE_STYLES[u.role],
                        "text-[11px] font-medium",
                      )}
                    >
                      {STAFF_ROLE_LABELS[u.role] || u.role}
                    </Badge>
                  )}
                  {u.disabled_at && (
                    <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[11px] font-medium">
                      Disabled
                    </Badge>
                  )}
                  {u.ai_chat_banned && (
                    <Badge className="bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20 text-[11px] font-medium">
                      AI banned
                    </Badge>
                  )}
                </div>
                {/* wrap-anywhere, not truncate: an admin needs to read the
                  whole address to match it against a support ticket, and a
                  long one on a phone was being cut off with no way to see the
                  rest. */}
                <p className="mt-0.5 wrap-anywhere font-mono text-sm text-muted-foreground">
                  {u.email}
                </p>
              </div>
            </div>

            {/* The account-state toggle lives here, beside the badge that
                reports that state, instead of in the Danger Zone four fifths
                of the way down the panel. It is the most-used support action
                on this screen and it is reversible, unlike the deletions it
                used to sit next to, so grouping it with them was wrong twice
                over: it buried the common case and it made an undoable action
                look permanent. The deletions stay in the Danger Zone card and
                the link beside this button goes straight to them. */}
            {!detailLoading && perms.canBanUsers && (
              <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 gap-1.5",
                    u.disabled_at
                      ? "border-[hsl(var(--success))]/30 text-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/10 hover:text-[hsl(var(--success))]"
                      : "border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive",
                  )}
                  onClick={() =>
                    queueSupportAction(
                      u.disabled_at ? "enable" : "disable",
                      u.disabled_at ? "Re-enable Account" : "Disable Account",
                      u.disabled_at
                        ? `Allow ${u.name || u.email} to log in again`
                        : `Suspend ${u.name || u.email} and force logout all sessions`,
                      u.disabled_at ? "default" : "destructive",
                    )
                  }
                >
                  {u.disabled_at ? (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="text-xs">
                    {u.disabled_at ? "Re-enable account" : "Disable account"}
                  </span>
                </Button>
                <a
                  href="#danger-zone"
                  className="rounded-sm text-[11px] text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Danger zone
                </a>
              </div>
            )}
          </div>

          {detailLoading ? (
            <div
              role="status"
              aria-live="polite"
              aria-label="Loading user details"
            >
              {/* Matches the StatBar the loaded state renders. It used to be
                  a 4-up grid of bordered icon tiles, which is not the shape
                  that arrives, so the card reflowed as the request landed. */}
              <div className="mt-5">
                <StatBarSkeleton segments={4} />
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
              {/* Quick stats. This was a hand-rolled 4-up grid of bordered
                  icon tiles, which meant the same four numbers rendered one
                  way here and another way in the directory a click earlier,
                  and none of them had tabular figures. It is the shared strip
                  now, so the digits align, a zero greys itself, and the two
                  screens agree. --severity-medium was also doing duty as a
                  decorative tone on "API Keys"; severity tokens encode how bad
                  a scan finding is, not how many keys someone has. */}
              <div className="mt-5">
                <StatBar
                  items={[
                    {
                      label: "Scans",
                      value: Number(u.scan_count),
                      icon: Activity,
                      tone: "primary",
                    },
                    {
                      label: "API Keys",
                      value: Number(u.api_key_count),
                      icon: Key,
                      tone: "orange",
                    },
                    {
                      label: "Sessions",
                      value: Number(u.session_count),
                      icon: Globe,
                      tone: "success",
                    },
                    {
                      label: "Joined",
                      value: new Date(u.created_at).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        },
                      ),
                      icon: Clock,
                      tone: "muted",
                    },
                  ]}
                />
              </div>

              {/* Security status */}
              <div className="mt-4 pt-4 border-t border-border/50">
                <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Security
                </p>
                {/* One tone vocabulary: green is satisfied, amber wants a
                    look, red is a real gap, grey is "true but not a verdict".
                    Every chip below now obeys it, which took three passes.
                    2FA once painted from raw emerald-500, the only untokenised
                    colour in a row of tokenised ones. Email and TOS borrowed
                    --severity-high and --severity-medium, which encode how bad
                    a scan finding is, not how bad an account state is. And
                    most recently email, TOS and backup codes all rendered
                    their SATISFIED state in the neutral chip, so a verified
                    account that had agreed to the terms looked identical to
                    one that had done neither and the row said nothing at a
                    glance.

                    2FA absent stays grey on purpose: it is optional here, so
                    its absence is a fact rather than a verdict. */}
                <div className="flex flex-wrap gap-2">
                  <StatusPill
                    tone={u.totp_enabled ? "ok" : "neutral"}
                    icon={u.totp_enabled ? ShieldCheck : ShieldOff}
                    className="px-3 py-1.5 text-xs"
                  >
                    {u.totp_enabled ? "2FA enabled" : "No 2FA"}
                  </StatusPill>
                  {u.totp_enabled && (
                    <StatusPill
                      tone={u.has_backup_codes ? "ok" : "warn"}
                      icon={KeyRound}
                      className="px-3 py-1.5 text-xs"
                    >
                      {u.has_backup_codes
                        ? "Has backup codes"
                        : "No backup codes"}
                    </StatusPill>
                  )}
                  {/* Green when verified, amber when not. It was grey and
                      red: grey said nothing about a satisfied state, and red
                      overstated an unsatisfied one. An unverified address is
                      a thing to look at (recovery will not work, it may be a
                      typo), not a breach, which is what amber means here. */}
                  <StatusPill
                    tone={u.email_verified_at ? "ok" : "warn"}
                    icon={u.email_verified_at ? MailCheck : MailX}
                    className="px-3 py-1.5 text-xs"
                  >
                    {u.email_verified_at
                      ? "Email verified"
                      : "Email unverified"}
                  </StatusPill>
                  <StatusPill
                    tone={u.tos_accepted_at ? "ok" : "warn"}
                    icon={FileText}
                    className="px-3 py-1.5 text-xs"
                  >
                    {u.tos_accepted_at ? "TOS accepted" : "TOS not accepted"}
                  </StatusPill>
                </div>
              </div>

              {/* Connected accounts */}
              <div className="mt-4 pt-4 border-t border-border/50">
                <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                className="h-11 sm:h-7 text-xs gap-1.5"
                onClick={() => setEditing({ kind: "account", userId: u.id })}
                aria-label="Edit account"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
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
                  {/* Not italic. It was the only italic string anywhere in
                        the panel, an orphan idiom for "this value is empty"
                        that nothing else uses. */}
                  {u.name || (
                    <span className="text-muted-foreground">Not set</span>
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
                  {/* text-sm, matching Display Name and Email either side of
                        it. The plan used to render a size smaller than its two
                        neighbours in the same three-up grid, so the one paid
                        fact on the row read as the least important. */}
                  <span className="text-sm font-medium text-foreground flex items-center gap-2">
                    {(() => {
                      const effectivePlan = u.gifted_plan || u.plan;
                      const label = effectivePlan
                        ? getPlanById(effectivePlan)?.name || effectivePlan
                        : "Free";
                      return (
                        <>
                          {label}
                          {u.gifted_plan && (
                            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border border-[hsl(var(--warning))]/25">
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
          </CardContent>
        </Card>
      )}

      {/* Role + Badge management. Gated on the permissions these controls
          actually exercise (EDIT_USER_ROLE for the role change,
          CREATE_BADGE for the badge editor), not on DELETE_USER, which is
          what it used to check: a permission label that does not describe
          what the control does hides it from roles that hold the right and
          shows it to roles that do not. */}
      {!detailLoading && (perms.canManageStaff || perms.canManageBadges) && (
        <div
          id="roles-badges"
          className="grid grid-cols-1 lg:grid-cols-2 gap-4"
        >
          {/* Staff Role */}
          {perms.canManageStaff && (
            <Card className="border-border/50 bg-card/50">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" aria-hidden="true" />
                  <p className="text-sm font-medium">Staff Role</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {hasGodMode(u.role)
                    ? "The super admin's role can't be changed."
                    : "Sets what this person can see and do in the admin panel."}
                </p>
              </CardHeader>
              <CardContent className="p-4 pt-0 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">
                  {STAFF_ROLE_LABELS[u.role || "user"] || u.role}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 sm:h-7 text-xs gap-1.5"
                  disabled={hasGodMode(u.role)}
                  onClick={() => setEditing({ kind: "role", userId: u.id })}
                >
                  <Pencil className="h-3 w-3" aria-hidden="true" />
                  Change role
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Badges */}
          {perms.canManageBadges && (
            <Card className="border-border/50 bg-card/50">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-primary" aria-hidden="true" />
                  <p className="text-sm font-medium">Badges</p>
                  <Badge
                    variant="secondary"
                    className="text-[11px] h-5 ml-auto"
                  >
                    {detail.badges.length} awarded
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cosmetic badges shown on the user&apos;s profile.
                </p>
              </CardHeader>
              <CardContent className="p-4 pt-0 flex flex-col gap-3">
                {detail.badges.length > 0 ? (
                  <ul
                    aria-label="Awarded badges"
                    className="flex flex-wrap gap-1.5"
                  >
                    {detail.badges.map((badge) => (
                      <li
                        key={badge.id}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium"
                        style={{
                          borderColor: `${badge.color}40`,
                          backgroundColor: `${badge.color}15`,
                          color: badge.color || undefined,
                        }}
                      >
                        <Tag className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {badge.display_name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No badges awarded yet.
                  </p>
                )}

                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {/* The dialog is the only way to remove a badge, so an
                      awarded one keeps it reachable when the catalogue did
                      not load. */}
                  {(allBadges.length > 0 || detail.badges.length > 0) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-11 sm:h-7 text-xs gap-1 bg-transparent flex-1"
                      onClick={() =>
                        setEditing({ kind: "badges", userId: u.id })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit badges
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-11 sm:h-7 text-xs gap-1 bg-transparent flex-1"
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
                        className="h-11 sm:h-7 text-xs gap-1 bg-transparent text-destructive border-destructive/30 hover:bg-destructive/10 flex-1"
                        onClick={() => setShowManageBadges(true)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                        Manage Badges
                      </Button>
                    )}
                </div>

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
                  <DialogContent variant="shell" size="sm">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Plus
                          className="h-4 w-4 text-primary"
                          aria-hidden="true"
                        />{" "}
                        Create New Badge
                      </DialogTitle>
                    </DialogHeader>
                    <DialogBody className="flex flex-col gap-4">
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
                        <label
                          htmlFor={badgeIdFieldId}
                          className="text-xs font-medium"
                        >
                          Badge ID{" "}
                          <span className="text-muted-foreground">
                            (internal name)
                          </span>
                        </label>
                        <Input
                          id={badgeIdFieldId}
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
                        <label
                          htmlFor={badgeDisplayFieldId}
                          className="text-xs font-medium"
                        >
                          Display Name
                        </label>
                        <Input
                          id={badgeDisplayFieldId}
                          placeholder="e.g. Power User"
                          value={newBadgeDisplay}
                          onChange={(e) => setNewBadgeDisplay(e.target.value)}
                          className="h-9 border-border/40"
                        />
                      </div>
                      {/* Color picker */}
                      <div className="flex flex-col gap-2">
                        <p
                          id={badgeColorLabelId}
                          className="text-xs font-medium"
                        >
                          Color
                        </p>
                        <div
                          role="group"
                          aria-labelledby={badgeColorLabelId}
                          className="flex flex-wrap gap-2"
                        >
                          {/* A badge colour is author-chosen content, so these
                              hexes are deliberately outside the theme. The set
                              was still wrong: it offered Green, Emerald, Teal
                              and Cyan, four swatches most people cannot tell
                              apart at 28px, and Cyan is the exact hue this
                              product spent a release removing from its own
                              chrome. Twelve distinguishable steps instead, and
                              anything else still goes through the native
                              picker below. */}
                          {[
                            { color: "#ef4444", name: "Red" },
                            { color: "#f97316", name: "Orange" },
                            { color: "#eab308", name: "Yellow" },
                            { color: "#22c55e", name: "Green" },
                            { color: "#14b8a6", name: "Teal" },
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
                              // Selection was carried by a 2px border plus a
                              // 10% scale, which is close to invisible on a
                              // dark swatch and told a screen reader nothing.
                              aria-pressed={newBadgeColor === c.color}
                              className={cn(
                                "w-7 h-7 rounded-full",
                                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                                newBadgeColor === c.color
                                  ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                                  : "hover:ring-2 hover:ring-border hover:ring-offset-2 hover:ring-offset-background",
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
                              className="w-7 h-7 rounded-full border-2 border-border/50 shrink-0 transition-colors hover:border-border"
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
                            aria-label="Badge colour hex value"
                            className="h-8 text-xs font-mono w-32 border-border/40"
                            maxLength={7}
                          />
                          <p className="text-xs text-muted-foreground">
                            Click swatch for full picker
                          </p>
                        </div>
                      </div>
                    </DialogBody>
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
                    <DialogContent variant="shell" size="sm">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <Trash2
                            className="h-4 w-4 text-destructive"
                            aria-hidden="true"
                          />{" "}
                          Manage All Badges
                        </DialogTitle>
                      </DialogHeader>
                      <DialogBody className="flex flex-col gap-3">
                        {/* Inline delete confirmation */}
                        {pendingDeleteBadge ? (
                          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex flex-col gap-3">
                            <div className="flex items-start gap-3">
                              <LeadingIcon
                                line="sm"
                                icon={AlertTriangle}
                                className="text-destructive"
                              />
                              <div>
                                <p className="text-sm font-medium text-foreground">
                                  Delete &quot;{pendingDeleteBadge.display_name}
                                  &quot;?
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  This will permanently remove the badge from
                                  the system and revoke it from all users who
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
                            {/* No max-h-72 overflow-y-auto here any more: the
                                shell's body band is the scroller, and capping
                                the list inside it put a second scrollbar
                                against the first. */}
                            {allBadges.length > 0 ? (
                              <div className="flex flex-col gap-2">
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
                                      className="h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-7 sm:w-7"
                                      onClick={() =>
                                        setPendingDeleteBadge(badge)
                                      }
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
                      </DialogBody>
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
          )}
        </div>
      )}

      {/* Admin Notes */}
      {!detailLoading && (
        <Card id="admin-notes" className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-primary" aria-hidden="true" />
              <p className="text-sm font-medium">Admin Notes</p>
              <Badge variant="secondary" className="text-[11px] h-5 ml-auto">
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
                aria-label="New admin note"
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
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(new Date(note.created_at))}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap wrap-break-word">
                        {note.note}
                      </p>
                    </div>
                    {/* md: prefix on the fade below: touch devices have no
                        hover, so an unprefixed opacity-0 left these note
                        actions permanently invisible while still
                        hit-testable. Below md they are always shown. */}
                    <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() =>
                          setEditingNote({
                            id: note.id,
                            text: note.note,
                            userId: u.id,
                          })
                        }
                        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-7 sm:w-7"
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
                        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive sm:h-7 sm:w-7"
                        aria-label="Delete note"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
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
                {!canRunSupportActions
                  ? "Account Information"
                  : "Support Actions"}
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {!canRunSupportActions ? (
              <p className="text-xs text-muted-foreground">
                You have view-only access. Contact an admin or moderator to
                perform actions on this user.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Session & Security */}
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Session &amp; Security
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <GatedActionCard
                      icon={LogOut}
                      label="Force Logout"
                      description={`Revoke all ${pluralize(u.session_count, "active session")}`}
                      color="text-primary"
                      bg="bg-primary/10"
                      loading={isLoading("revoke_sessions")}
                      action="revoke_sessions"
                      callerRole={callerRole}
                      onClick={() =>
                        queueSupportAction(
                          "revoke_sessions",
                          "Force Logout",
                          `Revoke all ${pluralize(u.session_count, "active session")} for ${u.name || u.email}`,
                        )
                      }
                    />
                    <GatedActionCard
                      icon={Key}
                      label="Revoke API Keys"
                      description={`Invalidate all ${u.api_key_count} API key${u.api_key_count === 1 ? "" : "s"}. They cannot be recovered.`}
                      color="text-destructive"
                      bg="bg-destructive/10"
                      // A revoked key is gone: the user has to issue a new one
                      // and update whatever was calling us with the old one.
                      // It rendered with a plain neutral border, the same as
                      // "Reset AI Usage".
                      variant="danger"
                      loading={isLoading("revoke_api_keys")}
                      action="revoke_api_keys"
                      callerRole={callerRole}
                      onClick={() =>
                        queueSupportAction(
                          "revoke_api_keys",
                          "Revoke API Keys",
                          `Invalidate all ${pluralize(u.api_key_count, "API key")} for ${u.name || u.email}`,
                        )
                      }
                    />
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.RESET_USER_PASSWORD,
                    ) && (
                      <GatedActionCard
                        icon={KeyRound}
                        label="Reset Password"
                        description={
                          u.totp_enabled
                            ? "Unavailable: 2FA enabled"
                            : "Email a reset link"
                        }
                        color="text-[hsl(var(--warning))]"
                        bg="bg-[hsl(var(--warning))]/10"
                        disabled={u.totp_enabled}
                        loading={isLoading("reset_password")}
                        action="reset_password"
                        callerRole={callerRole}
                        onClick={() =>
                          queueSupportAction(
                            "reset_password",
                            "Reset Password",
                            `Send a password reset link to ${u.name || u.email}. They set their own new password, so you never see it.`,
                          )
                        }
                      />
                    )}
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.RESET_USER_2FA,
                    ) && (
                      <GatedActionCard
                        icon={Smartphone}
                        label="Issue 2FA Recovery Code"
                        description={
                          !u.totp_enabled
                            ? "Unavailable: 2FA is off"
                            : "Email a one-time backup code"
                        }
                        color="text-[hsl(var(--warning))]"
                        bg="bg-[hsl(var(--warning))]/10"
                        variant="danger"
                        disabled={!u.totp_enabled}
                        loading={isLoading("issue_2fa_recovery_code")}
                        action="issue_2fa_recovery_code"
                        callerRole={callerRole}
                        onClick={() =>
                          queueSupportAction(
                            "issue_2fa_recovery_code",
                            "Issue 2FA Recovery Code",
                            `Email ${u.name || u.email} one backup code at their own verified address. You never see it, their existing backup codes stop working, and two-factor authentication stays on.`,
                            "destructive",
                          )
                        }
                      />
                    )}
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.MANAGE_RATE_LIMITS,
                    ) && (
                      <GatedActionCard
                        icon={RefreshCw}
                        label="Clear Rate Limits"
                        description="Reset rate limit counters"
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("clear_rate_limits")}
                        action="clear_rate_limits"
                        callerRole={callerRole}
                        onClick={() =>
                          queueSupportAction(
                            "clear_rate_limits",
                            "Clear Rate Limits",
                            `Reset rate limit counters for ${u.name || u.email}`,
                          )
                        }
                      />
                    )}
                    <GatedActionCard
                      icon={UserX}
                      label="Force Logout All"
                      description="Ends every session and revokes every API key"
                      color="text-destructive"
                      bg="bg-destructive/10"
                      variant="danger"
                      loading={isLoading("force_logout_all")}
                      action="force_logout_all"
                      callerRole={callerRole}
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
                      <GatedActionCard
                        icon={UserCog}
                        label="Impersonate"
                        description={
                          (STAFF_ROLE_HIERARCHY[u.role || "user"] ?? 0) > 0
                            ? "Unavailable: staff account"
                            : "Sign in as this user"
                        }
                        color="text-[hsl(var(--warning))]"
                        bg="bg-[hsl(var(--warning))]/10"
                        // Signing in as another human, for an hour, on their
                        // behalf. It carried no variant at all, so it rendered
                        // with a plain neutral border: quieter than "Delete
                        // Schedules" sitting two groups below it. amber-500
                        // was also the only raw palette colour in this grid.
                        variant="danger"
                        disabled={
                          (STAFF_ROLE_HIERARCHY[u.role || "user"] ?? 0) > 0
                        }
                        loading={isLoading("impersonate")}
                        action="impersonate"
                        callerRole={callerRole}
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

                {/* Sits directly under Session & Security, because it is the
                    explanation for the greyed-out "Reset Password" card two
                    rows above it. It used to be the very last element of this
                    card, below the entire Danger Zone, roughly 500 lines from
                    the control it explains. */}
                {u.totp_enabled && (
                  <div className="flex items-start gap-2.5 p-3 rounded-md bg-[hsl(var(--warning))]/10 border border-[hsl(var(--warning))]/30">
                    <LeadingIcon
                      icon={AlertTriangle}
                      line="relaxed"
                      className="text-[hsl(var(--warning))]"
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

                {/* Usage & Limits */}
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Usage &amp; Limits
                  </p>
                  <UsageReadout usage={detail.usage} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {hasStaffPermission(
                      callerRole,
                      STAFF_PERMISSIONS.RESET_USER_DAILY_LIMIT,
                    ) && (
                      <GatedActionCard
                        icon={Gauge}
                        label="Reset Daily Scan Limit"
                        description="Zero today's scan count"
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("reset_daily_limit")}
                        action="reset_daily_limit"
                        callerRole={callerRole}
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
                      <GatedActionCard
                        icon={Sparkles}
                        label="Reset AI Usage"
                        description="Zero the current AI usage window"
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("reset_ai_usage")}
                        action="reset_ai_usage"
                        callerRole={callerRole}
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
                      <GatedActionCard
                        icon={FaGithub}
                        label="Reset GitHub Review Usage"
                        description="Zero the current GitHub review window"
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("reset_github_review_usage")}
                        action="reset_github_review_usage"
                        callerRole={callerRole}
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
                      <GatedActionCard
                        icon={Clock}
                        label="Reset Free GitHub Trial"
                        description="Let today's free review run again now"
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("reset_free_github_trial")}
                        action="reset_free_github_trial"
                        callerRole={callerRole}
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

                {/* Credits. Purchased AI/GitHub review token balances and
                    browser session minutes -- gated on GRANT_CREDITS rather
                    than per-card like the resets above, since the whole
                    section is one capability (see the server's matching
                    canSeeCredits gate in app/api/v3/admin/route.ts's
                    section=user-detail branch, which is why detail.credits
                    is only ever non-null when this check passes). */}
                {hasStaffPermission(
                  callerRole,
                  STAFF_PERMISSIONS.GRANT_CREDITS,
                ) && (
                  <div id="credits">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Credits
                    </p>
                    <div className="rounded-lg border border-border/50 bg-card/50 p-4 sm:p-5 flex flex-col gap-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            AI tokens
                          </p>
                          <p className="text-sm font-medium text-foreground">
                            {(
                              detail.credits?.aiCreditBalance ?? 0
                            ).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            GitHub review tokens
                          </p>
                          <p className="text-sm font-medium text-foreground">
                            {(
                              detail.credits?.githubCreditBalance ?? 0
                            ).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Browser minutes
                          </p>
                          <p className="text-sm font-medium text-foreground">
                            {Math.floor(
                              (detail.credits
                                ?.browserbaseCreditSecondsBalance ?? 0) / 60,
                            ).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="pt-3 border-t border-border/40">
                        <FilterChips
                          options={[
                            { id: "grant", label: "Grant" },
                            { id: "remove", label: "Remove" },
                          ]}
                          value={creditMode}
                          onChange={setCreditMode}
                          label="Add credits or remove them"
                        />
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={creditTypeFieldId}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            Type
                          </label>
                          <select
                            id={creditTypeFieldId}
                            value={creditGrantType}
                            onChange={(e) =>
                              setCreditGrantType(
                                e.target.value as "ai" | "github" | "browser",
                              )
                            }
                            className={NATIVE_SELECT_CLASS}
                          >
                            <option value="ai">AI tokens</option>
                            <option value="github">GitHub review tokens</option>
                            <option value="browser">Browser minutes</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={creditAmountFieldId}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            Amount (
                            {creditGrantType === "browser"
                              ? "minutes"
                              : "tokens"}
                            )
                          </label>
                          <Input
                            id={creditAmountFieldId}
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            value={creditGrantAmount}
                            onChange={(e) =>
                              setCreditGrantAmount(e.target.value)
                            }
                            className="h-9 w-28 text-sm"
                          />
                        </div>
                        <div className="flex flex-col gap-1 flex-1">
                          <label
                            htmlFor={creditReasonFieldId}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            Reason
                          </label>
                          <Input
                            id={creditReasonFieldId}
                            value={creditGrantReason}
                            onChange={(e) =>
                              setCreditGrantReason(e.target.value)
                            }
                            placeholder={
                              creditMode === "remove"
                                ? "Why is this being removed?"
                                : "Why is this being granted?"
                            }
                            maxLength={200}
                            className="h-9 text-sm"
                          />
                        </div>
                        <Button
                          size="sm"
                          variant={
                            creditMode === "remove" ? "destructive" : "default"
                          }
                          className="h-9 gap-1.5"
                          disabled={
                            !creditGrantAmount.trim() ||
                            !creditGrantReason.trim() ||
                            isLoading("grant_credits") ||
                            isLoading("adjust_credits")
                          }
                          onClick={changeCredits}
                        >
                          {isLoading("grant_credits") ||
                          isLoading("adjust_credits") ? (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <Coins className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {creditMode === "remove" ? "Remove" : "Grant"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Account State. Deliberately NOT "Account Management":
                    that is the name of a different card higher up the page
                    (id="account-management"), and the jump list at tocItems
                    offers it as a destination, so two groups with the same
                    heading sent the reader to the wrong one. */}
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Account State
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <GatedActionCard
                      action={
                        u.email_verified_at ? "unverify_email" : "verify_email"
                      }
                      callerRole={callerRole}
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
                    {!u.email_verified_at && (
                      <GatedActionCard
                        action="resend_verification"
                        callerRole={callerRole}
                        icon={MailCheck}
                        label="Resend Verification"
                        description="Email a fresh verification link"
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("resend_verification")}
                        onClick={() =>
                          queueSupportAction(
                            "resend_verification",
                            "Resend Verification",
                            `Email a new verification link to ${u.email}`,
                          )
                        }
                      />
                    )}
                    <GatedActionCard
                      icon={ImageOff}
                      label="Clear Avatar"
                      description="Remove profile picture"
                      color="text-muted-foreground"
                      bg="bg-muted/50"
                      loading={isLoading("clear_avatar")}
                      action="clear_avatar"
                      callerRole={callerRole}
                      onClick={() =>
                        queueSupportAction(
                          "clear_avatar",
                          "Clear Avatar",
                          `Remove profile picture for ${u.name || u.email}`,
                        )
                      }
                    />
                    <GatedActionCard
                      action="send_notification"
                      callerRole={callerRole}
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
                    <DialogContent variant="shell" size="sm">
                      <DialogHeader>
                        <DialogTitle>Send Notification</DialogTitle>
                      </DialogHeader>
                      <DialogBody className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1.5">
                          <label
                            htmlFor={notifTitleId}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            Title
                          </label>
                          <Input
                            id={notifTitleId}
                            placeholder="e.g. Account Update"
                            value={notifTitle}
                            onChange={(e) => setNotifTitle(e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label
                            htmlFor={notifMessageId}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            Message
                          </label>
                          <Textarea
                            id={notifMessageId}
                            placeholder="Message to send to the user"
                            value={notifMessage}
                            onChange={(e) => setNotifMessage(e.target.value)}
                            rows={4}
                            className="resize-none"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          This will send an email notification to {u.email}.
                        </p>
                      </DialogBody>
                      <DialogFooter>
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
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Gifted Subscription
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {giftActive && u.gifted_plan && u.gift_end_date ? (
                      <GatedActionCard
                        action="gift_subscription"
                        callerRole={callerRole}
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
                      <GatedActionCard
                        action="gift_subscription"
                        callerRole={callerRole}
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
                      giftActive && u.gifted_plan && u.gift_end_date
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
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Danger Zone.
          It used to be the sixth sub-group inside the Support Actions card,
          separated from "reset a usage counter" by nothing but a 10px
          70%-opacity label, roughly four fifths of the way down a 3,000-line
          panel, with no id and no entry in the jump list: nothing on the page
          could take you to it. It is its own card now, with a red outline and
          a sentence saying what the group means, and the profile header at the
          top of the panel carries a link straight to it, so the most-used
          action in it is reachable from the first viewport.
          Two of these cards undo a dangerous state rather than causing one
          (re-enable, unban), which is why they keep the success variant: they
          belong beside the action they reverse, not in a separate group. */}
      {!detailLoading && canRunDangerZoneActions && (
        <Card
          id="danger-zone"
          className="border-destructive/30 bg-destructive/[0.03]"
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle
                className="h-4 w-4 text-destructive"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-destructive">
                Danger zone
              </p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              These change or remove access. Everything here asks for your own
              password first, and the deletions cannot be undone.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {/* Disable / re-enable is NOT here: it moved to the profile
                  header, next to the badge that reports the state it toggles.
                  What is left in this card is the set of things nobody can
                  take back. */}
              <GatedActionCard
                icon={BotOff}
                label={
                  u.ai_chat_banned ? "Unban from AI Chat" : "Ban from AI Chat"
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
                action="toggle_ai_ban"
                callerRole={callerRole}
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
                <GatedActionCard
                  icon={Activity}
                  label="Delete All Scans"
                  description={`Remove all ${pluralize(u.scan_count, "scan")}`}
                  color="text-destructive"
                  bg="bg-destructive/10"
                  variant="danger"
                  loading={isLoading("delete_scans")}
                  action="delete_scans"
                  callerRole={callerRole}
                  onClick={() =>
                    queueSupportAction(
                      "delete_scans",
                      "Delete All Scans",
                      // The host pages are public and unauthenticated, so
                      // "all scans" that left them standing read as a
                      // takedown that had not happened.
                      `Remove all ${pluralize(u.scan_count, "scan")} for ${u.name || u.email}${
                        u.public_host_report_count
                          ? `, and take down the ${pluralize(u.public_host_report_count, "public host report")} built from them`
                          : ""
                      }. This cannot be undone.`,
                      "destructive",
                    )
                  }
                />
              )}
              <GatedActionCard
                icon={Webhook}
                label="Delete Webhooks"
                description="Remove all webhooks"
                color="text-destructive"
                bg="bg-destructive/10"
                variant="danger"
                loading={isLoading("delete_webhooks")}
                action="delete_webhooks"
                callerRole={callerRole}
                onClick={() =>
                  queueSupportAction(
                    "delete_webhooks",
                    "Delete Webhooks",
                    `Remove all webhooks for ${u.name || u.email}`,
                    "destructive",
                  )
                }
              />
              <GatedActionCard
                icon={CalendarOff}
                label="Delete Schedules"
                description="Remove scheduled scans"
                color="text-destructive"
                bg="bg-destructive/10"
                variant="danger"
                loading={isLoading("delete_schedules")}
                action="delete_schedules"
                callerRole={callerRole}
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
                <GatedActionCard
                  icon={Trash2}
                  label="Delete Account"
                  description="Permanently remove user"
                  color="text-destructive"
                  bg="bg-destructive/10"
                  variant="danger"
                  // The only destructive card here without one, while its
                  // three neighbours all pass it. The delete runs a
                  // transaction across roughly thirty tables, and the button
                  // stayed live throughout: a second click fired a second
                  // request, which 404s "User not found" once the first
                  // commits, so the operator saw a red error for a deletion
                  // that had fully succeeded.
                  loading={isLoading("delete")}
                  action="delete"
                  callerRole={callerRole}
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
          </CardContent>
        </Card>
      )}

      {/* Info section - Recent Scans, API Keys, Webhooks, Active Sessions.
          Three of the four ride on their own grant rather than on VIEW_USERS:
          scan rows are the target's browsing history, key rows name live
          credentials, and session rows carry their last-known IPs. The route
          (app/api/v3/admin/route.ts, section=user-detail) returns an empty
          array for each one the caller isn't granted, so without these gates
          a role like billing saw a confident "No API keys" instead of nothing
          at all. Hide the card, don't render an empty state that reads as a
          fact about the user. */}
      {!detailLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent Scans */}
          {hasStaffPermission(callerRole, STAFF_PERMISSIONS.VIEW_ALL_SCANS) && (
            <Card className="border-border/50 bg-card/50">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Activity
                    className="h-4 w-4 text-primary"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium">Recent Scans</p>
                  <Badge
                    variant="secondary"
                    className="text-[11px] h-5 ml-auto"
                  >
                    {detail.recentScans?.length || 0}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {detail.recentScans && detail.recentScans.length > 0 ? (
                  <div className="flex flex-col max-h-64 overflow-y-auto">
                    {detail.recentScans.map((scan) => {
                      // A finished scan is the normal row and carries no pill
                      // (absence is the healthy state, as in the user table).
                      // Everything else says what it is, because a failed,
                      // cancelled or pending scan has 0 findings exactly like
                      // a clean one.
                      const pill =
                        scan.status === "completed"
                          ? null
                          : scanStatusPill(scan);
                      return (
                        <Link
                          key={scan.id}
                          href={ROUTES.ADMIN_SCAN(scan.public_id ?? scan.id)}
                          aria-label={`Inspect the scan of ${scan.url}`}
                          className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <Globe
                            className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                            aria-hidden="true"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium font-mono truncate">
                              {scan.url}
                            </p>
                            {/* The findings count is the one number on a scan
                              row that says whether the scan is interesting,
                              and it used to be the same 10px grey as the word
                              "findings" beside it, so 0 and 47 read the same. */}
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              {pill ? (
                                <StatusPill tone={pill.tone}>
                                  {pill.label}
                                </StatusPill>
                              ) : (
                                <span>
                                  <span
                                    className={cn(
                                      "font-mono tabular-nums",
                                      scan.findings_count > 0 &&
                                        "font-medium text-foreground",
                                    )}
                                  >
                                    {scan.findings_count}
                                  </span>{" "}
                                  findings
                                </span>
                              )}
                              <span aria-hidden="true">&middot;</span>
                              <span>{scan.source}</span>
                            </div>
                          </div>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {new Date(scan.scanned_at).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                              },
                            )}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={Activity}
                    title="No recent scans"
                    className="py-8"
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* API Keys */}
          {hasStaffPermission(
            callerRole,
            STAFF_PERMISSIONS.VIEW_USER_API_KEYS,
          ) && (
            <Card className="border-border/50 bg-card/50">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-primary" aria-hidden="true" />
                  <p className="text-sm font-medium">API Keys</p>
                  <Badge
                    variant="secondary"
                    className="text-[11px] h-5 ml-auto"
                  >
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
                          className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <Key
                            className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                            aria-hidden="true"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium">
                              {key.name || "Unnamed Key"}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-mono">
                              {key.key_prefix}...
                            </p>
                          </div>
                          {/* A live credential nobody has ever called is
                              worth a second look; it read as the same grey as
                              "3 days ago". */}
                          <span
                            className={cn(
                              "text-[11px] shrink-0 tabular-nums",
                              key.last_used_at
                                ? "text-muted-foreground"
                                : "text-[hsl(var(--warning))]",
                            )}
                          >
                            {key.last_used_at
                              ? formatRelativeTime(new Date(key.last_used_at))
                              : "Never used"}
                          </span>
                          {/* Revoke THIS key. The danger zone's "Revoke API
                              Keys" revokes every key the account holds, which
                              was the only answer this panel had to "one of my
                              keys leaked": it took down every other
                              integration with it. Same permission, same
                              password prompt, one key. */}
                          {hasStaffPermission(
                            callerRole,
                            STAFF_PERMISSIONS.REVOKE_USER_API_KEYS,
                          ) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                              disabled={isLoading("revoke_api_key")}
                              title={`Revoke ${key.name || "this key"}`}
                              aria-label={`Revoke API key ${key.key_prefix}`}
                              onClick={() =>
                                queueSupportAction(
                                  "revoke_api_key",
                                  "Revoke API Key",
                                  `Invalidate the key ${key.key_prefix}... for ${u.name || u.email}. Their other keys keep working.`,
                                  "destructive",
                                  { keyId: key.id },
                                )
                              }
                            >
                              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      ))}
                  </div>
                ) : (
                  <EmptyState icon={Key} title="No API keys" className="py-8" />
                )}
              </CardContent>
            </Card>
          )}

          {/* Webhooks */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium">Webhooks</p>
                <Badge variant="secondary" className="text-[11px] h-5 ml-auto">
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
                      className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <Webhook
                        className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{webhook.name}</p>
                        <p className="text-[11px] text-muted-foreground font-mono truncate">
                          {webhook.url_host}
                        </p>
                      </div>
                      {/* This was the loudest badge on the whole panel, a
                          solid bg-primary fill, for the most ordinary state a
                          webhook can be in. Everything else here uses the soft
                          tinted idiom, so "Active" shouted while "Disabled"
                          on the account above it whispered. */}
                      <StatusPill
                        tone={webhook.active ? "ok" : "neutral"}
                        className="shrink-0 text-[11px]"
                      >
                        {webhook.active ? "Active" : "Inactive"}
                      </StatusPill>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Webhook}
                  title="No webhooks configured"
                  className="py-8"
                />
              )}
            </CardContent>
          </Card>

          {/* Active Sessions */}
          {hasStaffPermission(
            callerRole,
            STAFF_PERMISSIONS.VIEW_USER_SESSIONS,
          ) && (
            <Card className="border-border/50 bg-card/50">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" aria-hidden="true" />
                  <p className="text-sm font-medium">Active Sessions</p>
                  <Badge
                    variant="secondary"
                    className="text-[11px] h-5 ml-auto"
                  >
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
                        className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <Globe
                          className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                          aria-hidden="true"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium font-mono">
                            {session.id.slice(0, 12)}...
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            <span className="font-mono">
                              {session.ip_address || "Unknown IP"}
                            </span>{" "}
                            &middot;{" "}
                            {session.user_agent
                              ? session.user_agent.length > 40
                                ? `${session.user_agent.slice(0, 40)}…`
                                : session.user_agent
                              : "Unknown device"}
                          </p>
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0">
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
                  <EmptyState
                    icon={Globe}
                    title="No active sessions"
                    className="py-8"
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Account history. Behind the grant section=audit enforces, and
              full width: its rows are sentences, which want the room. */}
          {hasStaffPermission(callerRole, STAFF_PERMISSIONS.VIEW_AUDIT_LOG) && (
            <div className="lg:col-span-2">
              <AccountHistory userId={u.id} />
            </div>
          )}
        </div>
      )}

      {/* Edit dialogs. Mounted here, at the panel root, and never inside a
          card: a successful action refetches the user, which sets
          detailLoading and unmounts every card mid-save. */}
      {isEditing("account") && perms.canBanUsers && (
        <EditAccountDialog
          key={u.id}
          user={u}
          canEditEmailAndPlan={perms.canManageStaff}
          onSave={saveAccountChanges}
          onClose={closeEditing}
        />
      )}
      {isEditing("role") && perms.canManageStaff && !hasGodMode(u.role) && (
        <ChangeStaffRoleDialog
          key={u.id}
          user={u}
          onSave={saveAccountChanges}
          onClose={closeEditing}
        />
      )}
      {isEditing("badges") && perms.canManageBadges && (
        <EditBadgesDialog
          key={u.id}
          user={u}
          awarded={detail.badges}
          allBadges={allBadges}
          onSave={saveBadgeChanges}
          onClose={closeEditing}
        />
      )}
      {editingNote &&
        detail.notes?.some((note) => note.id === editingNote.id) && (
          <EditNoteDialog
            key={editingNote.id}
            note={editingNote}
            onSave={(text) =>
              onAction(u.id, "edit_note", {
                noteId: editingNote.id,
                note: text,
              })
            }
            onClose={() => setEditingNote(null)}
          />
        )}

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
