"use client"

import { useState, useEffect } from "react"
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
  CheckCircle2,
  ClipboardCopy,
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
  CalendarClock,
  Save,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { STAFF_ROLE_LABELS, ROLE_BADGE_STYLES } from "@/lib/constants"
import { hasStaffPermission, STAFF_PERMISSIONS } from "@/lib/permissions-client"
import { SaveConfirmationModal, type ChangeItem, type AffectedUser } from "@/components/save-confirmation-modal"
import type { UserDetail, BadgeDef } from "@/components/admin/types"
import { formatRelativeTime } from "@/components/admin/utils"
import { UserAvatar, ActionCard } from "@/components/admin/shared"
import { GiftSubscriptionModal } from "./gift-subscription-modal"

interface UserDetailPanelProps {
  detail: UserDetail
  detailLoading: boolean
  actionLoading: string | null
  onClose: () => void
  onAction: (userId: number, action: string, extra?: Record<string, unknown>) => Promise<void>
  tempPassword: string | null
  onClearTempPassword: () => void
  callerRole: string
  allBadges: BadgeDef[]
  onRefreshBadges: () => void
  onBadgesChanged: (awardedIds: number[], revokedIds: number[]) => void
}

export function UserDetailPanel({
  detail,
  detailLoading,
  actionLoading,
  onClose,
  onAction,
  tempPassword,
  onClearTempPassword,
  callerRole,
  allBadges,
  onRefreshBadges,
  onBadgesChanged,
}: UserDetailPanelProps) {
  const u = detail.user
  const isLoading = (action: string) => actionLoading === `${u.id}-${action}`
  const [showBadgePicker, setShowBadgePicker] = useState(false)
  const [showCreateBadge, setShowCreateBadge] = useState(false)
  const [showManageBadges, setShowManageBadges] = useState(false)
  const [newNote, setNewNote] = useState("")
  const [editingNote, setEditingNote] = useState<{ id: number; text: string } | null>(null)
  const [newBadgeName, setNewBadgeName] = useState("")
  const [newBadgeDisplay, setNewBadgeDisplay] = useState("")
  const [newBadgeColor, setNewBadgeColor] = useState("#6366f1")
  const [pendingDeleteBadge, setPendingDeleteBadge] = useState<BadgeDef | null>(null)
  const [pendingDeleteNote, setPendingDeleteNote] = useState<{ id: number; text: string } | null>(null)

  const awardedIds = new Set(detail.badges.map((b) => b.id))
  const unawardedBadges = allBadges.filter((b) => !awardedIds.has(b.id))

  // Pending changes state - batch all changes and save together
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown>>({})
  const [pendingBadgeAwards, setPendingBadgeAwards] = useState<number[]>([])
  const [pendingBadgeRevokes, setPendingBadgeRevokes] = useState<number[]>([])
  const [accountEditMode, setAccountEditMode] = useState(false)
  const [editName, setEditName] = useState(u.name || "")
  const [editEmail, setEditEmail] = useState(u.email)
  const [editPlan, setEditPlan] = useState(u.plan || "free")
  const [editRole, setEditRole] = useState(u.role || "user")
  const [confirmEmail, setConfirmEmail] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [showGiftModal, setShowGiftModal] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [notifyUserOnSave, setNotifyUserOnSave] = useState(true)
  
  // Support action confirmation state
  const [pendingSupportAction, setPendingSupportAction] = useState<{
    action: string
    label: string
    description: string
    variant?: "default" | "destructive"
    extraPayload?: Record<string, unknown>
  } | null>(null)

  // Track if there are unsaved changes
  const hasChanges = Object.keys(pendingChanges).length > 0 || pendingBadgeAwards.length > 0 || pendingBadgeRevokes.length > 0
  
  // Build changes array for the modal
  const modalChanges: ChangeItem[] = [
    ...(pendingChanges.name !== undefined ? [{ field: "name", label: "Display Name", oldValue: u.name || "", newValue: pendingChanges.name as string }] : []),
    ...(pendingChanges.email !== undefined ? [{ field: "email", label: "Email Address", oldValue: u.email, newValue: pendingChanges.email as string }] : []),
    ...(pendingChanges.plan !== undefined ? [{ field: "plan", label: "Subscription Plan", oldValue: u.plan || "free", newValue: pendingChanges.plan as string }] : []),
    ...(pendingChanges.role !== undefined ? [{ field: "role", label: "Staff Role", oldValue: u.role || "user", newValue: pendingChanges.role as string }] : []),
    ...(pendingBadgeAwards.length > 0 ? [{ field: "badges", label: "Badges to Award", oldValue: "", newValue: `+${pendingBadgeAwards.length} badge${pendingBadgeAwards.length !== 1 ? "s" : ""}` }] : []),
    ...(pendingBadgeRevokes.length > 0 ? [{ field: "badges", label: "Badges to Remove", oldValue: `${pendingBadgeRevokes.length} badge${pendingBadgeRevokes.length !== 1 ? "s" : ""}`, newValue: "" }] : []),
  ]
  
  const affectedUser: AffectedUser = { id: u.id, email: u.email, name: u.name || undefined }

  // Reset pending changes when user changes
  useEffect(() => {
    setPendingChanges({})
    setPendingBadgeAwards([])
    setPendingBadgeRevokes([])
    setEditName(u.name || "")
    setEditEmail(u.email)
    setEditPlan(u.plan || "free")
    setEditRole(u.role || "user")
    setConfirmEmail("")
  }, [u.id, u.name, u.email, u.plan, u.role])

  // Add a change to pending
  const addPendingChange = (key: string, value: unknown, originalValue: unknown) => {
    if (value === originalValue) {
      setPendingChanges((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    } else {
      setPendingChanges((prev) => ({ ...prev, [key]: value }))
    }
  }

  // Queue a support action for confirmation
  const queueSupportAction = (action: string, label: string, description: string, variant?: "default" | "destructive", extraPayload?: Record<string, unknown>) => {
    setPendingSupportAction({ action, label, description, variant, extraPayload })
  }
  
  // Execute the pending support action
  const executeSupportAction = async (notifyUser: boolean) => {
    if (!pendingSupportAction) return
    await onAction(u.id, pendingSupportAction.action, { 
      ...pendingSupportAction.extraPayload, 
      notifyUser 
    })
    setPendingSupportAction(null)
  }

  // Save all pending changes
  const saveAllChanges = async () => {
    setIsSaving(true)
    try {
      for (const [key, value] of Object.entries(pendingChanges)) {
        if (key === "name") await onAction(u.id, "update_name", { name: value as string, notifyUser: notifyUserOnSave })
        else if (key === "email") await onAction(u.id, "update_email", { email: value as string, notifyUser: notifyUserOnSave })
        else if (key === "plan") await onAction(u.id, "update_plan", { plan: value as string, notifyUser: notifyUserOnSave })
        else if (key === "role") await onAction(u.id, "set_role", { role: value as string, notifyUser: notifyUserOnSave })
      }
      const awardedThisSave = [...pendingBadgeAwards]
      const revokedThisSave = [...pendingBadgeRevokes]
      if (awardedThisSave.length > 0 || revokedThisSave.length > 0) {
        await Promise.all([
          ...awardedThisSave.map((id) => onAction(u.id, "award_badge", { badgeId: String(id), notifyUser: notifyUserOnSave })),
          ...revokedThisSave.map((id) => onAction(u.id, "revoke_badge", { badgeId: String(id), notifyUser: notifyUserOnSave })),
        ])
        onBadgesChanged(awardedThisSave, revokedThisSave)
      }
      setPendingChanges({})
      setPendingBadgeAwards([])
      setPendingBadgeRevokes([])
    } finally {
      setIsSaving(false)
    }
  }

  // Discard all changes
  const discardChanges = () => {
    setPendingChanges({})
    setPendingBadgeAwards([])
    setPendingBadgeRevokes([])
    setEditName(u.name || "")
    setEditEmail(u.email)
    setEditPlan(u.plan || "free")
    setEditRole(u.role || "user")
    setConfirmEmail("")
  }

  // Handle save button click - open confirmation modal
  const handleSaveClick = () => {
    setShowSaveModal(true)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Back + header card */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 -ml-1 -mt-0.5" onClick={onClose}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <UserAvatar name={u.name} email={u.email} avatarUrl={u.avatar_url} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold tracking-tight">{u.name || "Unnamed User"}</h2>
                {u.role && u.role !== "user" && ROLE_BADGE_STYLES[u.role] && (
                  <Badge className={cn(ROLE_BADGE_STYLES[u.role], "text-[10px] font-medium")}>{STAFF_ROLE_LABELS[u.role] || u.role}</Badge>
                )}
                {u.disabled_at && <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] font-medium">Disabled</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{u.email}</p>
            </div>
          </div>

          {detailLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Quick stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                {[
                  { label: "Scans", value: u.scan_count, icon: Activity, color: "text-primary", bg: "bg-primary/10" },
                  { label: "API Keys", value: u.api_key_count, icon: Key, color: "text-[hsl(var(--severity-medium))]", bg: "bg-[hsl(var(--severity-medium))]/10" },
                  { label: "Sessions", value: String(u.session_count), icon: Globe, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                  { label: "Joined", value: new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), icon: Clock, color: "text-muted-foreground", bg: "bg-muted/50" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-card/30">
                    <div className={cn("p-1.5 rounded-lg shrink-0", item.bg)}>
                      <item.icon className={cn("h-3.5 w-3.5", item.color)} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</p>
                      <p className="text-sm font-semibold truncate">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Security status */}
              <div className="mt-4 pt-4 border-t border-border/50">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2.5">Security</p>
                <div className="flex flex-wrap gap-2">
                  <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border", u.totp_enabled ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-500" : "bg-muted/50 border-border/50 text-muted-foreground")}>
                    {u.totp_enabled ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                    {u.totp_enabled ? "2FA Enabled" : "No 2FA"}
                  </div>
                  {u.totp_enabled && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/50 border border-border/50 text-muted-foreground">
                      <KeyRound className="h-3 w-3" />
                      {u.has_backup_codes ? "Has backup codes" : "No backup codes"}
                    </div>
                  )}
                  <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border", u.tos_accepted_at ? "bg-muted/50 border-border/50 text-muted-foreground" : "bg-[hsl(var(--severity-medium))]/5 border-[hsl(var(--severity-medium))]/20 text-[hsl(var(--severity-medium))]")}>
                    <FileText className="h-3 w-3" />
                    {u.tos_accepted_at ? "TOS Accepted" : "TOS Not Accepted"}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Account Management - admin/mod can edit */}
      {!detailLoading && hasStaffPermission(callerRole, STAFF_PERMISSIONS.DISABLE_USER) && (
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCog className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Account Management</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => {
                  if (accountEditMode) {
                    setEditName(u.name || "")
                    setEditEmail(u.email || "")
                    setEditPlan(u.plan || "free")
                    setPendingChanges(prev => {
                      const next = { ...prev }
                      delete next.name
                      delete next.email
                      delete next.plan
                      return next
                    })
                  }
                  setAccountEditMode(m => !m)
                }}
              >
                {accountEditMode ? (
                  <><X className="h-3 w-3" />Cancel</>
                ) : (
                  <><Pencil className="h-3 w-3" />Edit</>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {!accountEditMode ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1 p-3 rounded-lg border border-border/40 bg-card/30">
                  <div className="flex items-center gap-2 mb-1">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Display Name</span>
                  </div>
                  <span className="text-sm font-medium truncate">{u.name || <span className="text-muted-foreground italic">Not set</span>}</span>
                </div>
                {hasStaffPermission(callerRole, STAFF_PERMISSIONS.EDIT_USER_ROLE) && (
                  <div className="flex flex-col gap-1 p-3 rounded-lg border border-border/40 bg-card/30">
                    <div className="flex items-center gap-2 mb-1">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">Email Address</span>
                    </div>
                    <span className="text-sm font-medium truncate">{u.email}</span>
                  </div>
                )}
                {hasStaffPermission(callerRole, STAFF_PERMISSIONS.EDIT_USER_ROLE) && (
                  <div className="flex flex-col gap-1 p-3 rounded-lg border border-border/40 bg-card/30">
                    <div className="flex items-center gap-2 mb-1">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">Subscription Plan</span>
                    </div>
                    <span className="text-xs font-medium text-foreground flex items-center gap-2">
                      {(() => {
                        const effectivePlan = u.gifted_plan || u.plan
                        const label = effectivePlan === "free" || !effectivePlan
                          ? "Free"
                          : effectivePlan.replace("_supporter", " Supporter").replace(/(^\w|\s\w)/g, (m: string) => m.toUpperCase())
                        return (
                          <>
                            {label}
                            {u.gifted_plan && (
                              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">Gifted</span>
                            )}
                          </>
                        )
                      })()}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Edit Name */}
                  <div className={cn("flex flex-col gap-2 p-3 rounded-lg border transition-colors", pendingChanges.name ? "bg-primary/5 border-primary/30" : "bg-card/30 border-border/40")}>
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">Display Name</span>
                      {pendingChanges.name && <span className="text-[9px] text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10">Modified</span>}
                    </div>
                    <Input
                      value={editName}
                      onChange={(e) => {
                        setEditName(e.target.value)
                        addPendingChange("name", e.target.value.trim(), u.name || "")
                      }}
                      placeholder="Enter name"
                      className="h-8 text-xs"
                    />
                  </div>

                  {/* Edit Email - admin only */}
                  {hasStaffPermission(callerRole, STAFF_PERMISSIONS.EDIT_USER_ROLE) && (
                    <div className={cn("flex flex-col gap-2 p-3 rounded-lg border transition-colors", pendingChanges.email ? "bg-primary/5 border-primary/30" : "bg-card/30 border-border/40")}>
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">Email Address</span>
                        {pendingChanges.email && <span className="text-[9px] text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10">Modified</span>}
                      </div>
                      <Input
                        type="email"
                        value={editEmail}
                        onChange={(e) => {
                          setEditEmail(e.target.value)
                          addPendingChange("email", e.target.value.trim().toLowerCase(), u.email)
                        }}
                        placeholder="Email address"
                        className="h-8 text-xs"
                      />
                    </div>
                  )}

                  {/* Edit Plan - admin only */}
                  {hasStaffPermission(callerRole, STAFF_PERMISSIONS.EDIT_USER_ROLE) && (
                    <div className={cn("flex flex-col gap-2 p-3 rounded-lg border transition-colors", 
                      u.gifted_plan ? "bg-amber-500/5 border-amber-500/30" : 
                      pendingChanges.plan ? "bg-primary/5 border-primary/30" : "bg-card/30 border-border/40"
                    )}>
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">Subscription Plan</span>
                        {u.gifted_plan && <span className="text-[9px] text-amber-500 font-medium px-1.5 py-0.5 rounded bg-amber-500/10">Gifted</span>}
                        {pendingChanges.plan && !u.gifted_plan && <span className="text-[9px] text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10">Modified</span>}
                      </div>
                      {u.gifted_plan ? (
                        <div className="flex flex-col gap-1.5">
                          <div className="h-8 text-xs rounded-md border border-amber-500/30 bg-amber-500/5 px-2 flex items-center gap-2 text-amber-600">
                            <Gift className="h-3.5 w-3.5" />
                            {u.gifted_plan.replace("_supporter", " Supporter").replace(/(^\w|\s\w)/g, (m: string) => m.toUpperCase())}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            Gifted until {u.gift_end_date ? new Date(u.gift_end_date).toLocaleDateString() : "N/A"}. Use the Gift button above to modify.
                          </p>
                        </div>
                      ) : (
                        <select
                          value={editPlan}
                          onChange={(e) => {
                            setEditPlan(e.target.value)
                            addPendingChange("plan", e.target.value, u.plan || "free")
                          }}
                          className="h-8 text-xs rounded-md border border-border bg-background px-2"
                        >
                          <option value="free">Free</option>
                          <option value="core_supporter">Core Supporter</option>
                          <option value="pro_supporter">Pro Supporter</option>
                          <option value="elite_supporter">Elite Supporter</option>
                        </select>
                      )}
                    </div>
                  )}
                </div>

                {/* Safety note */}
                <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-muted/30 border border-border/40">
                  <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Changes are logged in the audit log. Email changes require confirmation input to prevent accidents. Plan changes take effect immediately.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Temp password result */}
      {tempPassword && (
        <div className="flex flex-col gap-2 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-emerald-500" />
            <p className="text-sm font-semibold text-foreground">Temporary Password Generated</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">Share this securely with the user. They should change it immediately after logging in.</p>
          <div className="flex items-center gap-2 p-3 bg-card border border-border rounded-lg">
            <code className="font-mono text-sm text-foreground flex-1 select-all">{tempPassword}</code>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => navigator.clipboard.writeText(tempPassword)}>
              <ClipboardCopy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="self-start text-xs text-muted-foreground" onClick={onClearTempPassword}>Dismiss</Button>
        </div>
      )}

      {/* Role + Badge management - admin only */}
      {!detailLoading && hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_USER) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Staff Role - dropdown */}
          <Card className={cn("border-border/50 bg-card/50 transition-colors", pendingChanges.role && "border-primary/30")}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Staff Role</p>
                {pendingChanges.role && <span className="text-[9px] text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10">Modified</span>}
              </div>
              <p className="text-xs text-muted-foreground">Select a permission level for this user.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <Select
                value={editRole}
                onValueChange={(value) => {
                  setEditRole(value)
                  addPendingChange("role", value, u.role || "user")
                }}
              >
                <SelectTrigger className="w-full h-10 border-border/40 bg-card/30">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {(["user", "support", "moderator", "admin"] as const).map((role) => {
                    const isOriginal = (u.role || "user") === role
                    return (
                      <SelectItem key={role} value={role}>
                        <span className="flex items-center gap-2">
                          {STAFF_ROLE_LABELS[role] || role}
                          {isOriginal && <span className="text-[10px] text-muted-foreground">(current)</span>}
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Badges - multi select */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Badges</p>
                <Badge variant="secondary" className="text-[10px] h-5 ml-auto">{detail.badges.length} awarded</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Cosmetic badges shown on the user&apos;s profile.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 flex flex-col gap-3">
              {/* Awarded badges */}
              {detail.badges.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {detail.badges.map((badge) => {
                    const isPendingRevoke = pendingBadgeRevokes.includes(badge.id)
                    return (
                      <button
                        key={badge.id}
                        onClick={() => {
                          if (isPendingRevoke) {
                            setPendingBadgeRevokes((p) => p.filter((id) => id !== badge.id))
                          } else {
                            setPendingBadgeRevokes((p) => [...p, badge.id])
                          }
                        }}
                        title={isPendingRevoke ? "Click to undo remove" : "Click to remove badge"}
                        className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all cursor-pointer hover:scale-105",
                          isPendingRevoke && "opacity-50 line-through"
                        )}
                        style={{ borderColor: `${badge.color}40`, backgroundColor: `${badge.color}15`, color: badge.color || undefined }}
                      >
                        <Tag className="h-3 w-3 shrink-0" />
                        {badge.display_name}
                        {isPendingRevoke && <RefreshCw className="h-3 w-3 ml-0.5" />}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No badges awarded yet.</p>
              )}
              {pendingBadgeRevokes.length > 0 && (
                <p className="text-[10px] text-destructive">{pendingBadgeRevokes.length} badge(s) will be removed on save</p>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {unawardedBadges.length > 0 && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 bg-transparent flex-1" onClick={() => setShowBadgePicker(true)}>
                    <Award className="h-3.5 w-3.5" /> Award Badge
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 bg-transparent flex-1" onClick={() => setShowCreateBadge(true)}>
                  <Plus className="h-3.5 w-3.5" /> Create Badge
                </Button>
                {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_BADGE) && allBadges.length > 0 && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 bg-transparent text-destructive border-destructive/30 hover:bg-destructive/10 flex-1" onClick={() => setShowManageBadges(true)}>
                    <Trash2 className="h-3.5 w-3.5" /> Manage Badges
                  </Button>
                )}
              </div>

              {/* Award Badge Modal */}
              <Dialog open={showBadgePicker} onOpenChange={setShowBadgePicker}>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                      <Award className="h-4 w-4 text-primary" /> Award Badge
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-muted-foreground">Select badges to award. Changes will apply when you save.</p>
                    {unawardedBadges.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {unawardedBadges.map((badge) => {
                          const isPending = pendingBadgeAwards.includes(badge.id)
                          return (
                            <button
                              key={badge.id}
                              onClick={() => {
                                if (isPending) {
                                  setPendingBadgeAwards((p) => p.filter((id) => id !== badge.id))
                                } else {
                                  setPendingBadgeAwards((p) => [...p, badge.id])
                                }
                              }}
                              className={cn(
                                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs font-medium transition-all",
                                isPending ? "ring-2 ring-primary scale-105" : "hover:scale-105 hover:opacity-80"
                              )}
                              style={{ borderColor: `${badge.color}40`, backgroundColor: `${badge.color}15`, color: badge.color || undefined }}
                            >
                              <Tag className="h-3 w-3 shrink-0" />
                              {badge.display_name}
                              {isPending && <CheckCircle2 className="h-3 w-3 ml-0.5" />}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-4 text-center">All badges have already been awarded.</p>
                    )}
                    {pendingBadgeAwards.length > 0 && (
                      <p className="text-[10px] text-primary">{pendingBadgeAwards.length} badge(s) queued to award on save</p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" size="sm" onClick={() => setShowBadgePicker(false)}>Done</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Create Badge Modal */}
              <Dialog open={showCreateBadge} onOpenChange={(open) => {
                setShowCreateBadge(open)
                if (!open) { setNewBadgeName(""); setNewBadgeDisplay(""); setNewBadgeColor("#6366f1") }
              }}>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                      <Plus className="h-4 w-4 text-primary" /> Create New Badge
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4">
                    {/* Preview */}
                    {(newBadgeName || newBadgeDisplay) && (
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">Preview:</p>
                        <div
                          className="flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium"
                          style={{ borderColor: `${newBadgeColor}40`, backgroundColor: `${newBadgeColor}15`, color: newBadgeColor }}
                        >
                          <Tag className="h-3 w-3 shrink-0" />
                          {newBadgeDisplay || newBadgeName}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium">Badge ID <span className="text-muted-foreground">(internal name)</span></label>
                      <Input
                        placeholder="e.g. power_user"
                        value={newBadgeName}
                        onChange={(e) => setNewBadgeName(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                        className="h-9 border-border/40"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium">Display Name</label>
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
                              newBadgeColor === c.color ? "border-foreground scale-110 shadow-sm" : "border-transparent hover:scale-105"
                            )}
                            style={{ backgroundColor: c.color }}
                            title={c.name}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {/* Native color picker — full color spectrum */}
                        <label className="relative cursor-pointer" title="Open color picker">
                          <div
                            className="w-7 h-7 rounded-full border-2 border-border/50 shrink-0 transition-all hover:scale-110 hover:border-border"
                            style={{ backgroundColor: newBadgeColor }}
                          />
                          <input
                            type="color"
                            value={newBadgeColor}
                            onChange={(e) => setNewBadgeColor(e.target.value)}
                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                          />
                        </label>
                        <Input
                          value={newBadgeColor}
                          onChange={(e) => {
                            const v = e.target.value
                            setNewBadgeColor(v.startsWith("#") ? v : `#${v}`)
                          }}
                          placeholder="#6366f1"
                          className="h-8 text-xs font-mono w-32 border-border/40"
                          maxLength={7}
                        />
                        <p className="text-xs text-muted-foreground">Click swatch for full picker</p>
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" size="sm" onClick={() => { setShowCreateBadge(false); setNewBadgeName(""); setNewBadgeDisplay(""); setNewBadgeColor("#6366f1") }}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={!newBadgeName.trim() || !newBadgeDisplay.trim()}
                      onClick={() => {
                        onAction(u.id, "create_badge", { name: newBadgeName.trim(), displayName: newBadgeDisplay.trim(), color: newBadgeColor })
                        setShowCreateBadge(false)
                        setNewBadgeName("")
                        setNewBadgeDisplay("")
                        setNewBadgeColor("#6366f1")
                      }}
                    >
                      Create &amp; Award
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Manage/Delete Badges Modal */}
              {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_BADGE) && (
                <Dialog open={showManageBadges} onOpenChange={(open) => { setShowManageBadges(open); if (!open) setPendingDeleteBadge(null) }}>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-base">
                        <Trash2 className="h-4 w-4 text-destructive" /> Manage All Badges
                      </DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-3">
                      {/* Inline delete confirmation */}
                      {pendingDeleteBadge ? (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex flex-col gap-3">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-foreground">Delete &quot;{pendingDeleteBadge.display_name}&quot;?</p>
                              <p className="text-xs text-muted-foreground mt-1">This will permanently remove the badge from the system and revoke it from all users who currently hold it.</p>
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button variant="outline" size="sm" onClick={() => setPendingDeleteBadge(null)}>Cancel</Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                onAction(u.id, "delete_badge", { badgeId: String(pendingDeleteBadge.id) })
                                setPendingDeleteBadge(null)
                                setShowManageBadges(false)
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                              Delete Permanently
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">Click the trash icon to permanently delete a badge from the system.</p>
                          {allBadges.length > 0 ? (
                            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                              {allBadges.map((badge) => (
                                <div
                                  key={badge.id}
                                  className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-card/30 hover:bg-muted/40 transition-colors"
                                >
                                  <div
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium"
                                    style={{ borderColor: `${badge.color}40`, backgroundColor: `${badge.color}15`, color: badge.color || undefined }}
                                  >
                                    <Tag className="h-3 w-3 shrink-0" />
                                    {badge.display_name}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    onClick={() => setPendingDeleteBadge(badge)}
                                    title={`Delete "${badge.display_name}" permanently`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground text-center py-4">No badges exist yet.</p>
                          )}
                        </>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" size="sm" onClick={() => { setShowManageBadges(false); setPendingDeleteBadge(null) }}>Close</Button>
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
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">Admin Notes</p>
              <Badge variant="secondary" className="text-[10px] h-5 ml-auto">{detail.notes?.length || 0}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">Admin-only notes. Only visible when extracting user data. Not shown to the user unless they request a data export.</p>
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
                    onAction(u.id, "add_note", { note: newNote.trim() })
                    setNewNote("")
                  }
                }}
              />
              <Button
                size="sm"
                className="h-9 gap-1.5"
                disabled={!newNote.trim() || isLoading("add_note")}
                onClick={() => {
                  if (newNote.trim()) {
                    onAction(u.id, "add_note", { note: newNote.trim() })
                    setNewNote("")
                  }
                }}
              >
                {isLoading("add_note") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Add
              </Button>
            </div>

            {/* Notes list */}
            {detail.notes && detail.notes.length > 0 ? (
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {detail.notes.map((note) => (
                  <div key={note.id} className="group flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/40 hover:bg-muted/50 transition-colors">
                    <UserAvatar
                      name={note.admin_name}
                      email={note.admin_email}
                      size="sm"
                      avatarUrl={note.admin_avatar_url}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-foreground">{note.admin_name || note.admin_email.split("@")[0]}</span>
                        <span className="text-[10px] text-muted-foreground">{formatRelativeTime(new Date(note.created_at))}</span>
                      </div>
                      {editingNote?.id === note.id ? (
                        <div className="flex gap-2 mt-1">
                          <Input
                            value={editingNote.text}
                            onChange={(e) => setEditingNote({ ...editingNote, text: e.target.value })}
                            className="h-8 text-xs flex-1"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && editingNote.text.trim()) {
                                onAction(u.id, "edit_note", { noteId: note.id, note: editingNote.text.trim() })
                                setEditingNote(null)
                              }
                              if (e.key === "Escape") setEditingNote(null)
                            }}
                          />
                          <Button size="sm" className="h-8 px-2 text-xs" disabled={!editingNote.text.trim()} onClick={() => {
                            onAction(u.id, "edit_note", { noteId: note.id, note: editingNote.text.trim() })
                            setEditingNote(null)
                          }}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setEditingNote(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{note.note}</p>
                      )}
                    </div>
                    {editingNote?.id !== note.id && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => setEditingNote({ id: note.id, text: note.note })}
                          className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setPendingDeleteNote({ id: note.id, text: note.note })}
                          className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">No notes yet. Add one above.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Support actions */}
      {!detailLoading && (
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <UserCog className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">
                {!hasStaffPermission(callerRole, STAFF_PERMISSIONS.DISABLE_USER) ? "Account Information" : "Support Actions"}
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {!hasStaffPermission(callerRole, STAFF_PERMISSIONS.DISABLE_USER) ? (
              <p className="text-xs text-muted-foreground">You have view-only access. Contact an admin or moderator to perform actions on this user.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Session & Security */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Session &amp; Security</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <ActionCard
                      icon={LogOut} label="Force Logout"
                      description={`Revoke all ${u.session_count} active session(s)`}
                      color="text-primary" bg="bg-primary/10"
                      loading={isLoading("revoke_sessions")}
                      onClick={() => queueSupportAction("revoke_sessions", "Force Logout", `Revoke all ${u.session_count} active session(s) for ${u.name || u.email}`)}
                    />
                    <ActionCard
                      icon={Key} label="Revoke API Keys"
                      description={`Invalidate all ${u.api_key_count} API key(s)`}
                      color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                      loading={isLoading("revoke_api_keys")}
                      onClick={() => queueSupportAction("revoke_api_keys", "Revoke API Keys", `Invalidate all ${u.api_key_count} API key(s) for ${u.name || u.email}`)}
                    />
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.RESET_USER_PASSWORD) && (
                      <ActionCard
                        icon={KeyRound} label="Reset Password"
                        description={u.totp_enabled ? "Unavailable: 2FA enabled" : "Generate temp password"}
                        color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                        disabled={u.totp_enabled} loading={isLoading("reset_password")}
                        onClick={() => queueSupportAction("reset_password", "Reset Password", `Generate a temporary password for ${u.name || u.email}`)}
                      />
                    )}
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.RESET_USER_2FA) && u.totp_enabled && (
                      <ActionCard
                        icon={ShieldOff} label="Reset 2FA"
                        description="Remove two-factor auth"
                        color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                        loading={isLoading("reset_2fa")}
                        onClick={() => queueSupportAction("reset_2fa", "Reset 2FA", `Remove two-factor authentication for ${u.name || u.email}`)}
                      />
                    )}
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.MANAGE_RATE_LIMITS) && (
                      <ActionCard
                        icon={RefreshCw} label="Clear Rate Limits"
                        description="Reset rate limit counters"
                        color="text-primary" bg="bg-primary/10"
                        loading={isLoading("clear_rate_limits")}
                        onClick={() => queueSupportAction("clear_rate_limits", "Clear Rate Limits", `Reset rate limit counters for ${u.name || u.email}`)}
                      />
                    )}
                    <ActionCard
                      icon={UserX} label="Force Logout All"
                      description="Logout + revoke all API keys"
                      color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                      loading={isLoading("force_logout_all")}
                      onClick={() => queueSupportAction("force_logout_all", "Force Logout All", `Logout and revoke all API keys for ${u.name || u.email}`)}
                    />
                  </div>
                </div>

                {/* Account Management */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Account Management</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <ActionCard
                      icon={ImageOff} label="Clear Avatar"
                      description="Remove profile picture"
                      color="text-muted-foreground" bg="bg-muted/50"
                      loading={isLoading("clear_avatar")}
                      onClick={() => queueSupportAction("clear_avatar", "Clear Avatar", `Remove profile picture for ${u.name || u.email}`)}
                    />
                  </div>
                </div>

                {/* Gifted Subscription */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Gifted Subscription</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {u.gifted_plan && u.gift_end_date && new Date(u.gift_end_date) > new Date() ? (
                      <ActionCard
                        icon={CrownIcon}
                        label="Edit Gift Subscription"
                        description={`${u.gifted_plan.replace("_supporter", " Supporter").replace(/(^\w|\s\w)/g, (m: string) => m.toUpperCase())} · expires ${new Date(u.gift_end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                        color="text-primary"
                        bg="bg-primary/10"
                        loading={isLoading("gift_subscription") || isLoading("revoke_gift")}
                        onClick={() => setShowGiftModal(true)}
                      />
                    ) : (
                      <ActionCard
                        icon={CrownIcon}
                        label="Gift a Subscription"
                        description={u.gifted_plan ? "Previous gift expired — re-gift" : "Grant temporary premium access"}
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
                    isLoading={isLoading("gift_subscription") || isLoading("revoke_gift")}
                    existingGift={
                      u.gifted_plan && u.gift_end_date && new Date(u.gift_end_date) > new Date()
                        ? { plan: u.gifted_plan, end_date: u.gift_end_date }
                        : null
                    }
                    onGift={(plan, endDate) => {
                      setShowGiftModal(false)
                      queueSupportAction("gift_subscription", "Gift Subscription", `Gift ${plan.replace("_", " ")} plan to ${u.name || u.email} until ${new Date(endDate).toLocaleDateString()}`, "default", { giftPlan: plan, giftEndDate: endDate })
                    }}
                    onRevoke={() => {
                      setShowGiftModal(false)
                      queueSupportAction("revoke_gift", "Revoke Gift", `Remove gifted subscription from ${u.name || u.email}`, "destructive")
                    }}
                  />
                )}

                {/* Danger Zone */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-destructive/70 font-medium mb-2">Danger Zone</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <ActionCard
                      icon={u.disabled_at ? CheckCircle2 : Ban}
                      label={u.disabled_at ? "Re-enable Account" : "Disable Account"}
                      description={u.disabled_at ? "Allow user to log in" : "Suspend and force-logout"}
                      color={u.disabled_at ? "text-emerald-500" : "text-destructive"}
                      bg={u.disabled_at ? "bg-emerald-500/10" : "bg-destructive/10"}
                      variant={u.disabled_at ? "success" : "danger"}
                      onClick={() => queueSupportAction(
                        u.disabled_at ? "enable" : "disable",
                        u.disabled_at ? "Re-enable Account" : "Disable Account",
                        u.disabled_at ? `Allow ${u.name || u.email} to log in again` : `Suspend ${u.name || u.email} and force logout all sessions`,
                        u.disabled_at ? "default" : "destructive"
                      )}
                    />
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_ANY_SCAN) && (
                      <ActionCard
                        icon={Activity} label="Delete All Scans"
                        description={`Remove all ${u.scan_count} scan(s)`}
                        color="text-destructive" bg="bg-destructive/10" variant="danger"
                        loading={isLoading("delete_scans")}
                        onClick={() => queueSupportAction("delete_scans", "Delete All Scans", `Remove all ${u.scan_count} scan(s) for ${u.name || u.email}`, "destructive")}
                      />
                    )}
                    <ActionCard
                      icon={Webhook} label="Delete Webhooks"
                      description="Remove all webhooks"
                      color="text-destructive" bg="bg-destructive/10" variant="danger"
                      loading={isLoading("delete_webhooks")}
                      onClick={() => queueSupportAction("delete_webhooks", "Delete Webhooks", `Remove all webhooks for ${u.name || u.email}`, "destructive")}
                    />
                    <ActionCard
                      icon={CalendarOff} label="Delete Schedules"
                      description="Remove scheduled scans"
                      color="text-destructive" bg="bg-destructive/10" variant="danger"
                      loading={isLoading("delete_schedules")}
                      onClick={() => queueSupportAction("delete_schedules", "Delete Schedules", `Remove all scheduled scans for ${u.name || u.email}`, "destructive")}
                    />
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_USER) && (
                      <ActionCard
                        icon={Trash2} label="Delete Account"
                        description="Permanently remove user"
                        color="text-destructive" bg="bg-destructive/10" variant="danger"
                        onClick={() => queueSupportAction("delete", "Delete Account", `Permanently remove ${u.name || u.email}'s account. This cannot be undone.`, "destructive")}
                      />
                    )}
                  </div>
                </div>

                {u.totp_enabled && hasStaffPermission(callerRole, STAFF_PERMISSIONS.RESET_USER_2FA) && (
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[hsl(var(--severity-medium))]/5 border border-[hsl(var(--severity-medium))]/20">
                    <AlertTriangle className="h-4 w-4 text-[hsl(var(--severity-medium))] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Password reset is unavailable for this user</p>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                        This user has two-factor authentication enabled. If they need account recovery, you can reset their 2FA — they will then be able to request a password reset themselves.
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
                <Activity className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Recent Scans</p>
                <Badge variant="secondary" className="text-[10px] h-5 ml-auto">{detail.recentScans?.length || 0}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {detail.recentScans && detail.recentScans.length > 0 ? (
                <div className="flex flex-col max-h-64 overflow-y-auto">
                  {detail.recentScans.map((scan) => (
                    <div key={scan.id} className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors rounded-md">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{scan.url}</p>
                        <p className="text-[10px] text-muted-foreground">{scan.findings_count} findings via {scan.source}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(scan.scanned_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <Activity className="h-8 w-8 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No recent scans.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* API Keys */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">API Keys</p>
                <Badge variant="secondary" className="text-[10px] h-5 ml-auto">{detail.apiKeys?.filter(k => !k.revoked_at)?.length || 0}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {detail.apiKeys && detail.apiKeys.filter(k => !k.revoked_at).length > 0 ? (
                <div className="flex flex-col max-h-64 overflow-y-auto">
                  {detail.apiKeys.filter(k => !k.revoked_at).map((key) => (
                    <div key={key.id} className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors rounded-md">
                      <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{key.name || "Unnamed Key"}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{key.key_prefix}...</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {key.last_used_at ? formatRelativeTime(new Date(key.last_used_at)) : "Never used"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <Key className="h-8 w-8 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No API keys.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Webhooks */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Webhooks</p>
                <Badge variant="secondary" className="text-[10px] h-5 ml-auto">{detail.webhooks?.length || 0}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {detail.webhooks && detail.webhooks.length > 0 ? (
                <div className="flex flex-col max-h-64 overflow-y-auto">
                  {detail.webhooks.map((webhook) => (
                    <div key={webhook.id} className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors rounded-md">
                      <Webhook className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{webhook.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{webhook.url}</p>
                      </div>
                      <Badge variant={webhook.active ? "default" : "secondary"} className="text-[9px]">
                        {webhook.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <Webhook className="h-8 w-8 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No webhooks configured.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active Sessions */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Active Sessions</p>
                <Badge variant="secondary" className="text-[10px] h-5 ml-auto">{detail.activeSessions?.length || 0}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {detail.activeSessions && detail.activeSessions.length > 0 ? (
                <div className="flex flex-col max-h-64 overflow-y-auto">
                  {detail.activeSessions.map((session) => (
                    <div key={session.id} className="flex items-center gap-3 py-3 px-2 border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors rounded-md">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium font-mono">{session.id.slice(0, 12)}...</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {session.ip_address || "Unknown IP"} &middot; {session.user_agent?.slice(0, 40) || "Unknown device"}...
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        expires {new Date(session.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <Globe className="h-8 w-8 text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No active sessions.</p>
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
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-card/95 border border-border/50 shadow-xl backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <Save className="h-3.5 w-3.5 text-primary" />
                </div>
                <p className="text-sm font-medium">
                  {modalChanges.length} unsaved change{modalChanges.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={discardChanges} disabled={isSaving}>Discard</Button>
                <Button size="sm" className="gap-1.5" onClick={handleSaveClick} disabled={isSaving}>
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save confirmation modal */}
      <SaveConfirmationModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onConfirm={async (notify) => {
          setNotifyUserOnSave(notify ?? true)
          setShowSaveModal(false)
          await saveAllChanges()
        }}
        title="Save Changes"
        description={`You're about to save ${modalChanges.length} change${modalChanges.length !== 1 ? "s" : ""} to ${u.name || u.email}'s account.`}
        changes={modalChanges}
        loading={isSaving}
        isAdminAction={true}
        affectedUser={affectedUser}
        confirmText="Save Changes"
      />

      {/* Support action confirmation modal */}
      <SaveConfirmationModal
        isOpen={!!pendingSupportAction}
        onClose={() => setPendingSupportAction(null)}
        onConfirm={async (notify) => {
          await executeSupportAction(notify ?? true)
        }}
        title={pendingSupportAction?.label || "Confirm Action"}
        description={pendingSupportAction?.description || "Are you sure you want to perform this action?"}
        changes={[{
          field: "action",
          label: "Action",
          oldValue: "Current State",
          newValue: pendingSupportAction?.label || "Execute Action"
        }]}
        loading={isLoading(pendingSupportAction?.action || "")}
        isAdminAction={true}
        affectedUser={affectedUser}
        confirmText="Confirm"
        variant={pendingSupportAction?.variant}
        forceNotify={true}
      />

      {/* Delete Note Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={!!pendingDeleteNote}
        onClose={() => setPendingDeleteNote(null)}
        onConfirm={async () => {
          if (pendingDeleteNote) {
            await onAction(u.id, "delete_note", { noteId: pendingDeleteNote.id })
            setPendingDeleteNote(null)
          }
        }}
        title="Delete Note"
        description="This will permanently delete this admin note. This action cannot be undone."
        changes={pendingDeleteNote ? [
          { field: "note", label: "Note", oldValue: pendingDeleteNote.text.substring(0, 50) + (pendingDeleteNote.text.length > 50 ? "..." : ""), newValue: "Deleted" },
        ] : []}
        loading={isLoading("delete_note")}
        confirmText="Delete"
        variant="destructive"
      />
    </div>
  )
}
