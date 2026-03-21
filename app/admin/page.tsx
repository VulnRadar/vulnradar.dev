"use client"

import React from "react"
import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Users,
  Activity,
  Key,
  CalendarClock,
  Webhook,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Crown,
  CrownIcon,
  Loader2,
  Search,
  BarChart3,
  RefreshCw,
  KeyRound,
  LogOut,
  Ban,
  CheckCircle2,
  ClipboardCopy,
  Eye,
  ArrowLeft,
  Clock,
  AlertTriangle,
  FileText,
  History,
  Shield,
  FileDown,
  XCircle,
  X,
  UserCog,
  Globe,
  ChevronUp,
  ChevronDown,
  Monitor,
  Award,
  Plus,
  Tag,
  Pencil,
  Mail,
  User,
  CreditCard,
  Save,
  Download,
  MailCheck,
  MailX,
  CalendarOff,
  ImageOff,
  UserX,
  Beaker,
  Settings,
  Gift,
  Bell,
  Dot,
  StickyNote,
  Send,
  UsersRound,
  MoreHorizontal,
  ChevronRight,
  ArrowUpRight,
  Copy,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { cn } from "@/lib/utils"
import { PaginationControl, usePagination } from "@/components/ui/pagination-control"
import { STAFF_ROLES, STAFF_ROLE_LABELS, STAFF_ROLE_HIERARCHY, ROLE_BADGE_STYLES, API } from "@/lib/constants"
import {
  hasStaffPermission,
  canManageRole,
  getAvailableActions,
  STAFF_PERMISSIONS,
  type AdminAction
} from "@/lib/permissions-client"
import { NotificationsManager } from "@/components/admin/notifications-manager"
import { SaveConfirmationModal, type ChangeItem, type AffectedUser } from "@/components/save-confirmation-modal"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface AdminStats {
  total_users: string
  total_scans: string
  active_api_keys: string
  active_schedules: string
  active_webhooks: string
  users_with_2fa: string
  scans_24h: string
  new_users_7d: string
  disabled_users: string
  shared_scans: string
}

interface AdminUser {
  id: number
  email: string
  name: string | null
  role: string | null
  avatar_url: string | null
  totp_enabled: boolean
  tos_accepted_at: string | null
  created_at: string
  disabled_at: string | null
  scan_count: number
  api_key_count: number
  plan: string
  subscription_status: string | null
  gifted_plan?: string | null
  gift_end_date?: string | null
}

interface BadgeDef {
  id: number
  name: string
  display_name: string
  description: string | null
  icon: string | null
  color: string | null
  priority: number
  is_limited: boolean
}

interface UserBadge extends BadgeDef {
  awarded_at: string
}

interface AdminNote {
  id: number
  note: string
  created_at: string
  admin_id: number
  admin_email: string
  admin_name: string | null
  admin_avatar_url: string | null
}

interface UserDetail {
  user: AdminUser & {
    session_count: number
    has_backup_codes: boolean
  }
  recentScans: { id: number; url: string; findings_count: number; source: string; scanned_at: string }[]
  apiKeys: { id: number; key_prefix: string; name: string; daily_limit: number; created_at: string; last_used_at: string | null; revoked_at: string | null }[]
  webhooks: { id: number; name: string; url: string; type: string; active: boolean }[]
  schedules: { id: number; url: string; frequency: string; active: boolean; last_run_at: string | null; next_run_at: string | null }[]
  activeSessions: { id: string; created_at: string; expires_at: string; ip_address: string | null; user_agent: string | null }[]
  badges: UserBadge[]
  notes: AdminNote[]
}

interface AuditEntry {
  id: number
  action: string
  details: string | null
  created_at: string
  ip_address: string | null
  admin_id: number
  admin_email: string
  admin_name: string | null
  admin_avatar_url: string | null
  target_email: string | null
  target_name: string | null
  target_avatar_url: string | null
}

interface ActiveAdmin {
  id: number
  email: string
  name: string | null
  role: string
  avatar_url: string | null
  created_at: string
  totp_enabled: boolean
  last_session_created: string | null
  active_sessions: number
  last_admin_action: string | null
  last_action_type: string | null
  last_ip: string | null
  total_actions: number
  actions_24h: number
  last_heartbeat?: string | null
  is_active?: boolean
  current_section?: string
  seconds_since_heartbeat?: number
  recent_actions?: number
}

// --- Toast ---
function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className={cn(
      "fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-xl border px-4 py-3 shadow-lg animate-in slide-in-from-bottom-2",
      type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-destructive/10 border-destructive/30 text-destructive"
    )}>
      {type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100 transition-opacity"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}

// --- Confirm dialog ---
function ConfirmDialog({ open, title, description, confirmLabel, danger, onConfirm, onCancel, children }: {
  open: boolean; title: string; description: string; confirmLabel: string; danger?: boolean
  onConfirm: () => void; onCancel: () => void; children?: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl animate-in zoom-in-95">
        <div className="flex items-start gap-4 mb-4">
          <div className={cn("h-11 w-11 rounded-xl flex items-center justify-center shrink-0", danger ? "bg-destructive/10" : "bg-primary/10")}>
            {danger ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <ShieldCheck className="h-5 w-5 text-primary" />}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{description}</p>
          </div>
        </div>
        {children}
        <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="ghost" onClick={onCancel} className="h-9">Cancel</Button>
          <Button
            className={cn("h-9", danger && "bg-destructive hover:bg-destructive/90 text-destructive-foreground")}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// --- Stat card ---
function StatCard({ label, value, icon: Icon, trend }: { label: string; value: string; icon: React.ElementType; trend?: "up" | "down" | "neutral" }) {
  return (
    <div className="group relative flex flex-col gap-2 p-4 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground/60" />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-foreground tabular-nums">{Number(value).toLocaleString()}</span>
        {trend && (
          <span className={cn(
            "text-xs font-medium",
            trend === "up" ? "text-emerald-500" : trend === "down" ? "text-destructive" : "text-muted-foreground"
          )}>
            {trend === "up" ? "+" : trend === "down" ? "-" : ""}
          </span>
        )}
      </div>
    </div>
  )
}

// --- User avatar ---
function UserAvatar({ name, email, size = "md", avatarUrl }: { name: string | null; email: string; size?: "sm" | "md" | "lg"; avatarUrl?: string | null }) {
  const initial = (name || email).charAt(0).toUpperCase()
  const colors = [
    "bg-primary/15 text-primary",
    "bg-emerald-500/15 text-emerald-500",
    "bg-amber-500/15 text-amber-500",
    "bg-rose-500/15 text-rose-500",
    "bg-violet-500/15 text-violet-500",
  ]
  const colorIdx = email.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length
  const sz = size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-12 w-12 text-base" : "h-9 w-9 text-xs"
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name || email} loading="lazy" className={cn("rounded-full object-cover shrink-0", sz)} />
  }
  return (
    <div className={cn("rounded-full flex items-center justify-center font-semibold shrink-0", sz, colors[colorIdx])}>
      {initial}
    </div>
  )
}

// --- Action badge with human-readable labels ---
const ACTION_META: Record<string, { label: string; verb: string; icon: string; cls: string }> = {
  set_role: { label: "Changed Role", verb: "changed the role of", icon: "shield", cls: "bg-primary/10 text-primary border-primary/20" },
  make_admin: { label: "Promoted to Admin", verb: "promoted to admin", icon: "crown", cls: "bg-primary/10 text-primary border-primary/20" },
  remove_admin: { label: "Removed Admin Role", verb: "removed admin role from", icon: "shield-off", cls: "bg-muted text-muted-foreground border-border" },
  reset_password: { label: "Reset Password", verb: "sent a password reset to", icon: "key", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  revoke_sessions: { label: "Revoked Sessions", verb: "revoked all sessions for", icon: "log-out", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  revoke_api_keys: { label: "Revoked API Keys", verb: "revoked API keys for", icon: "key", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  reset_2fa: { label: "Reset 2FA", verb: "reset two-factor authentication for", icon: "smartphone", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  force_logout_all: { label: "Force Logout", verb: "force logged out", icon: "log-out", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  disable_user: { label: "Disabled", verb: "disabled the account of", icon: "ban", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  disable: { label: "Disabled", verb: "disabled the account of", icon: "ban", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  enable_user: { label: "Enabled", verb: "re-enabled the account of", icon: "check-circle", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  enable: { label: "Enabled", verb: "re-enabled the account of", icon: "check-circle", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  delete_user: { label: "Deleted", verb: "permanently deleted", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  delete: { label: "Deleted", verb: "permanently deleted", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  update_name: { label: "Name Changed", verb: "updated the name of", icon: "user", cls: "bg-muted text-foreground border-border" },
  update_email: { label: "Email Changed", verb: "updated the email of", icon: "mail", cls: "bg-muted text-foreground border-border" },
  update_plan: { label: "Plan Changed", verb: "changed the subscription plan for", icon: "credit-card", cls: "bg-primary/10 text-primary border-primary/20" },
  clear_avatar: { label: "Avatar Cleared", verb: "cleared the avatar of", icon: "image-off", cls: "bg-muted text-muted-foreground border-border" },
  verify_email: { label: "Email Verified", verb: "verified the email of", icon: "mail-check", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  unverify_email: { label: "Email Unverified", verb: "unverified the email of", icon: "mail-x", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  toggle_beta_access: { label: "Beta Access", verb: "toggled beta access for", icon: "flask", cls: "bg-primary/10 text-primary border-primary/20" },
  gift_subscription: { label: "Gifted Plan", verb: "gifted a subscription to", icon: "gift", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  revoke_gift: { label: "Revoked Gift", verb: "revoked gifted subscription from", icon: "gift-off", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  delete_scans: { label: "Scans Deleted", verb: "deleted all scans for", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  delete_webhooks: { label: "Webhooks Deleted", verb: "deleted webhooks for", icon: "webhook-off", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  delete_schedules: { label: "Schedules Deleted", verb: "deleted schedules for", icon: "calendar-off", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  export_data: { label: "Data Exported", verb: "exported data for", icon: "download", cls: "bg-muted text-foreground border-border" },
  clear_rate_limits: { label: "Rate Limits Cleared", verb: "cleared rate limits for", icon: "gauge", cls: "bg-muted text-foreground border-border" },
  award_badge: { label: "Badge Awarded", verb: "awarded a badge to", icon: "award", cls: "bg-primary/10 text-primary border-primary/20" },
  revoke_badge: { label: "Badge Revoked", verb: "revoked a badge from", icon: "award-off", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  create_badge: { label: "Badge Created", verb: "created a new badge", icon: "plus-circle", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  delete_badge: { label: "Badge Deleted", verb: "deleted a badge", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  impersonate: { label: "Impersonation", verb: "started impersonating", icon: "eye", cls: "bg-rose-500/10 text-rose-500 border-rose-500/20" },
  set_scan_limit: { label: "Scan Limit Set", verb: "set scan limit for", icon: "gauge", cls: "bg-muted text-foreground border-border" },
  add_note: { label: "Note Added", verb: "added a note about", icon: "sticky-note", cls: "bg-muted text-foreground border-border" },
  send_notification: { label: "Notification Sent", verb: "sent a notification to", icon: "bell", cls: "bg-primary/10 text-primary border-primary/20" },
}

function ActionBadge({ action }: { action: string }) {
  const fallbackLabel = action.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  const m = ACTION_META[action] || { label: fallbackLabel, cls: "bg-muted text-muted-foreground border-border" }
  return <Badge className={cn("text-[10px] px-2 py-0.5 font-medium border", m.cls)}>{m.label}</Badge>
}

function getActionSentence(log: AuditEntry): string {
  const meta = ACTION_META[log.action]
  const adminName = log.admin_name || log.admin_email.split("@")[0]
  const targetName = log.target_name || (log.target_email ? log.target_email.split("@")[0] : null)
  
  if (meta?.verb) {
    if (targetName) {
      return `${adminName} ${meta.verb} ${targetName}`
    }
    return `${adminName} ${meta.verb.replace(/ (for|to|from|of)$/, "")}`
  }
  
  const actionLabel = log.action.split("_").join(" ")
  return targetName ? `${adminName} performed "${actionLabel}" on ${targetName}` : `${adminName} performed "${actionLabel}"`
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  
  if (diffSecs < 60) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function AdminPage() {
  return <AdminContent />
}

function AdminContent() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [usersPageSize, setUsersPageSize] = useState(10)
  const [searchQuery, setSearchQuery] = useState("")
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null)
  const [activeTab, setActiveTab] = useState<"users" | "audit" | "admins" | "notifications" | "teams">("users")
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; description: string; confirmLabel: string; danger?: boolean
    action: () => Promise<void>; children?: React.ReactNode
  } | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [auditPage, setAuditPage] = useState(1)
  const [auditTotalPages, setAuditTotalPages] = useState(1)
  const [auditPageSize, setAuditPageSize] = useState(10)
  const [expandedLog, setExpandedLog] = useState<number | null>(null)
  const [auditFilter, setAuditFilter] = useState<string>("all")
  const [auditSearch, setAuditSearch] = useState("")
  const [teams, setTeams] = useState<{ id: number; name: string; slug: string; created_at: string; owner_id: number; owner_email: string; owner_name: string | null; owner_avatar_url: string | null; member_count: number }[]>([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [teamsPage, setTeamsPage] = useState(1)
  const [teamsTotalPages, setTeamsTotalPages] = useState(1)
  const [teamsSearch, setTeamsSearch] = useState("")
  const [editingTeam, setEditingTeam] = useState<{ id: number; name: string } | null>(null)
  const [teamMembers, setTeamMembers] = useState<{ team: { id: number; name: string; owner_email: string; owner_name: string | null }; members: { user_id: number; role: string; email: string; name: string | null; avatar_url: string | null }[] } | null>(null)
  const [teamMembersLoading, setTeamMembersLoading] = useState(false)
  const [activeAdmins, setActiveAdmins] = useState<ActiveAdmin[]>([])
  const [adminsLoading, setAdminsLoading] = useState(false)
  const [staffPage, setStaffPage] = useState(1)
  const [staffPageSize, setStaffPageSize] = useState(10)
  const [searchLoading, setSearchLoading] = useState(false)
  const [callerRole, setCallerRole] = useState<string>("user")
  const [auditPaging, setAuditPaging] = useState(false)
  const [allBadges, setAllBadges] = useState<BadgeDef[]>([])
  const searchInitRef = useRef(false)
  
  const staffPagination = usePagination(activeAdmins, staffPageSize)
  const pagedStaff = staffPagination.getPage(staffPage)
  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type })
  }, [])

  const updateUrlWithUser = useCallback((userId: number | null, tab?: string, replace = true) => {
    if (typeof window === "undefined") return
    const parts: string[] = []
    if (tab) parts.push(tab)
    if (userId) parts.push(`user-${userId}`)
    const hash = parts.join("/")
    const method = replace ? "replaceState" : "pushState"
    window.history[method](null, "", hash ? `/admin#${hash}` : "/admin")
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const hash = window.location.hash.replace(/^#/, "")
    if (!hash) return
    const parts = hash.split("/")
    for (const p of parts) {
      if (["users", "teams", "notifications", "admins", "audit"].includes(p)) {
        setActiveTab(p as typeof activeTab)
      } else if (p.startsWith("user-")) {
        const uid = Number(p.replace("user-", ""))
        if (!isNaN(uid)) fetchUserDetail(uid)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handlePop = () => {
      const hash = window.location.hash.replace(/^#/, "")
      if (!hash) {
        setSelectedUser(null)
        return
      }
      const parts = hash.split("/")
      let foundUser = false
      for (const p of parts) {
        if (["users", "teams", "notifications", "admins", "audit"].includes(p)) {
          setActiveTab(p as typeof activeTab)
        } else if (p.startsWith("user-")) {
          const uid = Number(p.replace("user-", ""))
          if (!isNaN(uid)) {
            foundUser = true
            fetchUserDetail(uid)
          }
        }
      }
      if (!foundUser) setSelectedUser(null)
    }
    window.addEventListener("popstate", handlePop)
    return () => window.removeEventListener("popstate", handlePop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchData = useCallback(async (p = 1) => {
    try {
      const url = `/api/v2/admin?page=${p}&limit=${usersPageSize}`
      const res = await fetch(url)
      if (res.status === 403) { setForbidden(true); setLoading(false); return }
      if (!res.ok) throw new Error("Failed to fetch")
      const data = await res.json()
      setStats(data.stats)
      setUsers(data.users)
      setTotalPages(data.pagination?.totalPages || 1)
      setCallerRole(data.callerRole || "user")
    } catch (e) {
      console.error(e)
      showToast("Failed to load admin data", "error")
    } finally {
      setLoading(false)
    }
  }, [usersPageSize, showToast])

  useEffect(() => { fetchData(page) }, [fetchData, page])

  // Search debounce
  useEffect(() => {
    if (!searchInitRef.current) {
      searchInitRef.current = true
      return
    }
    const handler = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setPage(1)
        fetchData(1)
        return
      }
      setSearchLoading(true)
      try {
        const res = await fetch(`/api/v2/admin?search=${encodeURIComponent(searchQuery)}&limit=${usersPageSize}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        setUsers(data.users)
        setTotalPages(data.pagination?.totalPages || 1)
        setPage(1)
      } catch {
        showToast("Search failed", "error")
      } finally {
        setSearchLoading(false)
      }
    }, 400)
    return () => clearTimeout(handler)
  }, [searchQuery, usersPageSize, fetchData, showToast])

  const fetchUserDetail = async (userId: number) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/v2/admin?userId=${userId}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setSelectedUser(data)
      updateUrlWithUser(userId, activeTab, false)
    } catch {
      showToast("Failed to load user details", "error")
    } finally {
      setDetailLoading(false)
    }
  }

  const handleAction = async (userId: number, action: string, extra?: Record<string, unknown>) => {
    const key = `${userId}-${action}`
    setActionLoading(key)
    try {
      const res = await fetch(`/api/v2/admin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Action failed")
      
      if (action === "reset_password" && data.tempPassword) {
        setTempPassword(data.tempPassword)
      }
      
      if (action === "delete") {
        setSelectedUser(null)
        fetchData(page)
        showToast("User deleted", "success")
      } else if (["award_badge", "revoke_badge", "create_badge", "delete_badge"].includes(action)) {
        showToast(data.message || "Badge action completed", "success")
      } else {
        showToast(data.message || `${action.replace(/_/g, " ")} completed`, "success")
        if (!["award_badge", "revoke_badge"].includes(action)) {
          fetchUserDetail(userId)
        }
      }
      setConfirmDialog(null)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Action failed", "error")
    } finally {
      setActionLoading(null)
    }
  }

  const fetchAudit = async (p = 1) => {
    setAuditPaging(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(auditPageSize) })
      if (auditFilter !== "all") params.set("action", auditFilter)
      if (auditSearch.trim()) params.set("search", auditSearch.trim())
      const res = await fetch(`/api/v2/admin/audit?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setAuditLogs(data.logs)
      setAuditTotalPages(data.pagination?.totalPages || 1)
      setAuditPage(p)
    } catch {
      showToast("Failed to load audit logs", "error")
    } finally {
      setAuditPaging(false)
    }
  }

  const fetchActiveAdmins = async () => {
    setAdminsLoading(true)
    try {
      const res = await fetch("/api/v2/admin/active")
      if (!res.ok) throw new Error()
      const data = await res.json()
      setActiveAdmins(data.admins || [])
    } catch {
      showToast("Failed to load staff", "error")
    } finally {
      setAdminsLoading(false)
    }
  }

  const fetchTeams = async (p = 1) => {
    setTeamsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: "10" })
      if (teamsSearch.trim()) params.set("search", teamsSearch.trim())
      const res = await fetch(`/api/v2/admin/teams?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTeams(data.teams)
      setTeamsTotalPages(data.pagination?.totalPages || 1)
      setTeamsPage(p)
    } catch {
      showToast("Failed to load teams", "error")
    } finally {
      setTeamsLoading(false)
    }
  }

  const fetchTeamMembers = async (teamId: number) => {
    setTeamMembersLoading(true)
    try {
      const res = await fetch(`/api/v2/admin/teams/${teamId}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTeamMembers(data)
    } catch {
      showToast("Failed to load team members", "error")
    } finally {
      setTeamMembersLoading(false)
    }
  }

  const handleTeamDelete = async (teamId: number) => {
    try {
      const res = await fetch(`/api/v2/admin/teams/${teamId}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      showToast("Team deleted", "success")
      fetchTeams(teamsPage)
      setConfirmDialog(null)
    } catch {
      showToast("Failed to delete team", "error")
    }
  }

  const handleTeamRename = async () => {
    if (!editingTeam) return
    try {
      const res = await fetch(`/api/v2/admin/teams/${editingTeam.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingTeam.name }),
      })
      if (!res.ok) throw new Error()
      showToast("Team renamed", "success")
      fetchTeams(teamsPage)
      setEditingTeam(null)
    } catch {
      showToast("Failed to rename team", "error")
    }
  }

  const fetchAllBadges = async () => {
  try {
  const res = await fetch("/api/v2/admin?section=badges")
      if (!res.ok) throw new Error()
      const data = await res.json()
      setAllBadges(data.badges || [])
    } catch {
      console.error("Failed to fetch badges")
    }
  }

  useEffect(() => { fetchAllBadges() }, [])

  if (forbidden) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
              <ShieldOff className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Access Denied</h1>
            <p className="text-sm text-muted-foreground max-w-xs">You do not have administrator privileges to access this panel.</p>
            <Button asChild><a href="/dashboard">Back to Scanner</a></Button>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  const ADMIN_TABS = [
    { key: "users" as const, label: "Users", icon: Users },
    { key: "teams" as const, label: "Teams", icon: UsersRound },
    { key: "notifications" as const, label: "Notifications", icon: Bell },
    { key: "admins" as const, label: "Active Staff", icon: Shield },
    { key: "audit" as const, label: "Audit Logs", icon: History },
  ]

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">

        {/* Page header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Manage users, monitor activity, and provide support.</p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading admin data...</p>
          </div>
        ) : (
          <>
            {/* Stat cards - compact grid */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                <StatCard label="Total Users" value={stats.total_users} icon={Users} />
                <StatCard label="Total Scans" value={stats.total_scans} icon={Activity} />
                <StatCard label="Scans (24h)" value={stats.scans_24h} icon={BarChart3} />
                <StatCard label="New Users (7d)" value={stats.new_users_7d} icon={Users} />
                <StatCard label="2FA Users" value={stats.users_with_2fa} icon={ShieldCheck} />
              </div>
            )}

            {/* Tab navigation */}
            <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
              {ADMIN_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key)
                    if (tab.key === "audit") fetchAudit()
                    if (tab.key === "admins") fetchActiveAdmins()
                    if (tab.key === "teams") fetchTeams()
                    setSelectedUser(null)
                    updateUrlWithUser(null, tab.key, false)
                  }}
                  className={cn(
                    "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap",
                    activeTab === tab.key
                      ? "text-primary border-primary"
                      : "text-muted-foreground border-transparent hover:text-foreground hover:border-border",
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* User detail view */}
            {selectedUser && activeTab === "users" && (
              <UserDetailPanel
                detail={selectedUser}
                detailLoading={detailLoading}
                actionLoading={actionLoading}
                callerRole={callerRole}
                allBadges={allBadges}
                onRefreshBadges={fetchAllBadges}
                onBadgesChanged={(awardedIds, revokedIds) => {
                  setSelectedUser((prev) => {
                    if (!prev) return prev
                    const awardedBadges = allBadges
                      .filter((b) => awardedIds.includes(b.id))
                      .map((b) => ({ id: b.id, name: b.name, display_name: b.display_name, color: b.color, awarded_at: new Date().toISOString() } as UserBadge))
                    const kept = prev.badges.filter((b) => !revokedIds.includes(b.id))
                    return { ...prev, badges: [...kept, ...awardedBadges] }
                  })
                }}
                onClose={() => { setSelectedUser(null); setTempPassword(null); updateUrlWithUser(null, activeTab) }}
                onAction={(userId, action, extra) => {
                  if (["set_role", "award_badge", "revoke_badge", "create_badge", "delete_badge", "update_name", "update_email", "update_plan", "enable", "clear_rate_limits", "gift_subscription", "revoke_gift", "add_note", "edit_note", "delete_note"].includes(action)) {
                    handleAction(userId, action, extra)
                    return
                  }
                  const confirmActions = ["delete", "disable", "reset_password", "revoke_sessions", "revoke_api_keys", "reset_2fa", "delete_scans"]
                  if (confirmActions.includes(action)) {
                    const messages: Record<string, { title: string; desc: string; label: string; danger?: boolean }> = {
                      delete: { title: "Delete User", desc: `This will permanently delete ${selectedUser.user.email} and all their data.`, label: "Delete User", danger: true },
                      disable: { title: "Disable Account", desc: `This will suspend ${selectedUser.user.email}'s account.`, label: "Disable Account", danger: true },
                      reset_password: { title: "Reset Password", desc: `Generate a temporary password for ${selectedUser.user.email}.`, label: "Reset Password" },
                      revoke_sessions: { title: "Revoke All Sessions", desc: `Force-logout ${selectedUser.user.email} from all devices.`, label: "Revoke Sessions" },
                      revoke_api_keys: { title: "Revoke All API Keys", desc: `Revoke all active API keys for ${selectedUser.user.email}.`, label: "Revoke Keys" },
                      reset_2fa: { title: "Reset 2FA", desc: `Remove 2FA from ${selectedUser.user.email}'s account.`, label: "Reset 2FA", danger: true },
                      delete_scans: { title: "Delete All Scans", desc: `Delete all scan history for ${selectedUser.user.email}.`, label: "Delete Scans", danger: true },
                    }
                    const m = messages[action]
                    setConfirmDialog({ title: m.title, description: m.desc, confirmLabel: m.label, danger: m.danger ?? false, action: () => handleAction(userId, action) })
                  } else {
                    handleAction(userId, action)
                  }
                }}
                tempPassword={tempPassword}
                onClearTempPassword={() => setTempPassword(null)}
              />
            )}

            {/* Users list */}
            {activeTab === "users" && !selectedUser && (
              <Card className="bg-card border-border overflow-hidden">
                <CardContent className="p-0">
                  {/* Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-border">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold">All Users</h2>
                      <Badge variant="secondary" className="text-[10px]">{stats ? Number(stats.total_users).toLocaleString() : 0}</Badge>
                    </div>
                    <div className="relative w-full sm:w-72">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name or email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 h-9 bg-background"
                      />
                      {searchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                  </div>

                  {/* Table header */}
                  <div className="hidden md:grid grid-cols-[1fr,120px,100px,100px,60px] gap-4 px-4 py-2.5 bg-muted/30 border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <div>User</div>
                    <div>Plan</div>
                    <div>Scans</div>
                    <div>Joined</div>
                    <div></div>
                  </div>

                  {/* User rows */}
                  <div className="divide-y divide-border">
                    {users.map((u) => (
                      <div
                        key={u.id}
                        className="group grid md:grid-cols-[1fr,120px,100px,100px,60px] gap-4 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer items-center"
                        onClick={() => fetchUserDetail(u.id)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <UserAvatar name={u.name} email={u.email} avatarUrl={u.avatar_url} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground truncate">{u.name || u.email.split("@")[0]}</span>
                              {u.role && u.role !== "user" && (
                                <Badge className={cn("text-[9px] px-1.5 py-0", ROLE_BADGE_STYLES[u.role] || "bg-muted")}>
                                  {STAFF_ROLE_LABELS[u.role] || u.role}
                                </Badge>
                              )}
                              {u.disabled_at && <Badge variant="destructive" className="text-[9px] px-1.5 py-0">Disabled</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                        </div>
                        <div className="hidden md:block">
                          <Badge variant="outline" className="text-[10px] capitalize">{u.plan || "free"}</Badge>
                        </div>
                        <div className="hidden md:block text-sm text-muted-foreground tabular-nums">{u.scan_count}</div>
                        <div className="hidden md:block text-xs text-muted-foreground">{formatRelativeTime(new Date(u.created_at))}</div>
                        <div className="hidden md:flex justify-end">
                          <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="px-4 py-3 border-t border-border">
                      <PaginationControl
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        pageSize={usersPageSize}
                        onPageSizeChange={setUsersPageSize}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Teams tab */}
            {activeTab === "teams" && (
              <Card className="bg-card border-border overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-border">
                    <div>
                      <h2 className="text-base font-semibold">Team Management</h2>
                      <p className="text-xs text-muted-foreground">View and manage all platform teams</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative w-full sm:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search teams..."
                          value={teamsSearch}
                          onChange={(e) => setTeamsSearch(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && fetchTeams(1)}
                          className="pl-9 h-9 bg-background"
                        />
                      </div>
                      <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => fetchTeams(1)}>
                        <RefreshCw className={cn("h-3.5 w-3.5", teamsLoading && "animate-spin")} />
                        <span className="hidden sm:inline">Refresh</span>
                      </Button>
                    </div>
                  </div>

                  {teamsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : teams.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <UsersRound className="h-10 w-10 text-muted-foreground/30 mb-3" />
                      <p className="text-sm text-muted-foreground">No teams found</p>
                    </div>
                  ) : (
                    <>
                      <div className="hidden md:grid grid-cols-[1fr,200px,100px,120px,80px] gap-4 px-4 py-2.5 bg-muted/30 border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        <div>Team</div>
                        <div>Owner</div>
                        <div>Members</div>
                        <div>Created</div>
                        <div></div>
                      </div>
                      <div className="divide-y divide-border">
                        {teams.map((team) => (
                          <div key={team.id} className="grid md:grid-cols-[1fr,200px,100px,120px,80px] gap-4 px-4 py-3 hover:bg-muted/30 transition-colors items-center">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{team.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{team.slug}</p>
                            </div>
                            <div className="hidden md:flex items-center gap-2 min-w-0">
                              <UserAvatar name={team.owner_name} email={team.owner_email} size="sm" avatarUrl={team.owner_avatar_url} />
                              <span className="text-sm text-muted-foreground truncate">{team.owner_name || team.owner_email.split("@")[0]}</span>
                            </div>
                            <div className="hidden md:block">
                              <Badge variant="secondary" className="text-[10px]">{team.member_count}</Badge>
                            </div>
                            <div className="hidden md:block text-xs text-muted-foreground">{formatRelativeTime(new Date(team.created_at))}</div>
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => fetchTeamMembers(team.id)}>
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingTeam({ id: team.id, name: team.name })}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_USER) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => setConfirmDialog({
                                    title: "Delete Team",
                                    description: `Delete "${team.name}" and remove all members?`,
                                    confirmLabel: "Delete Team",
                                    danger: true,
                                    action: () => handleTeamDelete(team.id)
                                  })}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {teamsTotalPages > 1 && (
                        <div className="px-4 py-3 border-t border-border">
                          <PaginationControl currentPage={teamsPage} totalPages={teamsTotalPages} onPageChange={(p) => fetchTeams(p)} />
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Notifications tab */}
            {activeTab === "notifications" && (
              <Card className="bg-card border-border">
                <CardContent className="p-4 sm:p-5">
                  <div className="mb-4">
                    <h2 className="text-base font-semibold">Site Notifications</h2>
                    <p className="text-xs text-muted-foreground">Manage platform-wide announcements and alerts</p>
                  </div>
                  <NotificationsManager />
                </CardContent>
              </Card>
            )}

            {/* Active Staff tab */}
            {activeTab === "admins" && (
              <Card className="bg-card border-border overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-border">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold">Staff Members</h2>
                      <Badge variant="secondary" className="text-[10px]">{activeAdmins.length}</Badge>
                    </div>
                    <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={fetchActiveAdmins}>
                      <RefreshCw className={cn("h-3.5 w-3.5", adminsLoading && "animate-spin")} />
                      Refresh
                    </Button>
                  </div>

                  {adminsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : (
                    <>
                      <div className="hidden md:grid grid-cols-[1fr,120px,100px,120px,100px] gap-4 px-4 py-2.5 bg-muted/30 border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        <div>Staff Member</div>
                        <div>Role</div>
                        <div>Sessions</div>
                        <div>Last Action</div>
                        <div>Actions (24h)</div>
                      </div>
                      <div className="divide-y divide-border">
                        {pagedStaff.map((admin) => (
                          <div key={admin.id} className="grid md:grid-cols-[1fr,120px,100px,120px,100px] gap-4 px-4 py-3 hover:bg-muted/30 transition-colors items-center">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="relative">
                                <UserAvatar name={admin.name} email={admin.email} avatarUrl={admin.avatar_url} />
                                {admin.is_active && (
                                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-card" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{admin.name || admin.email.split("@")[0]}</p>
                                <p className="text-xs text-muted-foreground truncate">{admin.email}</p>
                              </div>
                            </div>
                            <div className="hidden md:block">
                              <Badge className={cn("text-[10px]", ROLE_BADGE_STYLES[admin.role] || "bg-muted")}>
                                {STAFF_ROLE_LABELS[admin.role] || admin.role}
                              </Badge>
                            </div>
                            <div className="hidden md:block text-sm text-muted-foreground tabular-nums">{admin.active_sessions}</div>
                            <div className="hidden md:block text-xs text-muted-foreground">
                              {admin.last_admin_action ? formatRelativeTime(new Date(admin.last_admin_action)) : "Never"}
                            </div>
                            <div className="hidden md:block text-sm text-muted-foreground tabular-nums">{admin.actions_24h}</div>
                          </div>
                        ))}
                      </div>
                      {staffPagination.totalPages > 1 && (
                        <div className="px-4 py-3 border-t border-border">
                          <PaginationControl
                            currentPage={staffPage}
                            totalPages={staffPagination.totalPages}
                            onPageChange={setStaffPage}
                            pageSize={staffPageSize}
                            onPageSizeChange={setStaffPageSize}
                          />
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Audit Logs tab */}
            {activeTab === "audit" && (
              <Card className="bg-card border-border overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-border">
                    <div>
                      <h2 className="text-base font-semibold">Audit Log</h2>
                      <p className="text-xs text-muted-foreground">Track all administrative actions</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative w-full sm:w-48">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search logs..."
                          value={auditSearch}
                          onChange={(e) => setAuditSearch(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && fetchAudit(1)}
                          className="pl-9 h-9 bg-background"
                        />
                      </div>
                      <select
                        value={auditFilter}
                        onChange={(e) => { setAuditFilter(e.target.value); fetchAudit(1) }}
                        className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                      >
                        <option value="all">All Actions</option>
                        <option value="set_role">Role Changes</option>
                        <option value="disable">Account Disabled</option>
                        <option value="enable">Account Enabled</option>
                        <option value="delete">Deletions</option>
                        <option value="reset_password">Password Resets</option>
                      </select>
                      <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => fetchAudit(1)}>
                        <RefreshCw className={cn("h-3.5 w-3.5", auditPaging && "animate-spin")} />
                        <span className="hidden sm:inline">Refresh</span>
                      </Button>
                    </div>
                  </div>

                  {auditPaging && auditLogs.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : auditLogs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <History className="h-10 w-10 text-muted-foreground/30 mb-3" />
                      <p className="text-sm text-muted-foreground">No audit logs found</p>
                    </div>
                  ) : (
                    <>
                      <div className="divide-y divide-border">
                        {auditLogs.map((log) => (
                          <div key={log.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                            <div className="flex items-start gap-3">
                              <UserAvatar name={log.admin_name} email={log.admin_email} size="sm" avatarUrl={log.admin_avatar_url} />
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm text-foreground">{getActionSentence(log)}</p>
                                  <ActionBadge action={log.action} />
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                  <span>{formatRelativeTime(new Date(log.created_at))}</span>
                                  {log.ip_address && <span className="font-mono">{log.ip_address}</span>}
                                </div>
                                {log.details && (
                                  <p className="text-xs text-muted-foreground mt-1.5 bg-muted/30 rounded px-2 py-1">{log.details}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {auditTotalPages > 1 && (
                        <div className="px-4 py-3 border-t border-border">
                          <PaginationControl
                            currentPage={auditPage}
                            totalPages={auditTotalPages}
                            onPageChange={(p) => fetchAudit(p)}
                            pageSize={auditPageSize}
                            onPageSizeChange={setAuditPageSize}
                          />
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
      <Footer />

      {/* Confirm Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          open={true}
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          danger={confirmDialog.danger}
          onConfirm={confirmDialog.action}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Team Members Modal */}
      {teamMembers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg mx-4 shadow-2xl animate-in zoom-in-95 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="text-base font-semibold">{teamMembers.team.name}</h3>
                <p className="text-xs text-muted-foreground">{teamMembers.members.length} members</p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTeamMembers(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {teamMembers.members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <UserAvatar name={m.name} email={m.email} size="sm" avatarUrl={m.avatar_url} />
                    <div>
                      <p className="text-sm font-medium">{m.name || m.email.split("@")[0]}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] capitalize">{m.role}</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edit Team Modal */}
      {editingTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-card border border-border rounded-2xl w-full max-w-sm mx-4 p-5 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-base font-semibold mb-4">Rename Team</h3>
            <Input
              value={editingTeam.name}
              onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
              placeholder="Team name"
              className="mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingTeam(null)}>Cancel</Button>
              <Button onClick={handleTeamRename}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// --- User Detail Panel ---
function UserDetailPanel({
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
}: {
  detail: UserDetail
  detailLoading: boolean
  actionLoading: string | null
  onClose: () => void
  onAction: (userId: number, action: string, extra?: Record<string, unknown>) => void
  tempPassword: string | null
  onClearTempPassword: () => void
  callerRole: string
  allBadges: BadgeDef[]
  onRefreshBadges: () => void
  onBadgesChanged: (awardedIds: number[], revokedIds: number[]) => void
}) {
  const u = detail?.user
  
  // Guard against missing user data
  if (!u) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }
  
  const isLoading = (action: string) => actionLoading === `${u.id}-${action}`
  const [showBadgePicker, setShowBadgePicker] = useState(false)
  const [newNote, setNewNote] = useState("")
  const [editingNote, setEditingNote] = useState<{ id: number; text: string } | null>(null)
  const [newBadgeName, setNewBadgeName] = useState("")
  const [newBadgeDisplay, setNewBadgeDisplay] = useState("")
  const [newBadgeColor, setNewBadgeColor] = useState("#6366f1")
  const [showCreateBadge, setShowCreateBadge] = useState(false)
  const [showManageBadges, setShowManageBadges] = useState(false)
  const [copiedPassword, setCopiedPassword] = useState(false)

  const awardedIds = new Set((detail?.badges || []).map((b) => b.id))
  const unawardedBadges = (allBadges || []).filter((b) => !awardedIds.has(b.id))

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
  
  const [pendingSupportAction, setPendingSupportAction] = useState<{
    action: string
    label: string
    description: string
    variant?: "default" | "destructive"
    extraPayload?: Record<string, unknown>
  } | null>(null)

  const hasChanges = Object.keys(pendingChanges).length > 0 || pendingBadgeAwards.length > 0 || pendingBadgeRevokes.length > 0
  
  const modalChanges: ChangeItem[] = [
    ...(pendingChanges.name !== undefined ? [{ field: "name", label: "Display Name", oldValue: u.name || "", newValue: pendingChanges.name as string }] : []),
    ...(pendingChanges.email !== undefined ? [{ field: "email", label: "Email Address", oldValue: u.email, newValue: pendingChanges.email as string }] : []),
    ...(pendingChanges.plan !== undefined ? [{ field: "plan", label: "Subscription Plan", oldValue: u.plan || "free", newValue: pendingChanges.plan as string }] : []),
    ...(pendingChanges.role !== undefined ? [{ field: "role", label: "Staff Role", oldValue: u.role || "user", newValue: pendingChanges.role as string }] : []),
    ...(pendingBadgeAwards.length > 0 ? [{ field: "badges", label: "Badges to Award", oldValue: "", newValue: `+${pendingBadgeAwards.length} badge${pendingBadgeAwards.length !== 1 ? "s" : ""}` }] : []),
    ...(pendingBadgeRevokes.length > 0 ? [{ field: "badges", label: "Badges to Remove", oldValue: `${pendingBadgeRevokes.length} badge${pendingBadgeRevokes.length !== 1 ? "s" : ""}`, newValue: "" }] : []),
  ]
  
  const affectedUser: AffectedUser = { id: u.id, email: u.email, name: u.name || undefined }

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

  const queueSupportAction = (action: string, label: string, description: string, variant?: "default" | "destructive", extraPayload?: Record<string, unknown>) => {
    setPendingSupportAction({ action, label, description, variant, extraPayload })
  }
  
  const executeSupportAction = async (notifyUser: boolean) => {
    if (!pendingSupportAction) return
    await onAction(u.id, pendingSupportAction.action, { 
      ...pendingSupportAction.extraPayload, 
      notifyUser 
    })
    setPendingSupportAction(null)
  }

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

  const copyPassword = async () => {
    if (tempPassword) {
      await navigator.clipboard.writeText(tempPassword)
      setCopiedPassword(true)
      setTimeout(() => setCopiedPassword(false), 2000)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Back button and header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <UserAvatar name={u.name} email={u.email} size="lg" avatarUrl={u.avatar_url} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold truncate">{u.name || u.email.split("@")[0]}</h2>
              {u.role && u.role !== "user" && (
                <Badge className={cn("text-[10px]", ROLE_BADGE_STYLES[u.role] || "bg-muted")}>
                  {STAFF_ROLE_LABELS[u.role] || u.role}
                </Badge>
              )}
              {u.disabled_at && <Badge variant="destructive" className="text-[10px]">Disabled</Badge>}
            </div>
            <p className="text-sm text-muted-foreground truncate">{u.email}</p>
          </div>
        </div>
        {hasChanges && (
          <Button onClick={() => setShowSaveModal(true)} className="gap-2">
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
        )}
      </div>

      {/* Temp password banner */}
      {tempPassword && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-3">
            <KeyRound className="h-4 w-4 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-amber-500">Temporary Password</p>
              <p className="text-xs text-muted-foreground font-mono">{tempPassword}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={copyPassword}>
              {copiedPassword ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedPassword ? "Copied" : "Copy"}
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={onClearTempPassword}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column - Account info */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Account details card */}
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">Account Details</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setAccountEditMode(!accountEditMode)}
                >
                  {accountEditMode ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                  {accountEditMode ? "Cancel" : "Edit"}
                </Button>
              </div>

              {accountEditMode ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Display Name</label>
                    <Input
                      value={editName}
                      onChange={(e) => {
                        setEditName(e.target.value)
                        addPendingChange("name", e.target.value, u.name || "")
                      }}
                      placeholder="Name"
                      className="h-9"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Email</label>
                    <Input
                      value={editEmail}
                      onChange={(e) => {
                        setEditEmail(e.target.value)
                        addPendingChange("email", e.target.value, u.email)
                      }}
                      placeholder="Email"
                      className="h-9"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Plan</label>
                    <select
                      value={editPlan}
                      onChange={(e) => {
                        setEditPlan(e.target.value)
                        addPendingChange("plan", e.target.value, u.plan || "free")
                      }}
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                    >
                      <option value="free">Free</option>
                      <option value="core_supporter">Core Supporter</option>
                      <option value="pro_supporter">Pro Supporter</option>
                      <option value="elite_supporter">Elite Supporter</option>
                    </select>
                  </div>
                  {hasStaffPermission(callerRole, STAFF_PERMISSIONS.EDIT_USER_ROLE) && canManageRole(callerRole, u.role || "user") && (
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">Role</label>
                      <select
                        value={editRole}
                        onChange={(e) => {
                          setEditRole(e.target.value)
                          addPendingChange("role", e.target.value, u.role || "user")
                        }}
                        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                      >
                        {Object.entries(STAFF_ROLE_LABELS)
                          .filter(([role]) => canManageRole(callerRole, role))
                          .map(([role, label]) => (
                            <option key={role} value={role}>{label}</option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Name</p>
                      <p className="text-sm font-medium">{u.name || "Not set"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Email</p>
                      <p className="text-sm font-medium truncate">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Plan</p>
                      <p className="text-sm font-medium capitalize">{u.plan || "Free"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Role</p>
                      <p className="text-sm font-medium">{STAFF_ROLE_LABELS[u.role || "user"] || "User"}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stats cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl border border-border bg-card/50">
              <p className="text-2xl font-semibold tabular-nums">{u.scan_count}</p>
              <p className="text-xs text-muted-foreground">Scans</p>
            </div>
            <div className="p-3 rounded-xl border border-border bg-card/50">
              <p className="text-2xl font-semibold tabular-nums">{u.api_key_count}</p>
              <p className="text-xs text-muted-foreground">API Keys</p>
            </div>
            <div className="p-3 rounded-xl border border-border bg-card/50">
              <p className="text-2xl font-semibold tabular-nums">{u.session_count}</p>
              <p className="text-xs text-muted-foreground">Sessions</p>
            </div>
            <div className="p-3 rounded-xl border border-border bg-card/50">
              <div className="flex items-center gap-2">
                {u.totp_enabled ? (
                  <ShieldCheck className="h-5 w-5 text-emerald-500" />
                ) : (
                  <ShieldOff className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">2FA {u.totp_enabled ? "On" : "Off"}</p>
            </div>
          </div>

          {/* Recent scans */}
          {detail.recentScans.length > 0 && (
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-3">Recent Scans</h3>
                <div className="space-y-2">
                  {detail.recentScans.slice(0, 5).map((scan) => (
                    <div key={scan.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate">{scan.url}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge variant={scan.findings_count > 0 ? "destructive" : "secondary"} className="text-[10px]">
                          {scan.findings_count} issues
                        </Badge>
                        <span className="text-xs text-muted-foreground">{formatRelativeTime(new Date(scan.scanned_at))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column - Actions */}
        <div className="flex flex-col gap-4">
          {/* Quick actions */}
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
              <div className="grid gap-2">
                <ActionCard
                  icon={LogOut}
                  label="Force Logout"
                  description={`Revoke all ${u.session_count} sessions`}
                  color="text-primary"
                  bg="bg-primary/10"
                  loading={isLoading("revoke_sessions")}
                  onClick={() => queueSupportAction("revoke_sessions", "Force Logout", `Revoke all ${u.session_count} sessions for ${u.name || u.email}`)}
                />
                <ActionCard
                  icon={Key}
                  label="Revoke API Keys"
                  description={`Invalidate all ${u.api_key_count} keys`}
                  color="text-amber-500"
                  bg="bg-amber-500/10"
                  loading={isLoading("revoke_api_keys")}
                  onClick={() => queueSupportAction("revoke_api_keys", "Revoke API Keys", `Invalidate all ${u.api_key_count} API keys for ${u.name || u.email}`)}
                />
                {hasStaffPermission(callerRole, STAFF_PERMISSIONS.RESET_USER_PASSWORD) && (
                  <ActionCard
                    icon={KeyRound}
                    label="Reset Password"
                    description={u.totp_enabled ? "Unavailable: 2FA enabled" : "Generate temp password"}
                    color="text-amber-500"
                    bg="bg-amber-500/10"
                    disabled={u.totp_enabled}
                    loading={isLoading("reset_password")}
                    onClick={() => queueSupportAction("reset_password", "Reset Password", `Generate a temporary password for ${u.name || u.email}`)}
                  />
                )}
                {hasStaffPermission(callerRole, STAFF_PERMISSIONS.RESET_USER_2FA) && u.totp_enabled && (
                  <ActionCard
                    icon={ShieldOff}
                    label="Reset 2FA"
                    description="Remove two-factor auth"
                    color="text-amber-500"
                    bg="bg-amber-500/10"
                    loading={isLoading("reset_2fa")}
                    onClick={() => queueSupportAction("reset_2fa", "Reset 2FA", `Remove two-factor authentication for ${u.name || u.email}`)}
                  />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Danger zone */}
          <Card className="bg-card border-destructive/20">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-destructive mb-3">Danger Zone</h3>
              <div className="grid gap-2">
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
                {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_USER) && (
                  <ActionCard
                    icon={Trash2}
                    label="Delete Account"
                    description="Permanently remove user"
                    color="text-destructive"
                    bg="bg-destructive/10"
                    variant="danger"
                    onClick={() => queueSupportAction("delete", "Delete Account", `Permanently remove ${u.name || u.email}'s account. This cannot be undone.`, "destructive")}
                  />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Badges */}
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Badges</h3>
                <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setShowBadgePicker(!showBadgePicker)}>
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
              {detail.badges.length === 0 && pendingBadgeAwards.length === 0 ? (
                <p className="text-xs text-muted-foreground">No badges awarded</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {detail.badges
                    .filter((b) => !pendingBadgeRevokes.includes(b.id))
                    .map((badge) => (
                      <Badge
                        key={badge.id}
                        style={{ backgroundColor: `${badge.color}20`, color: badge.color || undefined, borderColor: `${badge.color}40` }}
                        className="text-[10px] px-2 py-0.5 border cursor-pointer hover:opacity-80"
                        onClick={() => {
                          setPendingBadgeRevokes((prev) => [...prev, badge.id])
                        }}
                      >
                        {badge.display_name}
                        <X className="h-3 w-3 ml-1" />
                      </Badge>
                    ))}
                  {pendingBadgeAwards.map((id) => {
                    const badge = allBadges.find((b) => b.id === id)
                    if (!badge) return null
                    return (
                      <Badge
                        key={id}
                        style={{ backgroundColor: `${badge.color}20`, color: badge.color || undefined, borderColor: `${badge.color}40` }}
                        className="text-[10px] px-2 py-0.5 border opacity-70"
                      >
                        + {badge.display_name}
                      </Badge>
                    )
                  })}
                </div>
              )}
              {showBadgePicker && unawardedBadges.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-2">Available badges:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {unawardedBadges
                      .filter((b) => !pendingBadgeAwards.includes(b.id))
                      .map((badge) => (
                        <Badge
                          key={badge.id}
                          variant="outline"
                          style={{ borderColor: `${badge.color}40` }}
                          className="text-[10px] px-2 py-0.5 cursor-pointer hover:bg-muted/50"
                          onClick={() => {
                            setPendingBadgeAwards((prev) => [...prev, badge.id])
                          }}
                        >
                          + {badge.display_name}
                        </Badge>
                      ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Save Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onConfirm={async (notify) => {
          setNotifyUserOnSave(notify ?? true)
          await saveAllChanges()
          setShowSaveModal(false)
        }}
        title="Confirm Changes"
        description={`Review the changes you're about to apply to ${u.name || u.email}'s account.`}
        changes={modalChanges}
        loading={isSaving}
        isAdminAction={true}
        affectedUser={affectedUser}
        confirmText="Apply Changes"
      />

      {/* Support Action Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={!!pendingSupportAction}
        onClose={() => setPendingSupportAction(null)}
        onConfirm={async (notify) => {
          await executeSupportAction(notify ?? true)
        }}
        title={pendingSupportAction?.label || "Confirm Action"}
        description={pendingSupportAction?.description || "Are you sure?"}
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

      {/* Gift Modal */}
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
            queueSupportAction("gift_subscription", "Gift Subscription", `Gift ${plan.replace("_", " ")} plan to ${u.name || u.email}`, "default", { giftPlan: plan, giftEndDate: endDate })
          }}
          onRevoke={() => {
            setShowGiftModal(false)
            queueSupportAction("revoke_gift", "Revoke Gift", `Remove gifted subscription from ${u.name || u.email}`, "destructive")
          }}
        />
      )}
    </div>
  )
}

// --- Action Card ---
function ActionCard({ icon: Icon, label, description, color, bg, variant, disabled, loading, onClick }: {
  icon: React.ElementType; label: string; description: string
  color: string; bg: string; variant?: "danger" | "success"
  disabled?: boolean; loading?: boolean; onClick: () => void
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl border transition-all text-left w-full",
        disabled
          ? "border-border bg-muted/20 opacity-50 cursor-not-allowed"
          : variant === "danger"
            ? "border-destructive/20 bg-card hover:bg-destructive/5 cursor-pointer"
            : variant === "success"
              ? "border-emerald-500/20 bg-card hover:bg-emerald-500/5 cursor-pointer"
              : "border-border bg-card hover:bg-muted/30 cursor-pointer",
      )}
      disabled={disabled || loading}
      onClick={onClick}
    >
      <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", bg)}>
        {loading ? <Loader2 className={cn("h-4 w-4 animate-spin", color)} /> : <Icon className={cn("h-4 w-4", color)} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-medium", variant === "danger" ? "text-destructive" : variant === "success" ? "text-emerald-500" : "text-foreground")}>{label}</p>
        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{description}</p>
      </div>
    </button>
  )
}

// --- Gift Subscription Modal ---
function GiftSubscriptionModal({
  open,
  onClose,
  onGift,
  onRevoke,
  isLoading,
  existingGift,
}: {
  open: boolean
  onClose: () => void
  onGift: (plan: string, endDate: string) => void
  onRevoke: () => void
  isLoading: boolean
  existingGift?: { plan: string; end_date: string } | null
}) {
  const [giftPlan, setGiftPlan] = useState(existingGift?.plan || "pro_supporter")
  const [giftEndDate, setGiftEndDate] = useState(
    existingGift?.end_date ? new Date(existingGift.end_date).toISOString().slice(0, 16) : ""
  )
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  useEffect(() => {
    if (open) {
      setGiftPlan(existingGift?.plan || "pro_supporter")
      setGiftEndDate(existingGift?.end_date ? new Date(existingGift.end_date).toISOString().slice(0, 16) : "")
      setConfirmRevoke(false)
    }
  }, [open, existingGift])

  if (!open) return null

  const planLabels: Record<string, string> = {
    core_supporter: "Core Supporter",
    pro_supporter: "Pro Supporter",
    elite_supporter: "Elite Supporter",
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md mx-4 shadow-2xl animate-in zoom-in-95 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <CrownIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-base font-semibold">{existingGift ? "Manage Gift" : "Gift Subscription"}</h3>
              <p className="text-xs text-muted-foreground">
                {existingGift ? `Active until ${new Date(existingGift.end_date).toLocaleDateString()}` : "Grant temporary premium access"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Plan</label>
              <select
                value={giftPlan}
                onChange={(e) => setGiftPlan(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="core_supporter">Core Supporter</option>
                <option value="pro_supporter">Pro Supporter</option>
                <option value="elite_supporter">Elite Supporter</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Expires</label>
              <input
                type="datetime-local"
                value={giftEndDate}
                onChange={(e) => setGiftEndDate(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button className="flex-1" disabled={!giftEndDate || isLoading} onClick={() => onGift(giftPlan, new Date(giftEndDate).toISOString())}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CrownIcon className="h-4 w-4 mr-2" />}
              {existingGift ? "Update Gift" : "Gift Plan"}
            </Button>
            <Button variant="ghost" className="flex-1" onClick={onClose} disabled={isLoading}>Cancel</Button>
          </div>

          {existingGift && (
            <div className="pt-3 border-t border-border">
              {!confirmRevoke ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-destructive border-destructive/30 hover:bg-destructive/5"
                  onClick={() => setConfirmRevoke(true)}
                  disabled={isLoading}
                >
                  <Ban className="h-4 w-4 mr-2" />
                  Revoke Gift
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="flex-1 bg-destructive hover:bg-destructive/90"
                    onClick={onRevoke}
                    disabled={isLoading}
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Yes, Revoke"}
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => setConfirmRevoke(false)} disabled={isLoading}>
                    Keep Gift
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
