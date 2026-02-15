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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { cn } from "@/lib/utils"
import { PaginationControl, usePagination } from "@/components/ui/pagination-control"
import { STAFF_ROLE_LABELS, STAFF_ROLE_HIERARCHY } from "@/lib/constants"

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
  role: string
  avatar_url: string | null
  totp_enabled: boolean
  tos_accepted_at: string | null
  created_at: string
  disabled_at: string | null
  scan_count: string
  api_key_count: string
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
      <img src={avatarUrl} alt={name || email} className={cn("rounded-full object-cover shrink-0", sz)} />
    )
  }
  return (
    <div className={cn("rounded-full flex items-center justify-center font-bold shrink-0", sz, colors[colorIdx])}>
      {initial}
    </div>
  )
}

// --- Action badge ---
function ActionBadge({ action }: { action: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    set_role: { label: "Role Changed", cls: "bg-primary/10 text-primary border-primary/20" },
    make_admin: { label: "Promoted to Admin", cls: "bg-primary/10 text-primary border-primary/20" },
    remove_admin: { label: "Admin Removed", cls: "bg-muted text-muted-foreground border-border" },
    reset_password: { label: "Password Reset", cls: "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20" },
    revoke_sessions: { label: "Sessions Revoked", cls: "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20" },
    revoke_api_keys: { label: "Keys Revoked", cls: "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20" },
    disable_user: { label: "Account Disabled", cls: "bg-destructive/10 text-destructive border-destructive/20" },
    enable_user: { label: "Account Enabled", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
    delete_user: { label: "Account Deleted", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  }
  const m = map[action] || { label: action, cls: "bg-muted text-muted-foreground border-border" }
  return <Badge className={cn("text-[10px] px-2 py-0.5 font-medium", m.cls)}>{m.label}</Badge>
}

export default function AdminPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
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
  const [expandedLog, setExpandedLog] = useState<number | null>(null)
  const [activeAdmins, setActiveAdmins] = useState<ActiveAdmin[]>([])
  const [adminsLoading, setAdminsLoading] = useState(false)
  const [staffPage, setStaffPage] = useState(1)
  const [searchLoading, setSearchLoading] = useState(false)
  const [callerRole, setCallerRole] = useState<string>("user")
  const [auditPaging, setAuditPaging] = useState(false)
  const searchInitRef = useRef(false)
  const staffPagination = usePagination(activeAdmins, 5)
  const pagedStaff = staffPagination.getPage(staffPage)
  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type })
  }, [])

  async function fetchData(p = 1, search = searchQuery, isInitial = false) {
    if (isInitial) setLoading(true)
    else setSearchLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p) })
      if (search.trim()) params.set("search", search.trim())
      const res = await fetch(`/api/admin?${params}`)
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

  async function fetchAudit(p = 1) {
    setAuditPaging(true)
    try {
      const res = await fetch(`/api/admin?section=audit&page=${p}`)
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
      const res = await fetch("/api/admin?section=active-admins")
      const data = await res.json()
      setActiveAdmins(data.admins || [])
    } catch { /* ignore */ }
    setAdminsLoading(false)
  }

  async function fetchUserDetail(userId: number) {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin?section=user-detail&userId=${userId}`)
      const data = await res.json()
      setSelectedUser(data)
    } catch { showToast("Failed to load user details.", "error") }
    setDetailLoading(false)
  }

  useEffect(() => { fetchData(1, "", true) }, [])

  useEffect(() => {
    if (activeTab === "audit") fetchAudit()
    if (activeTab === "admins") fetchActiveAdmins()
  }, [activeTab])

  async function handleAction(userId: number, action: string, extra?: Record<string, string>) {
    setActionLoading(`${userId}-${action}`)
    try {
      const res = await fetch("/api/admin", {
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
        }
        showToast(labels[action] || "Action completed.", "success")
        await fetchData(page)
        if (selectedUser && selectedUser.user.id === userId) {
          if (action === "delete") setSelectedUser(null)
          else await fetchUserDetail(userId)
        }
      } else {
        showToast(data.error || "Action failed.", "error")
      }
    } catch { showToast("Action failed.", "error") }
    setActionLoading(null)
    setConfirmDialog(null)
  }

  // Debounced server-side search - searches ALL users, not just current page
  useEffect(() => {
    // Skip the initial mount (fetchData already runs on mount)
    if (!searchInitRef.current) { searchInitRef.current = true; return }
    setSearchLoading(true)
    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: "1" })
        if (searchQuery.trim()) params.set("search", searchQuery.trim())
        const res = await fetch(`/api/admin?${params}`)
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
            <Button onClick={() => router.push("/")}>Back to Scanner</Button>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-8 flex flex-col gap-6">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <UserCog className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">Admin Panel</h1>
              <p className="text-xs text-muted-foreground">Manage users, monitor activity, and provide support.</p>
            </div>
          </div>
                <Button variant="outline" size="sm" className="bg-transparent gap-1.5 self-start sm:self-auto" onClick={() => { fetchData(page); if (activeTab === "audit") fetchAudit(auditPage); if (activeTab === "admins") fetchActiveAdmins(); }}>

            <RefreshCw className="h-3.5 w-3.5" />
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
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <StatCard label="Total Users" value={stats.total_users} icon={Users} color="text-primary" accent="bg-primary" />
                  <StatCard label="Total Scans" value={stats.total_scans} icon={Activity} color="text-primary" accent="bg-primary" />
                  <StatCard label="Scans (24h)" value={stats.scans_24h} icon={BarChart3} color="text-emerald-500" accent="bg-emerald-500" />
                  <StatCard label="New Users (7d)" value={stats.new_users_7d} icon={Users} color="text-emerald-500" accent="bg-emerald-500" />
                  <StatCard label="Shared Scans" value={stats.shared_scans} icon={Globe} color="text-primary" accent="bg-primary/70" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <StatCard label="API Keys" value={stats.active_api_keys} icon={Key} color="text-[hsl(var(--severity-medium))]" accent="bg-[hsl(var(--severity-medium))]" />
                  <StatCard label="Schedules" value={stats.active_schedules} icon={CalendarClock} color="text-[hsl(var(--severity-low))]" accent="bg-[hsl(var(--severity-low))]" />
                  <StatCard label="Webhooks" value={stats.active_webhooks} icon={Webhook} color="text-muted-foreground" accent="bg-muted-foreground/50" />
                  <StatCard label="2FA Users" value={stats.users_with_2fa} icon={ShieldCheck} color="text-emerald-500" accent="bg-emerald-500/50" />
                  <StatCard label="Disabled" value={stats.disabled_users} icon={Ban} color="text-destructive" accent="bg-destructive" />
                </div>
              </div>
            )}

            {/* Tab navigation */}
            <div className="flex items-center gap-1 border-b border-border">
              {([
                { key: "users" as const, label: "Users", icon: Users },
                { key: "audit" as const, label: "Audit Log", icon: History },
                  { key: "admins" as const, label: "Staff", icon: Shield },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setActiveTab(tab.key); if (tab.key === "audit") fetchAudit(); if (tab.key === "admins") fetchActiveAdmins(); setSelectedUser(null) }}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                    activeTab === tab.key
                      ? "text-primary border-primary"
                      : "text-muted-foreground border-transparent hover:text-foreground hover:border-border",
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* User detail */}
            {selectedUser && activeTab === "users" && (
              <UserDetailPanel
                detail={selectedUser}
                detailLoading={detailLoading}
                actionLoading={actionLoading}
                callerRole={callerRole}
                onClose={() => { setSelectedUser(null); setTempPassword(null) }}
                onAction={(userId, action, extra) => {
                  if (action === "set_role" && extra?.role) {
                    handleAction(userId, action, extra)
                    return
                  }
                  if (["delete", "disable", "reset_password", "revoke_sessions", "revoke_api_keys"].includes(action)) {
                    const messages: Record<string, { title: string; desc: string; label: string }> = {
                      delete: { title: "Delete User", desc: `This will permanently delete ${selectedUser.user.email} and all their data. This cannot be undone.`, label: "Delete User" },
                      disable: { title: "Disable Account", desc: `This will suspend ${selectedUser.user.email}'s account and log them out of all sessions. They will not be able to log in until re-enabled.`, label: "Disable Account" },
                      reset_password: { title: "Reset Password", desc: `This will generate a temporary password for ${selectedUser.user.email}. All sessions will be invalidated. Share the temporary password securely.`, label: "Reset Password" },
                      revoke_sessions: { title: "Revoke All Sessions", desc: `This will force-logout ${selectedUser.user.email} from all devices and browsers.`, label: "Revoke Sessions" },
                      revoke_api_keys: { title: "Revoke All API Keys", desc: `This will immediately revoke all active API keys for ${selectedUser.user.email}.`, label: "Revoke Keys" },
                    }
                    const m = messages[action]
                    setConfirmDialog({ title: m.title, description: m.desc, confirmLabel: m.label, danger: ["delete", "disable"].includes(action), action: () => handleAction(userId, action) })
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
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {u.disabled_at && <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-1.5 font-medium">Disabled</Badge>}
                                {u.role === "admin" && <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] px-1.5 font-medium">Admin</Badge>}
                                {u.role === "moderator" && <Badge className="bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20 text-[10px] px-1.5 font-medium">Moderator</Badge>}
                                {u.role === "support" && <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-[10px] px-1.5 font-medium">Support</Badge>}
                                {u.totp_enabled && <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-1.5 font-medium">2FA</Badge>}
                                {!u.disabled_at && (!u.role || u.role === "user") && !u.totp_enabled && (
                                  <span className="text-xs text-muted-foreground">Active</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="View details" onClick={() => fetchUserDetail(u.id)}>
                                  <Eye className="h-4 w-4 text-muted-foreground" />
                                </Button>
                                {(callerRole === "admin" || callerRole === "moderator") && (
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
                      <button key={u.id} className="flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-0 hover:bg-muted/20 text-left transition-colors w-full" onClick={() => fetchUserDetail(u.id)}>
                        <UserAvatar name={u.name} email={u.email} size="sm" avatarUrl={u.avatar_url} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{u.name || "Unnamed"}</p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[10px] text-muted-foreground">{u.scan_count} scans</span>
                            {u.disabled_at && <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-1.5">Disabled</Badge>}
                            {u.role === "admin" && <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] px-1.5">Admin</Badge>}
                            {u.role === "moderator" && <Badge className="bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20 text-[10px] px-1.5">Mod</Badge>}
                            {u.role === "support" && <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-[10px] px-1.5">Support</Badge>}
                            {u.totp_enabled && <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-1.5">2FA</Badge>}
                          </div>
                        </div>
                        <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="px-5 py-3 border-t border-border bg-muted/10">
                      <PaginationControl
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={(p) => fetchData(p)}
                      />
                    </div>
                  )}
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
                          const adminDisplay = log.admin_name || log.admin_email.split("@")[0]
                          const targetDisplay = log.target_name || (log.target_email ? log.target_email.split("@")[0] : null)
                          return (
                            <div key={log.id} className={cn(i < auditLogs.length - 1 && "border-b border-border")}>
                              <button
                                className={cn("w-full flex items-start gap-4 px-5 py-3.5 transition-colors hover:bg-muted/20 text-left", isExpanded && "bg-muted/10")}
                                onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                              >
                                <div className="flex flex-col items-center gap-1 pt-0.5">
                                  <UserAvatar name={log.admin_name} email={log.admin_email} size="sm" avatarUrl={log.admin_avatar_url} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                                    <span className="text-sm font-medium text-foreground">{adminDisplay}</span>
                                    <ActionBadge action={log.action} />
                                    {targetDisplay && (
                                      <span className="text-xs text-muted-foreground">
                                        on <span className="text-foreground font-medium">{targetDisplay}</span>
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-muted-foreground">
                                      {new Date(log.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                    {log.ip_address && (
                                      <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-0.5">
                                        <Globe className="h-2.5 w-2.5" /> {log.ip_address}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />}
                              </button>

                              {/* Expanded detail */}
                              {isExpanded && (
                                <div className="px-5 pb-4 pt-0 ml-11">
                                  <div className="rounded-xl bg-muted/20 border border-border p-4 flex flex-col gap-3">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                      <div>
                                        <p className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wider font-semibold">Performed By</p>
                                        <p className="text-foreground font-medium">{log.admin_name || "N/A"}</p>
                                        <p className="text-muted-foreground text-[11px]">{log.admin_email}</p>
                                      </div>
                                      {log.target_email && (
                                        <div>
                                          <p className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wider font-semibold">Target User</p>
                                          <p className="text-foreground font-medium">{log.target_name || "N/A"}</p>
                                          <p className="text-muted-foreground text-[11px]">{log.target_email}</p>
                                        </div>
                                      )}
                                      <div>
                                        <p className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wider font-semibold">Timestamp</p>
                                        <p className="text-foreground font-medium">{new Date(log.created_at).toLocaleString()}</p>
                                      </div>
                                      {log.ip_address && (
                                        <div>
                                          <p className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wider font-semibold">IP Address</p>
                                          <p className="text-foreground font-mono">{log.ip_address}</p>
                                        </div>
                                      )}
                                    </div>
                                    {log.details && (
                                      <div>
                                        <p className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wider font-semibold">Details</p>
                                        <p className="text-xs text-foreground leading-relaxed">{log.details}</p>
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
                                <Badge className={cn("text-[10px] px-1.5 font-medium",
                                  admin.role === "admin" ? "bg-primary/10 text-primary border-primary/20"
                                    : admin.role === "moderator" ? "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20"
                                    : "bg-blue-500/10 text-blue-500 border-blue-500/20"
                                )}>
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
                          onPageChange={(p) => setStaffPage(p)}
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
  detail, detailLoading, actionLoading, onClose, onAction, tempPassword, onClearTempPassword, callerRole,
}: {
  detail: UserDetail; detailLoading: boolean; actionLoading: string | null
  onClose: () => void; onAction: (userId: number, action: string, extra?: Record<string, string>) => void
  tempPassword: string | null; onClearTempPassword: () => void; callerRole: string
}) {
  const u = detail.user
  const isLoading = (action: string) => actionLoading === `${u.id}-${action}`

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
                {u.role === "admin" && <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-medium">Admin</Badge>}
                {u.role === "moderator" && <Badge className="bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20 text-[10px] font-medium">Moderator</Badge>}
                {u.role === "support" && <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-[10px] font-medium">Support</Badge>}
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

      {/* Role management - admin only */}
      {!detailLoading && callerRole === "admin" && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-0 pt-4 px-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role Management</p>
          </CardHeader>
          <CardContent className="p-5 pt-3">
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">Current role: <span className="font-semibold text-foreground">{STAFF_ROLE_LABELS[u.role || "user"] || "User"}</span></p>
              <div className="flex flex-wrap gap-2">
                {(["user", "support", "moderator", "admin"] as const).map((role) => (
                  <Button
                    key={role}
                    variant={(u.role || "user") === role ? "default" : "outline"}
                    size="sm"
                    disabled={(u.role || "user") === role || isLoading("set_role")}
                    onClick={() => onAction(u.id, "set_role", { role })}
                    className={cn(
                      "text-xs",
                      (u.role || "user") === role && "pointer-events-none"
                    )}
                  >
                    {STAFF_ROLE_LABELS[role]}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Support actions */}
      {!detailLoading && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-0 pt-4 px-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {callerRole === "support" ? "Account Information" : "Support Actions"}
            </p>
          </CardHeader>
          <CardContent className="p-5 pt-3">
            {callerRole === "support" ? (
              <p className="text-xs text-muted-foreground">You have view-only access. Contact an admin or moderator to perform actions on this user.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {callerRole === "admin" && (
                    <ActionCard
                      icon={KeyRound} label="Reset Password"
                      description={u.totp_enabled ? "Unavailable: user has 2FA enabled" : "Generate a temporary password"}
                      color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                      disabled={u.totp_enabled} loading={isLoading("reset_password")}
                      onClick={() => onAction(u.id, "reset_password")}
                    />
                  )}
                  <ActionCard
                    icon={LogOut} label="Force Logout"
                    description={`Revoke all ${u.session_count} active session(s)`}
                    color="text-primary" bg="bg-primary/10"
                    loading={isLoading("revoke_sessions")}
                    onClick={() => onAction(u.id, "revoke_sessions")}
                  />
                  <ActionCard
                    icon={Key} label="Revoke API Keys"
                    description="Invalidate all active API keys"
                    color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                    loading={isLoading("revoke_api_keys")}
                    onClick={() => onAction(u.id, "revoke_api_keys")}
                  />
                  <ActionCard
                    icon={u.disabled_at ? CheckCircle2 : Ban}
                    label={u.disabled_at ? "Re-enable Account" : "Disable Account"}
                    description={u.disabled_at ? "Allow the user to log in again" : "Suspend and force-logout"}
                    color={u.disabled_at ? "text-emerald-500" : "text-destructive"}
                    bg={u.disabled_at ? "bg-emerald-500/10" : "bg-destructive/10"}
                    variant={u.disabled_at ? "success" : "danger"}
                    onClick={() => onAction(u.id, u.disabled_at ? "enable" : "disable")}
                  />
                  {callerRole === "admin" && (
                    <ActionCard
                      icon={Trash2} label="Delete Account"
                      description="Permanently remove user and all data"
                      color="text-destructive" bg="bg-destructive/10" variant="danger"
                      onClick={() => onAction(u.id, "delete")}
                    />
                  )}
                </div>

                {u.totp_enabled && callerRole === "admin" && (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[hsl(var(--severity-medium))]/5 border border-[hsl(var(--severity-medium))]/20 mt-3">
                    <AlertTriangle className="h-4 w-4 text-[hsl(var(--severity-medium))] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-foreground">Password reset is unavailable for this user</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                        This account has two-factor authentication enabled. For security, passwords cannot be reset by admins when 2FA is active. The user should use their backup codes to regain access, or disable 2FA first.
                      </p>
                    </div>
                  </div>
                )}
              </>
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
