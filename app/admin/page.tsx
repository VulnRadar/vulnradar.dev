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
  CrownIcon,
  Loader2,
  Search,
  BarChart3,
  KeyRound,
  LogOut,
  Ban,
  CheckCircle2,
  ClipboardCopy,
  Eye,
  ArrowLeft,
  FileText,
  History,
  Shield,
  FileDown,
  XCircle,
  X,
  UserCog,
  Globe,
  ChevronDown,
  Award,
  Plus,
  Tag,
  Pencil,
  Mail,
  User,
  CreditCard,
  Download,
  MailCheck,
  MailX,
  CalendarOff,
  ImageOff,
  UserX,
  Beaker,
  Settings,
  Gift,
  UsersRound,
  Bell,
  StickyNote,
  Send,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react"
import { IPRulesManager } from "@/components/admin/features/ip-rules-manager"
import { SecurityAlertsManager } from "@/components/admin/features/security-alerts-manager"
import { SystemSettingsManager } from "@/components/admin/features/system-settings-manager"
import { MassEmailManager } from "@/components/admin/features/mass-email-manager"
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
import { NotificationsManager } from "@/components/admin/notifications"
import { SaveConfirmationModal, type ChangeItem, type AffectedUser } from "@/components/save-confirmation-modal"

// Import from new admin architecture
import type { AdminStats, AdminUser, UserDetail, AuditEntry, ActiveAdmin, BadgeDef, AdminNote, UserBadge } from "@/components/admin/types"
import { ACTION_META, ADMIN_TABS } from "@/components/admin/config"
import { formatRelativeTime, getAvatarColorIndex } from "@/components/admin/utils"
import { StatCard, UserAvatar, ActionBadge, Toast as AdminToast, ConfirmDialog, ActionCard } from "@/components/admin/shared"
import { GiftSubscriptionModal, UserDetailPanel } from "@/components/admin/users"
import { AuditLog } from "@/components/admin/audit"
import { StaffList } from "@/components/admin/staff"
import { TeamsList } from "@/components/admin/teams"

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
  const [activeTab, setActiveTab] = useState<"users" | "audit" | "admins" | "notifications" | "teams" | "ip-rules" | "security-alerts" | "settings" | "broadcast">("users")
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
  const [teamsPageSize, setTeamsPageSize] = useState(10)
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

  // Sync user/tab selection with URL hash
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
      window.history.replaceState(null, "", "/admin#users")
      setSelectedUser(null)
      return
    }

    const parts = hash.split("/")
    let foundUser = false
    const validTabs = ["users", "audit", "admins", "notifications", "teams", "ip-rules", "security-alerts", "settings", "broadcast"]
    for (const part of parts) {
      if (validTabs.includes(part)) {
        setActiveTab(part as typeof activeTab)
        if (part === "audit") fetchAudit()
        if (part === "admins") fetchActiveAdmins()
        if (part === "teams") fetchTeams()
      }
      if (part.startsWith("user-")) {
        const id = parseInt(part.replace("user-", ""), 10)
        if (!isNaN(id)) {
          fetchUserDetail(id, true)
          foundUser = true
        }
      }
    }
    if (!foundUser) setSelectedUser(null)
  }, [activeTab])

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

  async function fetchTeams(p = 1, search = teamsSearch) {
    setTeamsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: "10" })
      if (search.trim()) params.set("search", search.trim())
      const res = await fetch(`/api/v2/admin/teams?${params}`)
      const data = await res.json()
      setTeams(data.teams || [])
      setTeamsPage(data.page || 1)
      setTeamsTotalPages(data.totalPages || 1)
    } catch { /* ignore */ }
    setTeamsLoading(false)
  }

  async function fetchTeamMembers(teamId: number) {
    setTeamMembersLoading(true)
    try {
      const res = await fetch(`/api/v2/admin/teams/${teamId}`)
      const data = await res.json()
      setTeamMembers(data)
    } catch { showToast("Failed to load team members", "error") }
    setTeamMembersLoading(false)
  }

  async function handleTeamRename(teamId: number, newName: string) {
    setActionLoading(`team-rename-${teamId}`)
    try {
      const res = await fetch(`/api/v2/admin/teams`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, name: newName }),
      })
      if (res.ok) {
        showToast("Team renamed successfully", "success")
        setEditingTeam(null)
        fetchTeams(teamsPage)
      } else {
        const data = await res.json()
        showToast(data.error || "Failed to rename team", "error")
      }
    } catch { showToast("Failed to rename team", "error") }
    setActionLoading(null)
  }

  async function handleTeamDelete(teamId: number) {
    setActionLoading(`team-delete-${teamId}`)
    try {
      const res = await fetch(`/api/v2/admin/teams`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      })
      if (res.ok) {
        showToast("Team deleted successfully", "success")
        setConfirmDialog(null)
        fetchTeams(teamsPage)
      } else {
        const data = await res.json()
        showToast(data.error || "Failed to delete team", "error")
      }
    } catch { showToast("Failed to delete team", "error") }
    setActionLoading(null)
  }

  async function fetchUserDetail(userId: number, skipUrlUpdate = false) {
    setDetailLoading(true)
    try {
      const res = await fetch(`${API.ADMIN}?section=user-detail&userId=${userId}`)
      const data = await res.json()
      setSelectedUser(data)
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
        // Skip refetch for badge award/revoke - onBadgesChanged handles optimistic UI update
        if (action !== "award_badge" && action !== "revoke_badge") {
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

  // Define all admin tabs including new feature tabs
  const ALL_ADMIN_TABS = [
    { key: "users" as const, label: "Users", icon: Users, description: "Manage user accounts" },
    { key: "teams" as const, label: "Teams", icon: UsersRound, description: "Team management" },
    { key: "notifications" as const, label: "Notifications", icon: Bell, description: "Admin notifications" },
    { key: "admins" as const, label: "Active Staff", icon: Shield, description: "Online staff members" },
    { key: "ip-rules" as const, label: "Access Rules", icon: Globe, description: "IP & URL rules" },
    { key: "security-alerts" as const, label: "Security", icon: ShieldCheck, description: "Security alerts" },
    { key: "settings" as const, label: "Settings", icon: Settings, description: "System settings" },
    { key: "broadcast" as const, label: "Broadcast", icon: Send, description: "Mass email" },
    { key: "audit" as const, label: "Audit Logs", icon: History, description: "Activity history" },
  ]

  const handleTabChange = (tabKey: string) => {
    setActiveTab(tabKey as typeof activeTab)
    if (tabKey === "audit") fetchAudit()
    if (tabKey === "admins") fetchActiveAdmins()
    if (tabKey === "teams") fetchTeams()
    setSelectedUser(null)
    updateUrlWithUser(null, tabKey, false)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Page Header */}
        <div className="flex flex-col gap-1 mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Manage users, monitor activity, and control system settings.</p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading admin data...</p>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Sidebar Navigation - Desktop */}
            <aside className="lg:w-56 shrink-0">
              {/* Mobile: Icons only horizontal tabs */}
              <div className="lg:hidden overflow-x-auto -mx-4 px-4 pb-4">
                <div className="flex items-center justify-center gap-1 border-b border-border">
                  {ALL_ADMIN_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => handleTabChange(tab.key)}
                      title={tab.label}
                      className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-md transition-all",
                        activeTab === tab.key
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      )}
                    >
                      <tab.icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Desktop: Vertical sidebar */}
              <nav className="hidden lg:block sticky top-24">
                <div className="flex flex-col gap-1">
                  {ALL_ADMIN_TABS.map((tab) => (
                    <a
                      key={tab.key}
                      href={`/admin#${tab.key}`}
                      onClick={(e) => {
                        if (!e.ctrlKey && !e.metaKey) {
                          e.preventDefault()
                          handleTabChange(tab.key)
                        }
                      }}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all",
                        activeTab === tab.key
                          ? "bg-secondary text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      )}
                    >
                      <tab.icon className="h-4 w-4" />
                      <span>{tab.label}</span>
                    </a>
                  ))}
                </div>
              </nav>
            </aside>

            {/* Main Content Area */}
            <div className="flex-1 min-w-0">
              {/* Stats Overview - Show on Users tab */}
              {activeTab === "users" && stats && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-8">
                  <StatCard label="Total Users" value={stats.total_users} icon={Users} color="text-primary" accent="bg-primary" />
                  <StatCard label="Total Scans" value={stats.total_scans} icon={Activity} color="text-primary" accent="bg-primary" />
                  <StatCard label="Scans (24h)" value={stats.scans_24h} icon={BarChart3} color="text-primary" accent="bg-primary" />
                  <StatCard label="New Users (7d)" value={stats.new_users_7d} icon={Users} color="text-primary" accent="bg-primary" />
                  <StatCard label="Shared Scans" value={stats.shared_scans} icon={Globe} color="text-primary" accent="bg-primary/70" />
                  <StatCard label="API Keys" value={stats.active_api_keys} icon={Key} color="text-[hsl(var(--severity-medium))]" accent="bg-[hsl(var(--severity-medium))]" />
                  <StatCard label="Schedules" value={stats.active_schedules} icon={CalendarClock} color="text-[hsl(var(--severity-low))]" accent="bg-[hsl(var(--severity-low))]" />
                  <StatCard label="Webhooks" value={stats.active_webhooks} icon={Webhook} color="text-muted-foreground" accent="bg-muted-foreground/50" />
                  <StatCard label="2FA Users" value={stats.users_with_2fa} icon={ShieldCheck} color="text-primary" accent="bg-primary/50" />
                  <StatCard label="Disabled" value={stats.disabled_users} icon={Ban} color="text-destructive" accent="bg-destructive" />
                </div>
              )}

              {/* New Feature Sections */}
              {activeTab === "ip-rules" && <IPRulesManager />}
              {activeTab === "security-alerts" && <SecurityAlertsManager />}
              {activeTab === "settings" && <SystemSettingsManager />}
              {activeTab === "broadcast" && <MassEmailManager />}

              {/* Existing Sections */}

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
                onAction={async (userId, action, extra) => {
                  if (extra && Object.keys(extra).length > 0) {
                    return handleAction(userId, action, extra)
                  }
                  if (["set_role", "award_badge", "revoke_badge", "create_badge", "delete_badge", "update_name", "update_email", "update_plan", "enable", "clear_rate_limits", "gift_subscription", "revoke_gift", "add_note", "edit_note", "delete_note"].includes(action)) {
                    return handleAction(userId, action, extra)
                  }
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
                    return handleAction(userId, action)
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
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="Search by name or email..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-9 h-9 bg-background"
                        />
                      </div>
                      <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => fetchData(page, searchQuery)}>
                        <RefreshCw className={cn("h-4 w-4", searchLoading && "animate-spin")} />
                      </Button>
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
              <AuditLog
                auditLogs={auditLogs}
                auditPaging={auditPaging}
                auditPage={auditPage}
                auditTotalPages={auditTotalPages}
                auditPageSize={auditPageSize}
                setAuditPageSize={setAuditPageSize}
                fetchAudit={fetchAudit}
              />
            )}

            {/* Active Admins tab */}
            {activeTab === "admins" && (
              <StaffList
                activeAdmins={activeAdmins}
                adminsLoading={adminsLoading}
                fetchActiveAdmins={fetchActiveAdmins}
              />
            )}

            {/* Teams Tab */}
            {activeTab === "teams" && (
              <TeamsList
                teams={teams}
                teamsLoading={teamsLoading}
                teamsSearch={teamsSearch}
                setTeamsSearch={setTeamsSearch}
                fetchTeams={fetchTeams}
                teamsTotalPages={teamsTotalPages}
                teamsPage={teamsPage}
                teamsPageSize={teamsPageSize}
                setTeamsPageSize={setTeamsPageSize}
                handleTeamRename={handleTeamRename}
                handleTeamDelete={handleTeamDelete}
                fetchTeamMembers={fetchTeamMembers}
                teamMembers={teamMembers}
                setTeamMembers={setTeamMembers}
                teamMembersLoading={teamMembersLoading}
                actionLoading={actionLoading}
                callerRole={callerRole}
              />
            )}

            {/* Notifications Tab */}
            {activeTab === "notifications" && (
              <Card className="bg-card border-border">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-lg font-semibold">Site Notifications</h2>
                      <p className="text-xs text-muted-foreground">Manage platform-wide announcements and alerts</p>
                    </div>
                  </div>
                  <NotificationsManager />
                </CardContent>
              </Card>
            )}
            </div>
          </div>
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

      {toast && <AdminToast toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}
