"use client"

import React, { useState, useMemo } from "react"
import { 
  ArrowLeft, Copy, Check, Shield, ShieldOff, Key, LogOut, 
  Smartphone, Trash2, Ban, CheckCircle2, Mail, User, Calendar,
  Clock, Globe, Activity, CreditCard, Award, StickyNote, AlertTriangle,
  MoreHorizontal, Send, Gift, Gauge, Eye, EyeOff, RefreshCw, X,
  ChevronDown, ChevronRight, Loader2, Plus, Edit2, ExternalLink
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { ROLE_BADGE_STYLES, PLAN_BADGE_STYLES } from "@/lib/constants"
import { SaveConfirmationModal, type ChangeItem, type AffectedUser } from "@/components/save-confirmation-modal"
import type { UserDetail, BadgeDef, AdminNote } from "../types"

interface UserDetailPanelProps {
  detail: UserDetail
  detailLoading: boolean
  actionLoading: string | null
  callerRole: string
  allBadges: BadgeDef[]
  onRefreshBadges: () => void
  onBadgesChanged: (awardedIds: number[], revokedIds: number[]) => void
  onClose: () => void
  onAction: (userId: number, action: string, extra?: Record<string, unknown>) => Promise<void>
  tempPassword: string | null
  onClearTempPassword: () => void
}

// Action Card Component
function ActionCard({ 
  icon: Icon, 
  label, 
  description, 
  onClick, 
  loading, 
  disabled,
  variant = "default" 
}: { 
  icon: React.ElementType
  label: string
  description: string
  onClick: () => void
  loading?: boolean
  disabled?: boolean
  variant?: "default" | "warning" | "danger" | "success"
}) {
  const variants = {
    default: "hover:border-primary/50 hover:bg-primary/5",
    warning: "hover:border-amber-500/50 hover:bg-amber-500/5",
    danger: "hover:border-destructive/50 hover:bg-destructive/5",
    success: "hover:border-emerald-500/50 hover:bg-emerald-500/5",
  }
  const iconVariants = {
    default: "bg-primary/10 text-primary",
    warning: "bg-amber-500/10 text-amber-500",
    danger: "bg-destructive/10 text-destructive",
    success: "bg-emerald-500/10 text-emerald-500",
  }
  
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg border border-border bg-card text-left transition-all w-full",
        variants[variant],
        (loading || disabled) && "opacity-50 cursor-not-allowed"
      )}
    >
      <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", iconVariants[variant])}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </button>
  )
}

// Info Row Component
function InfoRow({ label, value, icon: Icon, copyable }: { label: string; value: string | React.ReactNode; icon?: React.ElementType; copyable?: boolean }) {
  const [copied, setCopied] = useState(false)
  
  const handleCopy = () => {
    if (typeof value === "string") {
      navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {Icon && <Icon className="h-4 w-4" />}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{value}</span>
        {copyable && typeof value === "string" && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </Button>
        )}
      </div>
    </div>
  )
}

export function UserDetailPanel({
  detail,
  detailLoading,
  actionLoading,
  callerRole,
  allBadges,
  onRefreshBadges,
  onBadgesChanged,
  onClose,
  onAction,
  tempPassword,
  onClearTempPassword,
}: UserDetailPanelProps) {
  const u = detail.user
  const [activeTab, setActiveTab] = useState("overview")
  const [showDangerZone, setShowDangerZone] = useState(false)
  const [pendingNote, setPendingNote] = useState("")
  const [editingNote, setEditingNote] = useState<AdminNote | null>(null)
  const [editNoteText, setEditNoteText] = useState("")
  
  // Support action modal state
  const [pendingSupportAction, setPendingSupportAction] = useState<{
    action: string
    label: string
    description: string
    extraPayload?: Record<string, unknown>
  } | null>(null)
  
  // Editable fields
  const [editedName, setEditedName] = useState(u.name || "")
  const [editedEmail, setEditedEmail] = useState(u.email)
  const [editedRole, setEditedRole] = useState(u.role || "user")
  const [editedPlan, setEditedPlan] = useState(u.plan || "free")
  const [pendingBadgeAwards, setPendingBadgeAwards] = useState<number[]>([])
  const [pendingBadgeRevokes, setPendingBadgeRevokes] = useState<number[]>([])
  
  // Track if we have unsaved changes
  const hasChanges = useMemo(() => {
    return editedName !== (u.name || "") ||
           editedEmail !== u.email ||
           editedRole !== (u.role || "user") ||
           editedPlan !== (u.plan || "free") ||
           pendingBadgeAwards.length > 0 ||
           pendingBadgeRevokes.length > 0
  }, [editedName, editedEmail, editedRole, editedPlan, pendingBadgeAwards, pendingBadgeRevokes, u])
  
  // Helper to check if an action is loading
  const isLoading = (action: string) => actionLoading === `${u.id}-${action}`
  
  // Queue support action for confirmation
  const queueSupportAction = (action: string, label: string, description: string, extraPayload?: Record<string, unknown>) => {
    setPendingSupportAction({ action, label, description, extraPayload })
  }
  
  // Execute support action
  const executeSupportAction = async (notifyUser: boolean) => {
    if (!pendingSupportAction) return
    await onAction(u.id, pendingSupportAction.action, { 
      ...pendingSupportAction.extraPayload, 
      notifyUser 
    })
    setPendingSupportAction(null)
  }
  
  // Save all changes
  const saveAllChanges = async (notifyUser: boolean) => {
    if (editedName !== (u.name || "")) {
      await onAction(u.id, "update_name", { name: editedName, notifyUser })
    }
    if (editedEmail !== u.email) {
      await onAction(u.id, "update_email", { email: editedEmail, notifyUser })
    }
    if (editedRole !== (u.role || "user")) {
      await onAction(u.id, "set_role", { role: editedRole, notifyUser })
    }
    if (editedPlan !== (u.plan || "free")) {
      await onAction(u.id, "update_plan", { plan: editedPlan, notifyUser })
    }
    // Handle badge changes
    for (const badgeId of pendingBadgeAwards) {
      await onAction(u.id, "award_badge", { badgeId: String(badgeId), notifyUser })
    }
    for (const badgeId of pendingBadgeRevokes) {
      await onAction(u.id, "revoke_badge", { badgeId: String(badgeId), notifyUser })
    }
    onBadgesChanged(pendingBadgeAwards, pendingBadgeRevokes)
    setPendingBadgeAwards([])
    setPendingBadgeRevokes([])
  }
  
  // Format date
  const formatDate = (date: string | null) => {
    if (!date) return "Never"
    return new Date(date).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
    })
  }
  
  // Get available badges (not already awarded)
  const availableBadges = useMemo(() => {
    const awardedIds = new Set(detail.badges.map(b => b.id))
    return allBadges.filter(b => !awardedIds.has(b.id) || pendingBadgeRevokes.includes(b.id))
  }, [allBadges, detail.badges, pendingBadgeRevokes])
  
  // Build changes for save modal
  const buildChanges = (): ChangeItem[] => {
    const changes: ChangeItem[] = []
    if (editedName !== (u.name || "")) {
      changes.push({ field: "name", label: "Name", oldValue: u.name || "—", newValue: editedName || "—" })
    }
    if (editedEmail !== u.email) {
      changes.push({ field: "email", label: "Email", oldValue: u.email, newValue: editedEmail })
    }
    if (editedRole !== (u.role || "user")) {
      changes.push({ field: "role", label: "Role", oldValue: u.role || "user", newValue: editedRole })
    }
    if (editedPlan !== (u.plan || "free")) {
      changes.push({ field: "plan", label: "Plan", oldValue: u.plan || "free", newValue: editedPlan })
    }
    if (pendingBadgeAwards.length > 0) {
      const badgeNames = pendingBadgeAwards.map(id => allBadges.find(b => b.id === id)?.display_name || "Unknown").join(", ")
      changes.push({ field: "badges", label: "Award Badges", oldValue: "—", newValue: badgeNames })
    }
    if (pendingBadgeRevokes.length > 0) {
      const badgeNames = pendingBadgeRevokes.map(id => detail.badges.find(b => b.id === id)?.display_name || "Unknown").join(", ")
      changes.push({ field: "badges", label: "Revoke Badges", oldValue: badgeNames, newValue: "—" })
    }
    return changes
  }
  
  // Save changes modal state
  const [showSaveModal, setShowSaveModal] = useState(false)

  return (
    <Card className="bg-card border-border overflow-hidden">
      {/* Header */}
      <CardHeader className="border-b border-border bg-muted/30 pb-4">
        <div className="flex items-start justify-between gap-4">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-2 -ml-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Users
          </Button>
          
          {hasChanges && (
            <Button 
              onClick={() => setShowSaveModal(true)}
              className="gap-2"
              disabled={!!actionLoading}
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save Changes
            </Button>
          )}
        </div>
        
        {/* User Info Header */}
        <div className="flex items-center gap-4 mt-4">
          <div className="relative">
            {u.avatar_url ? (
              <img src={u.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover border-2 border-border" />
            ) : (
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center border-2 border-border">
                <User className="h-8 w-8 text-primary" />
              </div>
            )}
            {u.disabled_at && (
              <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-destructive flex items-center justify-center">
                <Ban className="h-3 w-3 text-white" />
              </div>
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-semibold truncate">{u.name || "Unnamed User"}</h2>
              {u.disabled_at && (
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                  Disabled
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">{u.email}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className={cn("text-xs", ROLE_BADGE_STYLES[u.role || "user"])}>
                {(u.role || "user").charAt(0).toUpperCase() + (u.role || "user").slice(1)}
              </Badge>
              <Badge variant="outline" className={cn("text-xs", PLAN_BADGE_STYLES[u.plan || "free"])}>
                {(u.plan || "free").charAt(0).toUpperCase() + (u.plan || "free").slice(1)}
              </Badge>
              {u.totp_enabled && (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-xs">
                  <Shield className="h-3 w-3 mr-1" />
                  2FA
                </Badge>
              )}
              {u.gifted_plan && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-xs">
                  <Gift className="h-3 w-3 mr-1" />
                  Gift
                </Badge>
              )}
            </div>
          </div>
          
          <div className="text-right hidden sm:block">
            <p className="text-xs text-muted-foreground">User ID</p>
            <p className="font-mono text-sm">#{u.id}</p>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent h-auto p-0">
            {[
              { id: "overview", label: "Overview", icon: User },
              { id: "security", label: "Security", icon: Shield },
              { id: "badges", label: "Badges", icon: Award },
              { id: "notes", label: "Notes", icon: StickyNote },
              { id: "actions", label: "Actions", icon: Activity },
            ].map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 gap-2"
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          
          {/* Overview Tab */}
          <TabsContent value="overview" className="p-4 sm:p-6 space-y-6 m-0">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Account Information */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  Account Information
                </h3>
                <div className="space-y-3 bg-muted/30 rounded-lg p-4 border border-border">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Display Name</label>
                    <Input
                      value={editedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      placeholder="Enter name..."
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Email Address</label>
                    <Input
                      value={editedEmail}
                      onChange={(e) => setEditedEmail(e.target.value)}
                      type="email"
                      className="h-9"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Role</label>
                      <Select value={editedRole} onValueChange={setEditedRole}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="support">Support</SelectItem>
                          <SelectItem value="moderator">Moderator</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Plan</label>
                      <Select value={editedPlan} onValueChange={setEditedPlan}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="free">Free</SelectItem>
                          <SelectItem value="pro">Pro</SelectItem>
                          <SelectItem value="team">Team</SelectItem>
                          <SelectItem value="enterprise">Enterprise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Account Stats */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Activity Stats
                </h3>
                <div className="space-y-1 bg-muted/30 rounded-lg p-4 border border-border">
                  <InfoRow label="Total Scans" value={String(u.scan_count)} icon={Globe} />
                  <InfoRow label="API Keys" value={String(u.api_key_count)} icon={Key} />
                  <InfoRow label="Active Sessions" value={String(u.session_count)} icon={Activity} />
                  <InfoRow label="Created" value={formatDate(u.created_at)} icon={Calendar} />
                  <InfoRow label="Email Verified" value={u.email_verified_at ? formatDate(u.email_verified_at) : "Not Verified"} icon={Mail} />
                </div>
              </div>
            </div>
            
            {/* Recent Activity */}
            {detail.recentScans.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  Recent Scans
                </h3>
                <div className="space-y-2">
                  {detail.recentScans.slice(0, 5).map((scan) => (
                    <div key={scan.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{scan.url}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(scan.scanned_at)}</p>
                      </div>
                      <Badge variant="outline" className={cn(
                        "ml-2",
                        scan.findings_count > 0 ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                      )}>
                        {scan.findings_count} {scan.findings_count === 1 ? "issue" : "issues"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
          
          {/* Security Tab */}
          <TabsContent value="security" className="p-4 sm:p-6 space-y-6 m-0">
            {/* Temp Password Alert */}
            {tempPassword && (
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-amber-500" />
                    <span className="text-sm font-medium text-amber-500">Temporary Password Generated</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClearTempPassword}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded bg-background font-mono text-sm">{tempPassword}</code>
                  <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(tempPassword)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-amber-500/80">Share this password securely. It will not be shown again.</p>
              </div>
            )}
            
            {/* Security Status */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="p-4 rounded-lg border border-border bg-muted/30">
                <div className="flex items-center gap-3 mb-3">
                  <div className={cn(
                    "h-10 w-10 rounded-lg flex items-center justify-center",
                    u.totp_enabled ? "bg-emerald-500/10" : "bg-muted"
                  )}>
                    <Smartphone className={cn("h-5 w-5", u.totp_enabled ? "text-emerald-500" : "text-muted-foreground")} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Two-Factor Auth</p>
                    <p className="text-xs text-muted-foreground">{u.totp_enabled ? "Enabled & Active" : "Not Configured"}</p>
                  </div>
                </div>
                {u.totp_enabled && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={() => queueSupportAction("reset_2fa", "Reset 2FA", `Remove two-factor authentication from ${u.email}'s account. They will need to set it up again.`)}
                  >
                    Reset 2FA
                  </Button>
                )}
              </div>
              
              <div className="p-4 rounded-lg border border-border bg-muted/30">
                <div className="flex items-center gap-3 mb-3">
                  <div className={cn(
                    "h-10 w-10 rounded-lg flex items-center justify-center",
                    u.has_backup_codes ? "bg-emerald-500/10" : "bg-muted"
                  )}>
                    <Key className={cn("h-5 w-5", u.has_backup_codes ? "text-emerald-500" : "text-muted-foreground")} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Backup Codes</p>
                    <p className="text-xs text-muted-foreground">{u.has_backup_codes ? "Generated" : "Not Generated"}</p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Active Sessions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Active Sessions ({detail.activeSessions.length})
                </h3>
                {detail.activeSessions.length > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => queueSupportAction("revoke_sessions", "Revoke All Sessions", `Force logout ${u.email} from all ${detail.activeSessions.length} active sessions.`)}
                    disabled={isLoading("revoke_sessions")}
                  >
                    {isLoading("revoke_sessions") ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogOut className="h-4 w-4 mr-2" />}
                    Revoke All
                  </Button>
                )}
              </div>
              
              {detail.activeSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No active sessions</p>
              ) : (
                <div className="space-y-2">
                  {detail.activeSessions.map((session) => (
                    <div key={session.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-muted-foreground truncate">{session.user_agent || "Unknown device"}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {session.ip_address || "Unknown IP"} - Created {formatDate(session.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* API Keys */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Key className="h-4 w-4 text-primary" />
                  API Keys ({detail.apiKeys.filter(k => !k.revoked_at).length})
                </h3>
                {detail.apiKeys.filter(k => !k.revoked_at).length > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => queueSupportAction("revoke_api_keys", "Revoke All API Keys", `Immediately revoke all ${detail.apiKeys.filter(k => !k.revoked_at).length} active API keys for ${u.email}.`)}
                    disabled={isLoading("revoke_api_keys")}
                  >
                    {isLoading("revoke_api_keys") ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Key className="h-4 w-4 mr-2" />}
                    Revoke All
                  </Button>
                )}
              </div>
              
              {detail.apiKeys.filter(k => !k.revoked_at).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No active API keys</p>
              ) : (
                <div className="space-y-2">
                  {detail.apiKeys.filter(k => !k.revoked_at).map((key) => (
                    <div key={key.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{key.name || "Unnamed Key"}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">{key.key_prefix}...</span> - Last used {key.last_used_at ? formatDate(key.last_used_at) : "Never"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
          
          {/* Badges Tab */}
          <TabsContent value="badges" className="p-4 sm:p-6 space-y-6 m-0">
            {/* Current Badges */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Award className="h-4 w-4 text-primary" />
                Awarded Badges ({detail.badges.length})
              </h3>
              
              {detail.badges.length === 0 && pendingBadgeAwards.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No badges awarded</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {detail.badges.filter(b => !pendingBadgeRevokes.includes(b.id)).map((badge) => (
                    <div key={badge.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border group">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${badge.color}20` }}>
                          <Award className="h-4 w-4" style={{ color: badge.color || "hsl(var(--primary))" }} />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{badge.display_name}</p>
                          <p className="text-xs text-muted-foreground">Awarded {formatDate(badge.awarded_at)}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setPendingBadgeRevokes([...pendingBadgeRevokes, badge.id])}
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  {/* Pending awards */}
                  {pendingBadgeAwards.map((badgeId) => {
                    const badge = allBadges.find(b => b.id === badgeId)
                    if (!badge) return null
                    return (
                      <div key={`pending-${badgeId}`} className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 group">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${badge.color}20` }}>
                            <Award className="h-4 w-4" style={{ color: badge.color || "hsl(var(--primary))" }} />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{badge.display_name}</p>
                            <p className="text-xs text-emerald-500">Pending award</p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setPendingBadgeAwards(pendingBadgeAwards.filter(id => id !== badgeId))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            
            {/* Award New Badge */}
            {availableBadges.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Award New Badge</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {availableBadges.filter(b => !pendingBadgeAwards.includes(b.id)).map((badge) => (
                    <button
                      key={badge.id}
                      onClick={() => setPendingBadgeAwards([...pendingBadgeAwards, badge.id])}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
                    >
                      <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${badge.color}20` }}>
                        <Award className="h-4 w-4" style={{ color: badge.color || "hsl(var(--primary))" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{badge.display_name}</p>
                        {badge.description && (
                          <p className="text-xs text-muted-foreground truncate">{badge.description}</p>
                        )}
                      </div>
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
          
          {/* Notes Tab */}
          <TabsContent value="notes" className="p-4 sm:p-6 space-y-6 m-0">
            {/* Add Note */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-primary" />
                Add Admin Note
              </h3>
              <div className="flex gap-2">
                <Textarea
                  value={pendingNote}
                  onChange={(e) => setPendingNote(e.target.value)}
                  placeholder="Add a note about this user..."
                  className="min-h-[80px] resize-none"
                />
              </div>
              <Button
                onClick={async () => {
                  if (!pendingNote.trim()) return
                  await onAction(u.id, "add_note", { note: pendingNote })
                  setPendingNote("")
                }}
                disabled={!pendingNote.trim() || isLoading("add_note")}
                size="sm"
              >
                {isLoading("add_note") ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Add Note
              </Button>
            </div>
            
            {/* Existing Notes */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Admin Notes ({detail.notes.length})</h3>
              {detail.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No notes yet</p>
              ) : (
                <div className="space-y-3">
                  {detail.notes.map((note) => (
                    <div key={note.id} className="p-4 rounded-lg bg-muted/30 border border-border">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          {note.admin_avatar_url ? (
                            <img src={note.admin_avatar_url} alt="" className="h-6 w-6 rounded-full" />
                          ) : (
                            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                              <User className="h-3 w-3 text-primary" />
                            </div>
                          )}
                          <span className="text-sm font-medium">{note.admin_name || note.admin_email}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(note.created_at)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              setEditingNote(note)
                              setEditNoteText(note.note)
                            }}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive"
                            onClick={() => onAction(u.id, "delete_note", { noteId: note.id })}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      {editingNote?.id === note.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editNoteText}
                            onChange={(e) => setEditNoteText(e.target.value)}
                            className="min-h-[60px] resize-none"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={async () => {
                                await onAction(u.id, "edit_note", { noteId: note.id, note: editNoteText })
                                setEditingNote(null)
                              }}
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingNote(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{note.note}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
          
          {/* Actions Tab */}
          <TabsContent value="actions" className="p-4 sm:p-6 space-y-6 m-0">
            {/* Session & Security */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Session & Security</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ActionCard
                  icon={LogOut}
                  label="Force Logout"
                  description={`Revoke all ${u.session_count} active session(s)`}
                  onClick={() => queueSupportAction("revoke_sessions", "Force Logout", `Force logout ${u.email} from all ${u.session_count} active sessions.`)}
                  loading={isLoading("revoke_sessions")}
                />
                <ActionCard
                  icon={Key}
                  label="Revoke API Keys"
                  description={`Invalidate all ${u.api_key_count} API key(s)`}
                  onClick={() => queueSupportAction("revoke_api_keys", "Revoke API Keys", `Immediately revoke all ${u.api_key_count} active API keys for ${u.email}.`)}
                  loading={isLoading("revoke_api_keys")}
                  variant="warning"
                />
                <ActionCard
                  icon={Key}
                  label="Reset Password"
                  description="Generate temp password"
                  onClick={() => queueSupportAction("reset_password", "Reset Password", `Generate a temporary password for ${u.email}. All sessions will be invalidated.`)}
                  loading={isLoading("reset_password")}
                  variant="warning"
                />
                <ActionCard
                  icon={Gauge}
                  label="Clear Rate Limits"
                  description="Reset rate limit counters"
                  onClick={() => onAction(u.id, "clear_rate_limits")}
                  loading={isLoading("clear_rate_limits")}
                />
                <ActionCard
                  icon={LogOut}
                  label="Force Logout All"
                  description="Logout + revoke all API keys"
                  onClick={() => queueSupportAction("force_logout_all", "Force Logout All", `Force logout ${u.email} from all sessions AND revoke all API keys.`)}
                  loading={isLoading("force_logout_all")}
                  variant="warning"
                />
              </div>
            </div>
            
            {/* Account Management */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account Management</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ActionCard
                  icon={Mail}
                  label={u.email_verified_at ? "Unverify Email" : "Verify Email"}
                  description={u.email_verified_at ? "Remove email verification" : "Manually verify email address"}
                  onClick={() => onAction(u.id, u.email_verified_at ? "unverify_email" : "verify_email")}
                  loading={isLoading("verify_email") || isLoading("unverify_email")}
                />
                <ActionCard
                  icon={User}
                  label="Clear Avatar"
                  description="Remove profile picture"
                  onClick={() => onAction(u.id, "clear_avatar")}
                  loading={isLoading("clear_avatar")}
                />
                <ActionCard
                  icon={Shield}
                  label="Toggle Beta Access"
                  description={u.beta_access ? "Disable beta features" : "Enable beta features"}
                  onClick={() => onAction(u.id, "toggle_beta_access")}
                  loading={isLoading("toggle_beta_access")}
                  variant={u.beta_access ? "warning" : "default"}
                />
              </div>
            </div>
            
            {/* Gifted Subscription */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gifted Subscription</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {u.gifted_plan ? (
                  <ActionCard
                    icon={Gift}
                    label="Revoke Gift"
                    description={`Remove gifted ${u.gifted_plan} plan`}
                    onClick={() => queueSupportAction("revoke_gift", "Revoke Gift", `Remove the gifted ${u.gifted_plan} subscription from ${u.email}.`)}
                    loading={isLoading("revoke_gift")}
                    variant="warning"
                  />
                ) : (
                  <ActionCard
                    icon={Gift}
                    label="Gift a Subscription"
                    description="Grant temporary premium access"
                    onClick={() => {
                      const endDate = new Date()
                      endDate.setDate(endDate.getDate() + 30)
                      queueSupportAction("gift_subscription", "Gift Subscription", `Gift a pro supporter subscription to ${u.email} for 30 days.`, { 
                        giftPlan: "pro_supporter", 
                        giftEndDate: endDate.toISOString() 
                      })
                    }}
                    loading={isLoading("gift_subscription")}
                    variant="warning"
                  />
                )}
              </div>
            </div>
            
            {/* Danger Zone */}
            <div className="space-y-3">
              <button
                onClick={() => setShowDangerZone(!showDangerZone)}
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-destructive"
              >
                Danger Zone
                {showDangerZone ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              
              {showDangerZone && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
                  {u.disabled_at ? (
                    <ActionCard
                      icon={CheckCircle2}
                      label="Enable Account"
                      description="Re-enable this user account"
                      onClick={() => onAction(u.id, "enable")}
                      loading={isLoading("enable")}
                      variant="success"
                    />
                  ) : (
                    <ActionCard
                      icon={Ban}
                      label="Disable Account"
                      description="Suspend and force-logout"
                      onClick={() => queueSupportAction("disable", "Disable Account", `Suspend ${u.email}'s account and force logout all sessions. They will not be able to log in until re-enabled.`)}
                      loading={isLoading("disable")}
                      variant="danger"
                    />
                  )}
                  <ActionCard
                    icon={Trash2}
                    label="Delete All Scans"
                    description={`Remove all ${u.scan_count} scan(s)`}
                    onClick={() => queueSupportAction("delete_scans", "Delete All Scans", `Permanently delete all ${u.scan_count} scans for ${u.email}. This cannot be undone.`)}
                    loading={isLoading("delete_scans")}
                    variant="danger"
                  />
                  <ActionCard
                    icon={ExternalLink}
                    label="Delete Webhooks"
                    description="Remove all webhooks"
                    onClick={() => queueSupportAction("delete_webhooks", "Delete Webhooks", `Permanently delete all webhooks for ${u.email}. This cannot be undone.`)}
                    loading={isLoading("delete_webhooks")}
                    variant="danger"
                  />
                  <ActionCard
                    icon={Calendar}
                    label="Delete Schedules"
                    description="Remove scheduled scans"
                    onClick={() => queueSupportAction("delete_schedules", "Delete Schedules", `Permanently delete all scheduled scans for ${u.email}. This cannot be undone.`)}
                    loading={isLoading("delete_schedules")}
                    variant="danger"
                  />
                  <ActionCard
                    icon={Trash2}
                    label="Delete Account"
                    description="Permanently remove user"
                    onClick={() => queueSupportAction("delete_user", "Delete Account", `Permanently delete ${u.email} and all their data. This action cannot be undone.`)}
                    loading={isLoading("delete_user")}
                    variant="danger"
                  />
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
      
      {/* Support Action Confirmation Modal */}
      {pendingSupportAction && (
        <SaveConfirmationModal
          isOpen={true}
          onClose={() => setPendingSupportAction(null)}
          onConfirm={executeSupportAction}
          title={pendingSupportAction.label}
          description={pendingSupportAction.description}
          changes={[{
            field: "action",
            label: "Action",
            oldValue: "Current State",
            newValue: pendingSupportAction.label
          }]}
          loading={isLoading(pendingSupportAction.action)}
          isAdminAction={true}
          affectedUser={{ id: u.id, email: u.email, name: u.name || undefined }}
          confirmText="Confirm"
          variant={["delete", "disable", "delete_scans"].includes(pendingSupportAction.action) ? "destructive" : "default"}
          forceNotify={true}
        />
      )}
      
      {/* Save Changes Modal */}
      {showSaveModal && (
        <SaveConfirmationModal
          isOpen={true}
          onClose={() => setShowSaveModal(false)}
          onConfirm={saveAllChanges}
          title="Save User Changes"
          description="Review and confirm the changes you're about to make."
          changes={buildChanges()}
          loading={!!actionLoading}
          isAdminAction={true}
          affectedUser={{ id: u.id, email: u.email, name: u.name || undefined }}
          confirmText="Save Changes"
        />
      )}
    </Card>
  )
}
