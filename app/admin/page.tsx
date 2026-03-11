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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
}

// --- Toast ---
function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className={cn(
      "fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-lg border px-4 py-3 shadow-lg animate-in slide-in-from-bottom-2",
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
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl animate-in zoom-in-95">
        <div className="flex items-start gap-3 mb-3">
          <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center shrink-0", danger ? "bg-destructive/10" : "bg-primary/10")}>
            {danger ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <ShieldCheck className="h-5 w-5 text-primary" />}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
          </div>
        </div>
        {children}
        <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-border">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            className={danger ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : ""}
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
function StatCard({ label, value, icon: Icon, color, accent }: { label: string; value: string; icon: React.ElementType; color: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
      <div className={cn("absolute top-0 left-0 w-full h-0.5", accent)} />
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center bg-muted/50")}>
          <Icon className={cn("h-4 w-4", color)} />
        </div>
      </div>
      <span className="text-2xl font-bold text-foreground tracking-tight">{Number(value).toLocaleString()}</span>
    </div>
  )
}

// --- User avatar ---
function UserAvatar({ name, email, size = "md", avatarUrl }: { name: string | null; email: string; size?: "sm" | "md"; avatarUrl?: string | null }) {
  const initial = (name || email).charAt(0).toUpperCase()
  const colors = [
    "bg-primary/15 text-primary",
    "bg-emerald-500/15 text-emerald-500",
    "bg-[hsl(var(--severity-medium))]/15 text-[hsl(var(--severity-medium))]",
    "bg-[hsl(var(--severity-high))]/15 text-[hsl(var(--severity-high))]",
    "bg-[hsl(var(--severity-low))]/15 text-[hsl(var(--severity-low))]",
  ]
  const colorIdx = email.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length
  const sz = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs"
  if (avatarUrl) {
    return (
      <img src={avatarUrl} alt={name || email} loading="lazy" className={cn("rounded-full object-cover shrink-0", sz)} />
    )
  }
  return (
    <div className={cn("rounded-full flex items-center justify-center font-bold shrink-0", sz, colors[colorIdx])}>
      {initial}
    </div>
  )
}

// --- Action badge with human-readable labels ---
// Action metadata for audit log display
const ACTION_META: Record<string, { label: string; verb: string; icon: string; cls: string }> = {
  // Role changes
  set_role: { label: "Changed Role", verb: "changed the role of", icon: "shield", cls: "bg-primary/10 text-primary border-primary/20" },
  make_admin: { label: "Promoted to Admin", verb: "promoted to admin", icon: "crown", cls: "bg-primary/10 text-primary border-primary/20" },
  remove_admin: { label: "Removed Admin Role", verb: "removed admin role from", icon: "shield-off", cls: "bg-muted text-muted-foreground border-border" },
  // Security actions
  reset_password: { label: "Reset Password", verb: "sent a password reset to", icon: "key", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  revoke_sessions: { label: "Revoked Sessions", verb: "revoked all sessions for", icon: "log-out", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  revoke_api_keys: { label: "Revoked API Keys", verb: "revoked API keys for", icon: "key", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  reset_2fa: { label: "Reset 2FA", verb: "reset two-factor authentication for", icon: "smartphone", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  force_logout_all: { label: "Force Logout", verb: "force logged out", icon: "log-out", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  // Account status
  disable_user: { label: "Disabled", verb: "disabled the account of", icon: "ban", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  disable: { label: "Disabled", verb: "disabled the account of", icon: "ban", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  enable_user: { label: "Enabled", verb: "re-enabled the account of", icon: "check-circle", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  enable: { label: "Enabled", verb: "re-enabled the account of", icon: "check-circle", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  delete_user: { label: "Deleted", verb: "permanently deleted", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  delete: { label: "Deleted", verb: "permanently deleted", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  // Profile updates
  update_name: { label: "Name Changed", verb: "updated the name of", icon: "user", cls: "bg-muted text-foreground border-border" },
  update_email: { label: "Email Changed", verb: "updated the email of", icon: "mail", cls: "bg-muted text-foreground border-border" },
  update_plan: { label: "Plan Changed", verb: "changed the subscription plan for", icon: "credit-card", cls: "bg-primary/10 text-primary border-primary/20" },
  clear_avatar: { label: "Avatar Cleared", verb: "cleared the avatar of", icon: "image-off", cls: "bg-muted text-muted-foreground border-border" },
  // Email verification
  verify_email: { label: "Email Verified", verb: "verified the email of", icon: "mail-check", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  unverify_email: { label: "Email Unverified", verb: "unverified the email of", icon: "mail-x", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  // Beta & Premium
  toggle_beta_access: { label: "Beta Access", verb: "toggled beta access for", icon: "flask", cls: "bg-primary/10 text-primary border-primary/20" },
  // Gift subscriptions
  gift_subscription: { label: "Gifted Plan", verb: "gifted a subscription to", icon: "gift", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  revoke_gift: { label: "Revoked Gift", verb: "revoked gifted subscription from", icon: "gift-off", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  // Data management
  delete_scans: { label: "Scans Deleted", verb: "deleted all scans for", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  delete_webhooks: { label: "Webhooks Deleted", verb: "deleted webhooks for", icon: "webhook-off", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  delete_schedules: { label: "Schedules Deleted", verb: "deleted schedules for", icon: "calendar-off", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  export_data: { label: "Data Exported", verb: "exported data for", icon: "download", cls: "bg-muted text-foreground border-border" },
  clear_rate_limits: { label: "Rate Limits Cleared", verb: "cleared rate limits for", icon: "gauge", cls: "bg-muted text-foreground border-border" },
  // Badges
  award_badge: { label: "Badge Awarded", verb: "awarded a badge to", icon: "award", cls: "bg-primary/10 text-primary border-primary/20" },
  revoke_badge: { label: "Badge Revoked", verb: "revoked a badge from", icon: "award-off", cls: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  create_badge: { label: "Badge Created", verb: "created a new badge", icon: "plus-circle", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  delete_badge: { label: "Badge Deleted", verb: "deleted a badge", icon: "trash-2", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  // Admin
  impersonate: { label: "Impersonation", verb: "started impersonating", icon: "eye", cls: "bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))] border-[hsl(var(--severity-high))]/20" },
  set_scan_limit: { label: "Scan Limit Set", verb: "set scan limit for", icon: "gauge", cls: "bg-muted text-foreground border-border" },
  add_note: { label: "Note Added", verb: "added a note about", icon: "sticky-note", cls: "bg-muted text-foreground border-border" },
  send_notification: { label: "Notification Sent", verb: "sent a notification to", icon: "bell", cls: "bg-primary/10 text-primary border-primary/20" },
}

function ActionBadge({ action }: { action: string }) {
  // Fallback: convert snake_case to readable format
  const fallbackLabel = action.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  const m = ACTION_META[action] || { label: fallbackLabel, cls: "bg-muted text-muted-foreground border-border" }
  return <Badge className={cn("text-[10px] px-2 py-0.5 font-medium", m.cls)}>{m.label}</Badge>
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
  
  // Fallback
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
  const [activeTab, setActiveTab] = useState<"users" | "audit" | "admins">("users")
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

  // Sync user/tab selection with URL hash
  // pushState when navigating to a user (back button works), replaceState when closing/switching tabs
  const updateUrlWithUser = useCallback((userId: number | null, tab?: string, replace = true) => {
    if (typeof window === "undefined") return
    const parts: string[] = []
    if (tab) parts.push(tab)
    if (userId) parts.push(`user-${userId}`)
    const hash = parts.join("/")
    const method = replace ? "replaceState" : "pushState"
    window.history[method](null, "", `/admin${hash ? `#${hash}` : ""}`)
  }, [])

  // Parse hash and load corresponding data
  const handleHashChange = useCallback(() => {
    if (typeof window === "undefined") return
    const hash = window.location.hash.replace("#", "")
    if (!hash) {
      // Set default hash to #users if none provided
      window.history.replaceState(null, "", "/admin#users")
      setSelectedUser(null)
      return
    }

    const parts = hash.split("/")
    let foundUser = false
    for (const part of parts) {
      // Check if it's a tab
      if (["users", "audit", "admins"].includes(part)) {
        setActiveTab(part as "users" | "audit" | "admins")
        if (part === "audit") fetchAudit()
        if (part === "admins") fetchActiveAdmins()
      }
      // Check if it's a user ID
      if (part.startsWith("user-")) {
        const id = parseInt(part.replace("user-", ""), 10)
        if (!isNaN(id)) {
          fetchUserDetail(id, true) // Skip URL update on initial load
          foundUser = true
        }
      }
    }
    if (!foundUser) setSelectedUser(null)
  }, [activeTab])

  // Load from hash on mount and listen for hash changes
  useEffect(() => {
    handleHashChange()
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [handleHashChange])

  async function fetchData(p = 1, search = searchQuery, isInitial = false, limit = usersPageSize) {
    if (isInitial) setLoading(true)
    else setSearchLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) })
      if (search.trim()) params.set("search", search.trim())
      const res = await fetch(`${API.ADMIN}?${params}`)
      if (res.status === 403) { setForbidden(true); setLoading(false); setSearchLoading(false); return }
      const data = await res.json()
      setStats(data.stats)
      setUsers(data.users)
      setPage(data.page)
      setTotalPages(data.totalPages)
      if (data.callerRole) setCallerRole(data.callerRole)
    } catch { setForbidden(true) }
    setLoading(false)
    setSearchLoading(false)
  }

  async function fetchAudit(p = 1, limit = auditPageSize) {
    setAuditPaging(true)
    try {
      const res = await fetch(`${API.ADMIN}?section=audit&page=${p}&limit=${limit}`)
      const data = await res.json()
      setAuditLogs(data.logs)
      setAuditPage(data.page)
      setAuditTotalPages(data.totalPages)
    } catch { /* ignore */ }
    setAuditPaging(false)
  }

  async function fetchActiveAdmins() {
    setAdminsLoading(true)
    try {
      const res = await fetch(`${API.ADMIN}?section=active-admins`)
      const data = await res.json()
      setActiveAdmins(data.admins || [])
    } catch { /* ignore */ }
    setAdminsLoading(false)
  }

  async function fetchUserDetail(userId: number, skipUrlUpdate = false) {
    setDetailLoading(true)
    try {
      const res = await fetch(`${API.ADMIN}?section=user-detail&userId=${userId}`)
      const data = await res.json()
      setSelectedUser(data)
      // pushState=false so back button returns to previous tab/list
      if (!skipUrlUpdate) updateUrlWithUser(userId, activeTab, false)
    } catch { showToast("Failed to load user details.", "error") }
    setDetailLoading(false)
  }

  async function fetchAllBadges() {
    try {
      const res = await fetch(`${API.ADMIN}?section=badges`)
      if (res.ok) {
        const data = await res.json()
        setAllBadges(data.badges || [])
      }
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchData(1, "", true); fetchAllBadges() }, [])

  useEffect(() => {
    if (activeTab === "audit") fetchAudit()
    if (activeTab === "admins") fetchActiveAdmins()
  }, [activeTab])

  async function handleAction(userId: number, action: string, extra?: Record<string, unknown>) {
    setActionLoading(`${userId}-${action}`)
    try {
      const res = await fetch(API.ADMIN, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action, ...extra }),
      })
      const data = await res.json()
      if (res.ok) {
        if (action === "reset_password" && data.tempPassword) setTempPassword(data.tempPassword)
        const labels: Record<string, string> = {
          set_role: "User role updated.",
          make_admin: "User promoted to admin.",
          remove_admin: "Admin privileges removed.",
          reset_password: "Password has been reset.",
          revoke_sessions: "All sessions revoked.",
          revoke_api_keys: "All API keys revoked.",
          disable: "Account disabled.",
          enable: "Account re-enabled.",
          delete: "User deleted.",
          award_badge: "Badge awarded.",
          revoke_badge: "Badge removed from user.",
          create_badge: "Badge created.",
          delete_badge: "Badge deleted permanently.",
          update_name: "Name updated.",
          update_email: "Email updated.",
          update_plan: "Plan updated.",
          reset_2fa: "Two-factor authentication reset.",
          delete_scans: "All scans deleted.",



          clear_rate_limits: "Rate limits cleared.",
          gift_subscription: "Subscription gifted successfully.",
          revoke_gift: "Gifted subscription revoked.",
        }
        if (action === "create_badge" || action === "delete_badge") { fetchAllBadges() }
        showToast(labels[action] || "Action completed.", "success")
        // Badge award/revoke: caller handles optimistic update — no fetch needed
        const skipRefetch = action === "award_badge" || action === "revoke_badge"
        if (!skipRefetch) {
          await fetchData(page)
          if (selectedUser && selectedUser.user.id === userId) {
            if (action === "delete") { setSelectedUser(null); updateUrlWithUser(null, activeTab) }
            else await fetchUserDetail(userId)
          }
        }
      } else {
        showToast(data.error || "Action failed.", "error")
      }
    } catch { showToast("Action failed.", "error") }
    setActionLoading(null)
    setConfirmDialog(null)
  }

  // Debounced server-side search
  useEffect(() => {
    if (!searchInitRef.current) {
      searchInitRef.current = true
      return
    }
    setSearchLoading(true)
    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: "1" })
        if (searchQuery.trim()) params.set("search", searchQuery.trim())
        const res = await fetch(`${API.ADMIN}?${params}`)
        if (res.ok) {
          const data = await res.json()
          setUsers(data.users)
          setPage(data.page)
          setTotalPages(data.totalPages)
        }
      } catch { /* ignore */ }
      setSearchLoading(false)
    }, 300)
    return () => { clearTimeout(timeout); setSearchLoading(false) }
  }, [searchQuery])

  // Forbidden screen
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-8">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Admin Panel</h1>
            <p className="text-sm text-muted-foreground">Manage users, monitor activity, and provide support.</p>
          </div>
          <Button variant="outline" size="sm" className="gap-2 self-start sm:self-auto" onClick={() => { fetchData(page); if (activeTab === "audit") fetchAudit(auditPage); if (activeTab === "admins") fetchActiveAdmins(); }}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading admin data...</p>
          </div>
        ) : (
          <>
            {/* Stat cards */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                <StatCard label="Total Users" value={stats.total_users} icon={Users} color="text-primary" accent="bg-primary" />
                <StatCard label="Total Scans" value={stats.total_scans} icon={Activity} color="text-primary" accent="bg-primary" />
                <StatCard label="Scans (24h)" value={stats.scans_24h} icon={BarChart3} color="text-emerald-500" accent="bg-emerald-500" />
                <StatCard label="New Users (7d)" value={stats.new_users_7d} icon={Users} color="text-emerald-500" accent="bg-emerald-500" />
                <StatCard label="Shared Scans" value={stats.shared_scans} icon={Globe} color="text-primary" accent="bg-primary/70" />
                <StatCard label="API Keys" value={stats.active_api_keys} icon={Key} color="text-[hsl(var(--severity-medium))]" accent="bg-[hsl(var(--severity-medium))]" />
                <StatCard label="Schedules" value={stats.active_schedules} icon={CalendarClock} color="text-[hsl(var(--severity-low))]" accent="bg-[hsl(var(--severity-low))]" />
                <StatCard label="Webhooks" value={stats.active_webhooks} icon={Webhook} color="text-muted-foreground" accent="bg-muted-foreground/50" />
                <StatCard label="2FA Users" value={stats.users_with_2fa} icon={ShieldCheck} color="text-emerald-500" accent="bg-emerald-500/50" />
                <StatCard label="Disabled" value={stats.disabled_users} icon={Ban} color="text-destructive" accent="bg-destructive" />
              </div>
            )}

            {/* Tab navigation */}
            <div className="flex items-center gap-1 border-b border-border -mb-px">
              {([
                { key: "users" as const, label: "Users", icon: Users },
                { key: "audit" as const, label: "Audit Log", icon: History },
                { key: "admins" as const, label: "Staff", icon: Shield },
              ]).map((tab) => (
                <a
                  key={tab.key}
                  href={`/admin#${tab.key}`}
                  onClick={(e) => {
                    if (!e.ctrlKey && !e.metaKey) {
                      e.preventDefault()
                      setActiveTab(tab.key)
                      if (tab.key === "audit") fetchAudit()
                      if (tab.key === "admins") fetchActiveAdmins()
                      setSelectedUser(null)
                      updateUrlWithUser(null, tab.key, false)
                    }
                  }}
                  className={cn(
                    "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                    activeTab === tab.key
                      ? "text-foreground border-foreground"
                      : "text-muted-foreground border-transparent hover:text-foreground hover:border-border",
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </a>
              ))}
            </div>

            {/* User detail */}
            {selectedUser && activeTab === "users" && (
              <UserDetailPanel
                detail={selectedUser}
                detailLoading={detailLoading}
                actionLoading={actionLoading}
                callerRole={callerRole}
                allBadges={allBadges}
                onRefreshBadges={fetchAllBadges}
                onBadgesChanged={(awardedIds, revokedIds) => {
                  // Optimistically patch selectedUser badges without re-fetching
                  setSelectedUser((prev) => {
                    if (!prev) return prev
                    const awardedBadges = allBadges
                      .filter((b) => awardedIds.includes(b.id))
                      .map((b) => ({ id: b.id, name: b.name, display_name: b.display_name, color: b.color, awarded_at: new Date().toISOString() }))
                    const kept = prev.badges.filter((b) => !revokedIds.includes(b.id))
                    return { ...prev, badges: [...kept, ...awardedBadges] }
                  })
                }}
                onClose={() => { setSelectedUser(null); setTempPassword(null); updateUrlWithUser(null, activeTab) }}
                onAction={(userId, action, extra) => {
                  // Actions that don't need confirmation
                  if (["set_role", "award_badge", "revoke_badge", "create_badge", "delete_badge", "update_name", "update_email", "update_plan", "enable", "clear_rate_limits", "gift_subscription", "revoke_gift"].includes(action)) {
                    handleAction(userId, action, extra)
                    return
                  }
                  // Actions that need confirmation
                  const confirmActions = ["delete", "disable", "reset_password", "revoke_sessions", "revoke_api_keys", "reset_2fa", "delete_scans"]
                  if (confirmActions.includes(action)) {
                    const messages: Record<string, { title: string; desc: string; label: string; danger?: boolean }> = {
                      delete: { title: "Delete User", desc: `This will permanently delete ${selectedUser.user.email} and all their data. This cannot be undone.`, label: "Delete User", danger: true },
                      disable: { title: "Disable Account", desc: `This will suspend ${selectedUser.user.email}'s account and log them out of all sessions. They will not be able to log in until re-enabled.`, label: "Disable Account", danger: true },
                      reset_password: { title: "Reset Password", desc: `This will generate a temporary password for ${selectedUser.user.email}. All sessions will be invalidated. Share the temporary password securely.`, label: "Reset Password" },
                      revoke_sessions: { title: "Revoke All Sessions", desc: `This will force-logout ${selectedUser.user.email} from all devices and browsers.`, label: "Revoke Sessions" },
                      revoke_api_keys: { title: "Revoke All API Keys", desc: `This will immediately revoke all active API keys for ${selectedUser.user.email}.`, label: "Revoke Keys" },
                      reset_2fa: { title: "Reset Two-Factor Authentication", desc: `This will remove 2FA from ${selectedUser.user.email}'s account. They will need to set it up again.`, label: "Reset 2FA", danger: true },
                      delete_scans: { title: "Delete All Scans", desc: `This will permanently delete all scan history for ${selectedUser.user.email}. This cannot be undone.`, label: "Delete Scans", danger: true },

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

            {/* Users table */}
            {activeTab === "users" && !selectedUser && (
              <Card className="bg-card border-border overflow-hidden">
                <CardHeader className="pb-0 pt-5 px-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base font-semibold">All Users</CardTitle>
                      <Badge variant="secondary" className="text-[10px] font-medium">{stats ? Number(stats.total_users).toLocaleString() : 0}</Badge>
                    </div>
                    <div className="relative w-full sm:w-72">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Search by name or email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 h-9 bg-background"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0 mt-4">
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-y border-border bg-muted/30">
                          <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">User</th>
                          <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Scans</th>
                          <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">API Keys</th>
                          <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Status</th>
                          <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">Joined</th>
                          <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className={cn("transition-opacity duration-200", searchLoading && "opacity-40 pointer-events-none")}>
                        {users.map((u) => (
                          <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors group">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-3">
                                <UserAvatar name={u.name} email={u.email} avatarUrl={u.avatar_url} />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">{u.name || "Unnamed"}</p>
                                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-sm font-medium text-foreground">{u.scan_count}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-sm font-medium text-foreground">{u.api_key_count}</span>
                            </td>
                            <td className="px-4 py-3">
                              {(() => {
                                const badges: React.ReactNode[] = []
                                if (u.disabled_at) badges.push(<Badge key="disabled" className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-1.5 font-medium">Disabled</Badge>)
                                if (u.role && u.role !== STAFF_ROLES.USER && ROLE_BADGE_STYLES[u.role]) {
                                  badges.push(<Badge key="role" className={cn(ROLE_BADGE_STYLES[u.role], "text-[10px] px-1.5 font-medium")}>{STAFF_ROLE_LABELS[u.role] || u.role}</Badge>)
                                }
                                const effectivePlan = u.gifted_plan || u.plan
                                if (effectivePlan && effectivePlan !== "free") {
                                  const planLabel = effectivePlan.replace("_supporter", "").charAt(0).toUpperCase() + effectivePlan.replace("_supporter", "").slice(1)
                                  badges.push(<Badge key="plan" className={cn("text-[10px] px-1.5 font-medium", u.gifted_plan ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-primary/10 text-primary border-primary/20")}>{planLabel}{u.gifted_plan ? " (Gift)" : ""}</Badge>)
                                }
                                if (u.totp_enabled) badges.push(<Badge key="2fa" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-1.5 font-medium">2FA</Badge>)
                                if (badges.length === 0) return <span className="text-xs text-muted-foreground">Active</span>
                                return <div className="flex items-center gap-1.5 flex-wrap">{badges}</div>
                              })()}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="View details" asChild>
                                  <a
                                    href={`/admin#users/user-${u.id}`}
                                    onClick={(e) => {
                                      if (!e.ctrlKey && !e.metaKey) {
                                        e.preventDefault()
                                        fetchUserDetail(u.id)
                                      }
                                    }}
                                  >
                                    <Eye className="h-4 w-4 text-muted-foreground" />
                                  </a>
                                </Button>
                                {hasStaffPermission(callerRole, STAFF_PERMISSIONS.VIEW_AUDIT_LOG) && (
                                  <>
                                    {u.disabled_at ? (
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10" title="Re-enable" onClick={() => handleAction(u.id, "enable")}>
                                        <CheckCircle2 className="h-4 w-4" />
                                      </Button>
                                    ) : (
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" title="Disable"
                                        onClick={() => setConfirmDialog({ title: "Disable Account", description: `Suspend ${u.email}? They will be logged out and unable to sign in.`, confirmLabel: "Disable", danger: true, action: () => handleAction(u.id, "disable") })}>
                                        <Ban className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {users.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-5 py-12 text-center">
                              <Search className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
                              <p className="text-sm text-muted-foreground">No users found matching your search.</p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile */}
                  <div className={cn("md:hidden flex flex-col transition-opacity duration-200", searchLoading && "opacity-40 pointer-events-none")}>
                    {users.map((u) => (
                      <a
                        key={u.id}
                        href={`/admin#users/user-${u.id}`}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey) {
                            e.preventDefault()
                            fetchUserDetail(u.id)
                          }
                        }}
                        className="flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-0 hover:bg-muted/20 text-left transition-colors w-full"
                      >
                        <UserAvatar name={u.name} email={u.email} size="sm" avatarUrl={u.avatar_url} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{u.name || "Unnamed"}</p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[10px] text-muted-foreground">{u.scan_count} scans</span>
                            {u.disabled_at && <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-1.5">Disabled</Badge>}
                            {u.role && u.role !== STAFF_ROLES.USER && ROLE_BADGE_STYLES[u.role] && (
                              <Badge className={cn(ROLE_BADGE_STYLES[u.role], "text-[10px] px-1.5")}>{STAFF_ROLE_LABELS[u.role] || u.role}</Badge>
                            )}
                {(() => {
                  const effectivePlan = u.gifted_plan || u.plan
                  if (!effectivePlan || effectivePlan === "free") return null
                  const label = effectivePlan.replace("_supporter", "").charAt(0).toUpperCase() + effectivePlan.replace("_supporter", "").slice(1)
                  return (
                    <Badge className={cn("text-[10px] px-1.5", u.gifted_plan ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-primary/10 text-primary border-primary/20")}>
                      {label}{u.gifted_plan ? " (Gift)" : ""}
                    </Badge>
                  )
                })()}
                            {u.totp_enabled && <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-1.5">2FA</Badge>}
                          </div>
                        </div>
                        <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
                      </a>
                    ))}
                  </div>

                  {/* Pagination */}
                  <div className="px-5 py-3 border-t border-border bg-muted/10">
                    <PaginationControl
                      currentPage={page}
                      totalPages={totalPages}
                      onPageChange={(p) => fetchData(p)}
                      pageSize={usersPageSize}
                      onPageSizeChange={(s) => { setUsersPageSize(s); fetchData(1, searchQuery, false, s) }}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Audit log */}
            {activeTab === "audit" && (
              <Card className="bg-card border-border overflow-hidden">
                <CardHeader className="pb-0 pt-5 px-5">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">Audit Log</CardTitle>
                    <Badge variant="secondary" className="text-[10px] font-medium">Recent Activity</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">All admin actions are logged here for accountability.</p>
                </CardHeader>
                <CardContent className="p-0 mt-4">
                  {auditLogs.length === 0 ? (
                    <div className="py-16 text-center">
                      <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                        <History className="h-6 w-6 text-muted-foreground/40" />
                      </div>
                      <p className="text-sm font-medium text-muted-foreground">No audit log entries yet.</p>
                      <p className="text-xs text-muted-foreground mt-1">Admin actions will appear here as they occur.</p>
                    </div>
                  ) : (
                    <>
                      <div className={cn("flex flex-col transition-opacity duration-200", auditPaging && "opacity-40 pointer-events-none")}>
                        {auditLogs.map((log, i) => {
                          const isExpanded = expandedLog === log.id
                          const actionMeta = ACTION_META[log.action]
                          const logDate = new Date(log.created_at)
                          
                          return (
                            <div key={log.id} className={cn(i < auditLogs.length - 1 && "border-b border-border")}>
                              <button
                                className={cn("w-full flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/20 text-left", isExpanded && "bg-muted/10")}
                                onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                              >
                                {/* Avatar with action indicator */}
                                <div className="relative">
                                  <UserAvatar name={log.admin_name} email={log.admin_email} size="sm" avatarUrl={log.admin_avatar_url} />
                                  <div className={cn(
                                    "absolute -bottom-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center ring-2 ring-card",
                                    actionMeta?.cls || "bg-muted"
                                  )}>
                                    {log.action.includes("delete") || log.action.includes("disable") || log.action.includes("revoke") ? (
                                      <XCircle className="h-2.5 w-2.5" />
                                    ) : log.action.includes("enable") || log.action.includes("create") || log.action.includes("award") || log.action.includes("gift") ? (
                                      <CheckCircle2 className="h-2.5 w-2.5" />
                                    ) : (
                                      <Settings className="h-2.5 w-2.5" />
                                    )}
                                  </div>
                                </div>
                                
                                {/* Main content */}
                                <div className="flex-1 min-w-0">
                                  {/* Human-readable sentence */}
                                  <p className="text-sm text-foreground leading-relaxed">
                                    {getActionSentence(log)}
                                  </p>
                                  
                                  {/* Meta row */}
                                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                    <ActionBadge action={log.action} />
                                    <span className="text-[10px] text-muted-foreground">
                                      {formatRelativeTime(logDate)}
                                    </span>
                                    {log.ip_address && (
                                      <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-0.5">
                                        <Globe className="h-2.5 w-2.5" /> {log.ip_address}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                
                                <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", isExpanded && "rotate-180")} />
                              </button>

                              {/* Expanded detail panel */}
                              {isExpanded && (
                                <div className="px-5 pb-4 pt-0 ml-12">
                                  <div className="rounded-xl bg-gradient-to-br from-muted/30 to-muted/10 border border-border p-4 space-y-4">
                                    {/* Action summary */}
                                    <div className="flex items-center gap-3 pb-3 border-b border-border/50">
                                      <ActionBadge action={log.action} />
                                      <span className="text-sm text-muted-foreground">
                                        {logDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} at {logDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                                      </span>
                                    </div>
                                    
                                    {/* People involved */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                      <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                                          <Shield className="h-5 w-5 text-primary" />
                                        </div>
                                        <div>
                                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Admin</p>
                                          <p className="text-sm font-medium text-foreground">{log.admin_name || log.admin_email.split("@")[0]}</p>
                                          <p className="text-xs text-muted-foreground">{log.admin_email}</p>
                                        </div>
                                      </div>
                                      
                                      {log.target_email && (
                                        <div className="flex items-center gap-3">
                                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                                            <User className="h-5 w-5 text-muted-foreground" />
                                          </div>
                                          <div>
                                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Target User</p>
                                            <p className="text-sm font-medium text-foreground">{log.target_name || log.target_email.split("@")[0]}</p>
                                            <p className="text-xs text-muted-foreground">{log.target_email}</p>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                    
                                    {/* Details section */}
                                    {log.details && (
                                      <div className="pt-3 border-t border-border/50">
                                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Details</p>
                                        <div className="bg-card/50 rounded-lg p-3 border border-border/50">
                                          <p className="text-sm text-foreground leading-relaxed">{log.details}</p>
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Technical details */}
                                    {log.ip_address && (
                                      <div className="flex items-center gap-4 pt-3 border-t border-border/50 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1.5">
                                          <Globe className="h-3.5 w-3.5" />
                                          <span className="font-mono">{log.ip_address}</span>
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                          <Clock className="h-3.5 w-3.5" />
                                          <span>{logDate.toISOString()}</span>
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      {auditTotalPages > 1 && (
                        <div className="px-5 py-3 border-t border-border bg-muted/10">
                          <PaginationControl
                            currentPage={auditPage}
                            totalPages={auditTotalPages}
                            onPageChange={(p) => fetchAudit(p)}
                            pageSize={auditPageSize}
                            onPageSizeChange={(s) => { setAuditPageSize(s); fetchAudit(1, s) }}
                          />
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Active Admins tab */}
            {activeTab === "admins" && (
              <Card className="bg-card border-border overflow-hidden">
                <CardHeader className="pb-0 pt-5 px-5">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">Staff Members</CardTitle>
                    <Badge variant="secondary" className="text-[10px] font-medium">{activeAdmins.length}</Badge>
                    <Button variant="outline" size="sm" className="ml-auto h-7 bg-transparent gap-1 text-xs" onClick={fetchActiveAdmins}>
                      <RefreshCw className={cn("h-3 w-3", adminsLoading && "animate-spin")} /> Refresh
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">All staff members (admins, moderators, support) and their current activity status.</p>
                </CardHeader>
                <CardContent className="p-0 mt-4">
                  {adminsLoading ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <p className="text-xs text-muted-foreground">Loading admin data...</p>
                    </div>
                  ) : activeAdmins.length === 0 ? (
                    <div className="py-16 text-center">
                      <Shield className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No administrators found.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col">
                        {pagedStaff.map((admin, i) => {
                          const isOnline = admin.active_sessions > 0
                          const displayName = admin.name || admin.email.split("@")[0]
                          return (
                            <div key={admin.id} className={cn("flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/20", i < pagedStaff.length - 1 && "border-b border-border")}>
                              {/* Avatar with online indicator */}
                              <div className="relative shrink-0">
                                <UserAvatar name={admin.name} email={admin.email} avatarUrl={admin.avatar_url} />
                                <div className={cn(
                                  "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                                  isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"
                                )} />
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-semibold text-foreground">{displayName}</span>
                                  <Badge className={cn("text-[10px] px-1.5 font-medium", ROLE_BADGE_STYLES[admin.role] || ROLE_BADGE_STYLES.user)}>
                                    {STAFF_ROLE_LABELS[admin.role] || admin.role}
                                  </Badge>
                                  <Badge className={cn("text-[10px] px-1.5 font-medium",
                                    isOnline
                                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                      : "bg-muted text-muted-foreground border-border"
                                  )}>
                                    {isOnline ? "Online" : "Offline"}
                                  </Badge>
                                  {admin.totp_enabled && (
                                    <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-1.5 font-medium">2FA</Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">{admin.email}</p>

                                {/* Activity stats row */}
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5">
                                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <Monitor className="h-3 w-3" />
                                    {admin.active_sessions} active session{admin.active_sessions !== 1 ? "s" : ""}
                                  </span>
                                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <Activity className="h-3 w-3" />
                                    {admin.total_actions} total action{admin.total_actions !== 1 ? "s" : ""}
                                    {admin.actions_24h > 0 && <span className="text-primary font-medium">({admin.actions_24h} today)</span>}
                                  </span>
                                  {admin.last_ip && (
                                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                                      <Globe className="h-3 w-3" />
                                      {admin.last_ip}
                                    </span>
                                  )}
                                </div>

                                {/* Last action */}
                                {admin.last_admin_action && (
                                  <div className="mt-2 text-[11px] text-muted-foreground">
                                    Last action: <ActionBadge action={admin.last_action_type || ""} />
                                    <span className="ml-1.5">
                                      {new Date(admin.last_admin_action).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div className="text-right shrink-0">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Admin since</p>
                                <p className="text-xs text-foreground mt-0.5">
                                  {new Date(admin.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {staffPagination.totalPages > 1 && (
                        <div className="px-5 py-3 border-t border-border bg-muted/10">
                          <PaginationControl
                            currentPage={staffPage}
                            totalPages={staffPagination.totalPages}
                            onPageChange={setStaffPage}
                            pageSize={staffPageSize}
                            onPageSizeChange={(s) => { setStaffPageSize(s); setStaffPage(1) }}
                            totalItems={activeAdmins.length}
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
  const u = detail.user
  const isLoading = (action: string) => actionLoading === `${u.id}-${action}`
  const [showBadgePicker, setShowBadgePicker] = useState(false)
  const [newBadgeName, setNewBadgeName] = useState("")
  const [newBadgeDisplay, setNewBadgeDisplay] = useState("")
  const [newBadgeColor, setNewBadgeColor] = useState("#6366f1")
  const [showCreateBadge, setShowCreateBadge] = useState(false)
  const [showManageBadges, setShowManageBadges] = useState(false)

  const awardedIds = new Set(detail.badges.map((b) => b.id))
  const unawardedBadges = allBadges.filter((b) => !awardedIds.has(b.id))

  // Pending changes state - batch all changes and save together
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown>>({})
  const [pendingBadgeAwards, setPendingBadgeAwards] = useState<number[]>([]) // badge IDs to award
  const [pendingBadgeRevokes, setPendingBadgeRevokes] = useState<number[]>([]) // badge IDs to revoke
  const [accountEditMode, setAccountEditMode] = useState(false)
  const [editName, setEditName] = useState(u.name || "")
  const [editEmail, setEditEmail] = useState(u.email)
  const [editPlan, setEditPlan] = useState(u.plan || "free")
  const [editRole, setEditRole] = useState(u.role || "user")
  const [confirmEmail, setConfirmEmail] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [showGiftModal, setShowGiftModal] = useState(false)

  // Track if there are unsaved changes
  const hasChanges = Object.keys(pendingChanges).length > 0 || pendingBadgeAwards.length > 0 || pendingBadgeRevokes.length > 0

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
      // Remove if reverting to original
      setPendingChanges((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    } else {
      setPendingChanges((prev) => ({ ...prev, [key]: value }))
    }
  }

  // Save all pending changes
  const saveAllChanges = async () => {
    setIsSaving(true)
    try {
      // Save field changes sequentially (each triggers its own toast + fetchUserDetail)
      for (const [key, value] of Object.entries(pendingChanges)) {
        if (key === "name") await onAction(u.id, "update_name", { name: value as string })
        else if (key === "email") await onAction(u.id, "update_email", { email: value as string })
        else if (key === "plan") await onAction(u.id, "update_plan", { plan: value as string })
        else if (key === "role") await onAction(u.id, "set_role", { role: value as string })
      }
      // Fire badge API calls in parallel — onAction skips re-fetch for badge actions
      const awardedThisSave = [...pendingBadgeAwards]
      const revokedThisSave = [...pendingBadgeRevokes]
      if (awardedThisSave.length > 0 || revokedThisSave.length > 0) {
        await Promise.all([
          ...awardedThisSave.map((id) => onAction(u.id, "award_badge", { badgeId: String(id) })),
          ...revokedThisSave.map((id) => onAction(u.id, "revoke_badge", { badgeId: String(id) })),
        ])
        // Patch the UI in one shot — no flicker, no re-fetch
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

  return (
    <div className="flex flex-col gap-4">
      {/* Back + header card */}
      <Card className="bg-card border-border overflow-hidden">
        <div className="h-1 w-full bg-primary" />
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 -ml-1 -mt-0.5" onClick={onClose}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <UserAvatar name={u.name} email={u.email} avatarUrl={u.avatar_url} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-foreground">{u.name || "Unnamed User"}</h2>
                {u.role && u.role !== STAFF_ROLES.USER && ROLE_BADGE_STYLES[u.role] && (
                  <Badge className={cn(ROLE_BADGE_STYLES[u.role], "text-[10px] font-medium")}>{STAFF_ROLE_LABELS[u.role] || u.role}</Badge>
                )}
                {u.disabled_at && <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] font-medium">Disabled</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{u.email}</p>
            </div>
          </div>

          {detailLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Quick stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                {[
                  { label: "Scans", value: u.scan_count, icon: Activity, color: "text-primary" },
                  { label: "API Keys", value: u.api_key_count, icon: Key, color: "text-[hsl(var(--severity-medium))]" },
                  { label: "Sessions", value: String(u.session_count), icon: Globe, color: "text-emerald-500" },
                  { label: "Joined", value: new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), icon: Clock, color: "text-muted-foreground" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2.5 p-3 rounded-lg bg-muted/30 border border-border">
                    <item.icon className={cn("h-4 w-4 shrink-0", item.color)} />
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground">{item.label}</p>
                      <p className="text-sm font-semibold text-foreground truncate">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Security badges */}
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Security</p>
                <div className="flex flex-wrap gap-2">
                  <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border", u.totp_enabled ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-500" : "bg-muted/50 border-border text-muted-foreground")}>
                    {u.totp_enabled ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                    {u.totp_enabled ? "2FA Enabled" : "No 2FA"}
                  </div>
                  {u.totp_enabled && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/50 border border-border text-muted-foreground">
                      <KeyRound className="h-3 w-3" />
                      {u.has_backup_codes ? "Has backup codes" : "No backup codes"}
                    </div>
                  )}
                  <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border", u.tos_accepted_at ? "bg-muted/50 border-border text-muted-foreground" : "bg-[hsl(var(--severity-medium))]/5 border-[hsl(var(--severity-medium))]/20 text-[hsl(var(--severity-medium))]")}>
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
        <Card className="bg-card border-border">
          <CardHeader className="pb-0 pt-4 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCog className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Account Management</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => {
                  if (accountEditMode) {
                    // Cancel - reset pending changes for these fields
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
          <CardContent className="p-5 pt-3">
            {!accountEditMode ? (
              // Read-only view
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1 p-3 rounded-lg border bg-muted/20 border-border">
                  <div className="flex items-center gap-2 mb-1">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground font-medium">Display Name</span>
                  </div>
                  <span className="text-xs font-medium text-foreground truncate">{u.name || <span className="text-muted-foreground italic">Not set</span>}</span>
                </div>
                {hasStaffPermission(callerRole, STAFF_PERMISSIONS.EDIT_USER_ROLE) && (
                  <div className="flex flex-col gap-1 p-3 rounded-lg border bg-muted/20 border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground font-medium">Email Address</span>
                    </div>
                    <span className="text-xs font-medium text-foreground truncate">{u.email}</span>
                  </div>
                )}
                {hasStaffPermission(callerRole, STAFF_PERMISSIONS.EDIT_USER_ROLE) && (
                  <div className="flex flex-col gap-1 p-3 rounded-lg border bg-muted/20 border-border">
                    <div className="flex items-center gap-2 mb-1">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground font-medium">Subscription Plan</span>
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
              // Edit view
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Edit Name */}
                  <div className={cn("flex flex-col gap-2 p-3 rounded-lg border transition-colors", pendingChanges.name ? "bg-primary/5 border-primary/30" : "bg-muted/20 border-border")}>
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground font-medium">Display Name</span>
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
                    <div className={cn("flex flex-col gap-2 p-3 rounded-lg border transition-colors", pendingChanges.email ? "bg-primary/5 border-primary/30" : "bg-muted/20 border-border")}>
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground font-medium">Email Address</span>
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
                      pendingChanges.plan ? "bg-primary/5 border-primary/30" : "bg-muted/20 border-border"
                    )}>
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground font-medium">Subscription Plan</span>
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
                <div className="flex items-start gap-2 mt-3 p-2.5 rounded-lg bg-muted/20 border border-border">
                  <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
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

          {/* Staff Role - single select */}
          <Card className={cn("bg-card border-border transition-colors", pendingChanges.role && "border-primary/30")}>
            <CardHeader className="pb-0 pt-4 px-5">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Staff Role</p>
                {pendingChanges.role && <span className="text-[9px] text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10">Modified</span>}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Select one permission level for this user.</p>
            </CardHeader>
            <CardContent className="p-5 pt-3">
              <div className="flex flex-col gap-2">
                {(["user", "support", "moderator", "admin"] as const).map((role) => {
                  const isSelected = editRole === role
                  const isOriginal = (u.role || "user") === role
                  const roleColors: Record<string, string> = {
                    user: "border-border hover:border-primary/40",
                    support: "border-emerald-500/30 hover:border-emerald-500/60",
                    moderator: "border-[hsl(var(--severity-medium))]/30 hover:border-[hsl(var(--severity-medium))]/60",
                    admin: "border-primary/30 hover:border-primary/60",
                  }
                  const activeColors: Record<string, string> = {
                    user: "bg-muted/50 border-border",
                    support: "bg-emerald-500/10 border-emerald-500/50",
                    moderator: "bg-[hsl(var(--severity-medium))]/10 border-[hsl(var(--severity-medium))]/50",
                    admin: "bg-primary/10 border-primary/50",
                  }
                  return (
                    <button
                      key={role}
                      onClick={() => {
                        setEditRole(role)
                        addPendingChange("role", role, u.role || "user")
                      }}
                      className={cn(
                        "flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm font-medium transition-all text-left",
                        isSelected ? activeColors[role] : `bg-transparent ${roleColors[role]} text-muted-foreground`,
                        "hover:text-foreground cursor-pointer"
                      )}
                    >
                      <span>{STAFF_ROLE_LABELS[role] || role}</span>
                      {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                      {isSelected && !isOriginal && <span className="text-[9px] text-primary ml-1">(pending)</span>}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Badges - multi select */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-0 pt-4 px-5">
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Badges</p>
                <span className="ml-auto text-[10px] text-muted-foreground">{detail.badges.length} awarded</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Cosmetic badges shown on the user's profile.</p>
            </CardHeader>
            <CardContent className="p-5 pt-3 flex flex-col gap-3">
              {/* Awarded badges */}
              {detail.badges.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {detail.badges.map((badge) => {
                    const isPendingRevoke = pendingBadgeRevokes.includes(badge.id)
                    return (
                      <div
                        key={badge.id}
                        className={cn(
                          "group flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all hover:pr-1",
                          isPendingRevoke && "opacity-50 line-through"
                        )}
                        style={{ borderColor: `${badge.color}40`, backgroundColor: `${badge.color}15`, color: badge.color || undefined }}
                      >
                        <Tag className="h-3 w-3 shrink-0" />
                        {badge.display_name}
                        <button
                          className="w-0 overflow-hidden group-hover:w-4 group-hover:ml-0.5 transition-all duration-200 hover:scale-110 flex-shrink-0"
                          onClick={() => {
                            if (isPendingRevoke) {
                              setPendingBadgeRevokes((p) => p.filter((id) => id !== badge.id))
                            } else {
                              setPendingBadgeRevokes((p) => [...p, badge.id])
                            }
                          }}
                          title={isPendingRevoke ? "Undo remove" : "Remove badge from user"}
                        >
                          {isPendingRevoke ? <RefreshCw className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No badges awarded yet.</p>
              )}
              {pendingBadgeRevokes.length > 0 && (
                <p className="text-[10px] text-destructive">{pendingBadgeRevokes.length} badge(s) will be removed on save</p>
              )}

              {/* Award badge picker */}
              {showBadgePicker && unawardedBadges.length > 0 && (
                <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-muted/20 border border-border">
                  <p className="text-[11px] text-muted-foreground font-medium">Select badges to award (click to toggle):</p>
                  <div className="flex flex-wrap gap-1.5">
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
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all",
                            isPending ? "ring-2 ring-primary scale-105" : "hover:scale-105"
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
                  {pendingBadgeAwards.length > 0 && (
                    <p className="text-[10px] text-primary">{pendingBadgeAwards.length} badge(s) will be awarded on save</p>
                  )}
                </div>
              )}

              {/* Create custom badge */}
              {showCreateBadge && (
                <div className="flex flex-col gap-2.5 p-3 rounded-lg bg-muted/20 border border-border">
                  <p className="text-[11px] text-muted-foreground font-medium">Create new badge:</p>
                  <Input
                    placeholder="Badge name (e.g. power_user)"
                    value={newBadgeName}
                    onChange={(e) => setNewBadgeName(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                    className="h-8 text-xs"
                  />
                  <Input
                    placeholder="Display name (e.g. Power User)"
                    value={newBadgeDisplay}
                    onChange={(e) => setNewBadgeDisplay(e.target.value)}
                    className="h-8 text-xs"
                  />
                  {/* Color picker */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-muted-foreground">Color:</label>
                      {/* Preview */}
                      {(newBadgeName || newBadgeDisplay) && (
                        <div
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium"
                          style={{ borderColor: `${newBadgeColor}40`, backgroundColor: `${newBadgeColor}15`, color: newBadgeColor }}
                        >
                          <Tag className="h-2.5 w-2.5 shrink-0" />
                          {newBadgeDisplay || newBadgeName}
                        </div>
                      )}
                    </div>
                    {/* Preset swatches */}
                    <div className="flex flex-wrap gap-1.5">
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
                            "w-6 h-6 rounded-full transition-all border-2",
                            newBadgeColor === c.color ? "border-foreground scale-110" : "border-transparent hover:scale-105"
                          )}
                          style={{ backgroundColor: c.color }}
                          title={c.name}
                        />
                      ))}
                    </div>
                    {/* Custom hex input */}
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded-full border-2 border-border shrink-0"
                        style={{ backgroundColor: newBadgeColor }}
                      />
                      <Input
                        value={newBadgeColor}
                        onChange={(e) => {
                          const v = e.target.value
                          setNewBadgeColor(v.startsWith("#") ? v : `#${v}`)
                        }}
                        placeholder="#6366f1"
                        className="h-7 text-xs font-mono w-28"
                        maxLength={7}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Button
                      size="sm"
                      className="h-7 text-xs flex-1"
                      disabled={!newBadgeName.trim() || !newBadgeDisplay.trim()}
                      onClick={() => {
                        onAction(u.id, "create_badge", {
                          name: newBadgeName.trim(),
                          displayName: newBadgeDisplay.trim(),
                          color: newBadgeColor,
                        })
                        setShowCreateBadge(false)
                        setNewBadgeName("")
                        setNewBadgeDisplay("")
                        setNewBadgeColor("#6366f1")
                      }}
                    >
                      Create &amp; Award
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => { setShowCreateBadge(false); setNewBadgeName(""); setNewBadgeDisplay(""); setNewBadgeColor("#6366f1") }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Manage all badges (delete) */}
              {showManageBadges && hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_BADGE) && (
                <div className="flex flex-col gap-2 p-3 rounded-lg bg-muted/20 border border-border">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground font-medium">Manage All Badges ({allBadges.length})</p>
                    <p className="text-[10px] text-destructive">Click to delete permanently</p>
                  </div>
                  {allBadges.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {allBadges.map((badge) => (
                        <div
                          key={badge.id}
                          className="group flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all"
                          style={{ borderColor: `${badge.color}40`, backgroundColor: `${badge.color}15`, color: badge.color || undefined }}
                        >
                          <Tag className="h-3 w-3 shrink-0" />
                          <span>{badge.display_name}</span>
                          <button
                            onClick={() => onAction(u.id, "delete_badge", { badgeId: String(badge.id) })}
                            className="w-0 overflow-hidden group-hover:w-4 transition-all duration-200 flex-shrink-0 flex items-center justify-center hover:scale-110"
                            title={`Delete "${badge.display_name}" permanently`}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No badges exist yet.</p>
                  )}
                </div>
              )}

              {/* Action buttons */}
              {!showBadgePicker && !showCreateBadge && !showManageBadges && (
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
                      <Trash2 className="h-3.5 w-3.5" /> Delete Badges
                    </Button>
                  )}
                </div>
              )}
              {(showBadgePicker || showManageBadges) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs self-start" onClick={() => { setShowBadgePicker(false); setShowManageBadges(false) }}>
                  Cancel
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Support actions */}
      {!detailLoading && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-0 pt-4 px-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {!hasStaffPermission(callerRole, STAFF_PERMISSIONS.DISABLE_USER) ? "Account Information" : "Support Actions"}
            </p>
          </CardHeader>
          <CardContent className="p-5 pt-3">
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
                      onClick={() => onAction(u.id, "revoke_sessions")}
                    />
                    <ActionCard
                      icon={Key} label="Revoke API Keys"
                      description={`Invalidate all ${u.api_key_count} API key(s)`}
                      color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                      loading={isLoading("revoke_api_keys")}
                      onClick={() => onAction(u.id, "revoke_api_keys")}
                    />
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.RESET_USER_PASSWORD) && (
                      <ActionCard
                        icon={KeyRound} label="Reset Password"
                        description={u.totp_enabled ? "Unavailable: 2FA enabled" : "Generate temp password"}
                        color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                        disabled={u.totp_enabled} loading={isLoading("reset_password")}
                        onClick={() => onAction(u.id, "reset_password")}
                      />
                    )}
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.RESET_USER_2FA) && u.totp_enabled && (
                      <ActionCard
                        icon={ShieldOff} label="Reset 2FA"
                        description="Remove two-factor auth"
                        color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                        loading={isLoading("reset_2fa")}
                        onClick={() => onAction(u.id, "reset_2fa")}
                      />
                    )}
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.MANAGE_RATE_LIMITS) && (
                      <ActionCard
                        icon={RefreshCw} label="Clear Rate Limits"
                        description="Reset rate limit counters"
                        color="text-primary" bg="bg-primary/10"
                        loading={isLoading("clear_rate_limits")}
                        onClick={() => onAction(u.id, "clear_rate_limits")}
                      />
                    )}
                    <ActionCard
                      icon={UserX} label="Force Logout All"
                      description="Logout + revoke all API keys"
                      color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                      loading={isLoading("force_logout_all")}
                      onClick={() => onAction(u.id, "force_logout_all")}
                    />
                  </div>
                </div>

                {/* Account Management */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Account Management</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {!u.email_verified_at ? (
                      <ActionCard
                        icon={MailCheck} label="Verify Email"
                        description="Manually verify email address"
                        color="text-emerald-500" bg="bg-emerald-500/10"
                        loading={isLoading("verify_email")}
                        onClick={() => onAction(u.id, "verify_email")}
                      />
                    ) : (
                      <ActionCard
                        icon={MailX} label="Unverify Email"
                        description="Remove email verification"
                        color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                        loading={isLoading("unverify_email")}
                        onClick={() => onAction(u.id, "unverify_email")}
                      />
                    )}
                    <ActionCard
                      icon={ImageOff} label="Clear Avatar"
                      description="Remove profile picture"
                      color="text-muted-foreground" bg="bg-muted/50"
                      loading={isLoading("clear_avatar")}
                      onClick={() => onAction(u.id, "clear_avatar")}
                    />
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.EDIT_USER_ROLE) && (
                      <ActionCard
                        icon={Beaker} label="Toggle Beta Access"
                        description="Enable/disable beta features"
                        color="text-primary" bg="bg-primary/10"
                        loading={isLoading("toggle_beta_access")}
                        onClick={() => onAction(u.id, "toggle_beta_access")}
                      />
                    )}
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
                      onAction(u.id, "gift_subscription", { giftPlan: plan, giftEndDate: endDate })
                      setShowGiftModal(false)
                    }}
                    onRevoke={() => {
                      onAction(u.id, "revoke_gift")
                      setShowGiftModal(false)
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
                      onClick={() => onAction(u.id, u.disabled_at ? "enable" : "disable")}
                    />
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_ANY_SCAN) && (
                      <ActionCard
                        icon={Activity} label="Delete All Scans"
                        description={`Remove all ${u.scan_count} scan(s)`}
                        color="text-destructive" bg="bg-destructive/10" variant="danger"
                        loading={isLoading("delete_scans")}
                        onClick={() => onAction(u.id, "delete_scans")}
                      />
                    )}
                    <ActionCard
                      icon={Webhook} label="Delete Webhooks"
                      description="Remove all webhooks"
                      color="text-destructive" bg="bg-destructive/10" variant="danger"
                      loading={isLoading("delete_webhooks")}
                      onClick={() => onAction(u.id, "delete_webhooks")}
                    />
                    <ActionCard
                      icon={CalendarOff} label="Delete Schedules"
                      description="Remove scheduled scans"
                      color="text-destructive" bg="bg-destructive/10" variant="danger"
                      loading={isLoading("delete_schedules")}
                      onClick={() => onAction(u.id, "delete_schedules")}
                    />
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_USER) && (
                      <ActionCard
                        icon={Trash2} label="Delete Account"
                        description="Permanently remove user"
                        color="text-destructive" bg="bg-destructive/10" variant="danger"
                        onClick={() => onAction(u.id, "delete")}
                      />
                    )}
                  </div>
                </div>

                {u.totp_enabled && hasStaffPermission(callerRole, STAFF_PERMISSIONS.RESET_USER_2FA) && (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[hsl(var(--severity-medium))]/5 border border-[hsl(var(--severity-medium))]/20">
                    <AlertTriangle className="h-4 w-4 text-[hsl(var(--severity-medium))] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-foreground">Password reset is unavailable for this user</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                        This account has two-factor authentication enabled. For security, passwords cannot be reset by admins when 2FA is active. The user should use their backup codes to regain access, or disable 2FA first.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* User data sections */}
      {!detailLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent Scans */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Recent Scans</CardTitle>
                <Badge variant="secondary" className="text-[10px] ml-auto">{detail.recentScans.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {detail.recentScans.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No scans recorded.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {detail.recentScans.map((scan) => (
                    <div key={scan.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/20 border border-border">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground truncate font-medium">{scan.url}</p>
                        <p className="text-[10px] text-muted-foreground">{scan.findings_count} findings via {scan.source}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(scan.scanned_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* API Keys */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">API Keys</CardTitle>
                <Badge variant="secondary" className="text-[10px] ml-auto">{detail.apiKeys.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {detail.apiKeys.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No API keys.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {detail.apiKeys.map((key) => (
                    <div key={key.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20 border border-border">
                      <div className="flex items-center gap-2 min-w-0">
                        <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs font-mono text-foreground">{key.key_prefix}...</span>
                        <span className="text-[10px] text-muted-foreground truncate">{key.name}</span>
                      </div>
                      {key.revoked_at
                        ? <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px]">Revoked</Badge>
                        : <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]">Active</Badge>
                      }
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Webhooks */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Webhooks</CardTitle>
                <Badge variant="secondary" className="text-[10px] ml-auto">{detail.webhooks.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {detail.webhooks.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No webhooks configured.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {detail.webhooks.map((wh) => (
                    <div key={wh.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20 border border-border">
                      <div className="flex items-center gap-2 min-w-0">
                        <Webhook className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-foreground truncate font-medium">{wh.name}</span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">{wh.type}</Badge>
                      </div>
                      <Badge className={cn("text-[10px] shrink-0", wh.active ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-muted text-muted-foreground border-border")}>
                        {wh.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active Sessions */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Active Sessions</CardTitle>
                <Badge variant="secondary" className="text-[10px] ml-auto">{detail.activeSessions.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {detail.activeSessions.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No active sessions.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {detail.activeSessions.map((sess) => (
                    <div key={sess.id} className="flex flex-col gap-1 p-2.5 rounded-lg bg-muted/20 border border-border">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs font-mono text-muted-foreground">{sess.id.substring(0, 12)}...</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          expires {new Date(sess.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground pl-5">
                        {sess.ip_address && (
                          <span className="font-mono">{sess.ip_address}</span>
                        )}
                        {sess.user_agent && (
                          <span className="truncate max-w-[200px]" title={sess.user_agent}>
                            {sess.user_agent.length > 40 ? sess.user_agent.substring(0, 40) + "..." : sess.user_agent}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Floating Save Bar - appears when there are pending changes */}
      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pointer-events-none">
          <div className="max-w-3xl mx-auto pointer-events-auto">
            <div className="flex items-center justify-between gap-4 px-5 py-3.5 rounded-xl bg-card border border-primary/30 shadow-2xl shadow-primary/10 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Save className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Unsaved Changes</p>
                  <p className="text-[11px] text-muted-foreground">
                    {[
                      Object.keys(pendingChanges).length > 0 && `${Object.keys(pendingChanges).length} field${Object.keys(pendingChanges).length !== 1 ? "s" : ""}`,
                      pendingBadgeAwards.length > 0 && `${pendingBadgeAwards.length} badge${pendingBadgeAwards.length !== 1 ? "s" : ""} to award`,
                      pendingBadgeRevokes.length > 0 && `${pendingBadgeRevokes.length} badge${pendingBadgeRevokes.length !== 1 ? "s" : ""} to remove`,
                    ].filter(Boolean).join(", ")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={discardChanges}
                  disabled={isSaving}
                  className="h-9 px-4"
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  onClick={saveAllChanges}
                  disabled={isSaving}
                  className="h-9 px-5 gap-2"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Action Card ---
function ActionCard({
  icon: Icon, label, description, color, bg, variant, disabled, loading, onClick,
}: {
  icon: React.ElementType; label: string; description: string
  color: string; bg: string; variant?: "danger" | "success"
  disabled?: boolean; loading?: boolean; onClick: () => void
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left",
        disabled
          ? "border-border bg-muted/20 opacity-50 cursor-not-allowed"
          : variant === "danger"
            ? "border-destructive/15 bg-card hover:bg-destructive/5 cursor-pointer"
            : variant === "success"
              ? "border-emerald-500/15 bg-card hover:bg-emerald-500/5 cursor-pointer"
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
    existingGift?.end_date
      ? new Date(existingGift.end_date).toISOString().slice(0, 16)
      : ""
  )
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  useEffect(() => {
    if (open) {
      setGiftPlan(existingGift?.plan || "pro_supporter")
      setGiftEndDate(
        existingGift?.end_date
          ? new Date(existingGift.end_date).toISOString().slice(0, 16)
          : ""
      )
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
      <div className="bg-card border border-border rounded-xl w-full max-w-md mx-4 shadow-2xl animate-in zoom-in-95 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <CrownIcon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {existingGift ? "Manage Gift Subscription" : "Gift a Subscription"}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {existingGift
                  ? `Active until ${new Date(existingGift.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                  : "Grant temporary premium access"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Active gift banner */}
        {existingGift && (
          <div className="mx-5 mt-4 flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border bg-primary/5 border-primary/20 text-primary text-xs font-medium">
            <CrownIcon className="h-3.5 w-3.5 shrink-0" />
            Currently gifted: <span className="font-semibold ml-1">{planLabels[existingGift.plan] || existingGift.plan}</span>
          </div>
        )}

        {/* Form */}
        <div className="p-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Plan</label>
              <select
                value={giftPlan}
                onChange={(e) => setGiftPlan(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="core_supporter">Core Supporter</option>
                <option value="pro_supporter">Pro Supporter</option>
                <option value="elite_supporter">Elite Supporter</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Expires</label>
              <input
                type="datetime-local"
                value={giftEndDate}
                onChange={(e) => setGiftEndDate(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {existingGift
              ? "Saving will overwrite the existing gift. User reverts to their base plan when it expires."
              : "User reverts to free plan when the gift expires. This is logged in the audit trail."}
          </p>

          <div className="flex items-center gap-2">
            <Button
              className="flex-1 gap-1.5"
              disabled={!giftEndDate || isLoading}
              onClick={() => onGift(giftPlan, new Date(giftEndDate).toISOString())}
            >
              {isLoading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...</>
              ) : (
                <><CrownIcon className="h-3.5 w-3.5" /> {existingGift ? "Update Gift" : "Gift Plan"}</>
              )}
            </Button>
            <Button variant="ghost" className="flex-1" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
          </div>

          {/* Revoke — only shown when there's an active gift */}
          {existingGift && (
            <div className="pt-2 border-t border-border">
              {!confirmRevoke ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/5 hover:border-destructive/50 gap-1.5"
                  onClick={() => setConfirmRevoke(true)}
                  disabled={isLoading}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Revoke Active Gift
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] text-destructive text-center font-medium">
                    Are you sure? This will immediately remove their gift access.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="flex-1 h-8 text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground gap-1.5"
                      onClick={onRevoke}
                      disabled={isLoading}
                    >
                      {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                      Yes, Revoke
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 h-8 text-xs"
                      onClick={() => setConfirmRevoke(false)}
                      disabled={isLoading}
                    >
                      Keep Gift
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
