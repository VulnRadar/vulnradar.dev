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
import { NotificationsManager } from "@/components/admin/notifications"
import { SaveConfirmationModal, type ChangeItem, type AffectedUser } from "@/components/save-confirmation-modal"

// Import from new admin architecture
import type { AdminStats, AdminUser, UserDetail, AuditEntry, ActiveAdmin, BadgeDef, AdminNote, UserBadge } from "@/components/admin/types"
import { ACTION_META, ADMIN_TABS } from "@/components/admin/config"
import { formatRelativeTime, getActionSentence, AVATAR_COLORS, getAvatarColorIndex } from "@/components/admin/utils"
import { StatCard, UserAvatar, ActionBadge, Toast as AdminToast, ConfirmDialog, ActionCard } from "@/components/admin/shared"
import { GiftSubscriptionModal, UserDetailPanel } from "@/components/admin/users"

// Types are now imported from @/components/admin/types

// Toast is now imported from @/components/admin/shared

// ConfirmDialog, StatCard, and UserAvatar are now imported from @/components/admin/shared

// ACTION_META, ActionBadge, getActionSentence, formatRelativeTime are now imported from @/components/admin

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
      if (["users", "audit", "admins", "notifications", "teams"].includes(part)) {
        setActiveTab(part as "users" | "audit" | "admins" | "notifications" | "teams")
        if (part === "audit") fetchAudit()
        if (part === "admins") fetchActiveAdmins()
        if (part === "teams") fetchTeams()
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
            {/* Stat cards */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
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

            {/* Tab navigation */}
            {(() => {
              const ADMIN_TABS = [
                { key: "users" as const, label: "Users", icon: Users },
                { key: "teams" as const, label: "Teams", icon: UsersRound },
                { key: "notifications" as const, label: "Notifications", icon: Bell },
                { key: "admins" as const, label: "Active Staff", icon: Shield },
                { key: "audit" as const, label: "Audit Logs", icon: History },
              ]
              return (
                <>
                  {/* Mobile: icons-only centered */}
                  <div className="flex sm:hidden justify-center gap-2 border-b border-border pb-2 pt-1">
                    {ADMIN_TABS.map((tab) => (
                      <a
                        key={tab.key}
                        href={`/admin#${tab.key}`}
                        title={tab.label}
                        aria-label={tab.label}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey) {
                            e.preventDefault()
                            setActiveTab(tab.key)
                            if (tab.key === "audit") fetchAudit()
                            if (tab.key === "admins") fetchActiveAdmins()
                            if (tab.key === "teams") fetchTeams()
                            setSelectedUser(null)
                            updateUrlWithUser(null, tab.key, false)
                          }
                        }}
                        className={cn(
                          "flex items-center justify-center w-10 h-10 rounded-md transition-all",
                          activeTab === tab.key
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                        )}
                      >
                        <tab.icon className="h-4 w-4" />
                      </a>
                    ))}
                  </div>
                  {/* Desktop: text + icon underline tabs */}
                  <div className="hidden sm:flex items-center gap-1 border-b border-border -mb-px">
                    {ADMIN_TABS.map((tab) => (
                      <a
                        key={tab.key}
                        href={`/admin#${tab.key}`}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey) {
                            e.preventDefault()
                            setActiveTab(tab.key)
                            if (tab.key === "audit") fetchAudit()
                            if (tab.key === "admins") fetchActiveAdmins()
                            if (tab.key === "teams") fetchTeams()
                            setSelectedUser(null)
                            updateUrlWithUser(null, tab.key, false)
                          }
                        }}
                        className={cn(
                          "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                          activeTab === tab.key
                            ? "text-primary border-primary"
                            : "text-muted-foreground border-transparent hover:text-foreground hover:border-border",
                        )}
                      >
                        <tab.icon className="h-4 w-4" />
                        {tab.label}
                      </a>
                    ))}
                  </div>
                </>
              )
            })()}

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
                onAction={async (userId, action, extra) => {
                  // If extra params are provided, it's from support action flow - already confirmed, execute directly
                  if (extra && Object.keys(extra).length > 0) {
                    return handleAction(userId, action, extra)
                  }
                  // Actions that don't need confirmation
                  if (["set_role", "award_badge", "revoke_badge", "create_badge", "delete_badge", "update_name", "update_email", "update_plan", "enable", "clear_rate_limits", "gift_subscription", "revoke_gift", "add_note", "edit_note", "delete_note"].includes(action)) {
                    return handleAction(userId, action, extra)
                  }
                  // Actions that need confirmation (handled by parent ConfirmDialog) - only for direct calls without extra
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

            {/* Audit log - Redesigned */}
            {activeTab === "audit" && (() => {
              // Filter categories for quick filtering
              const filterCategories = [
                { id: "all", label: "All Actions", icon: History },
                { id: "security", label: "Security", icon: Shield },
                { id: "user", label: "User Changes", icon: User },
                { id: "plan", label: "Plan Changes", icon: CreditCard },
                { id: "danger", label: "Destructive", icon: AlertTriangle },
              ]
              
              // Filter logic
              const filteredLogs = auditLogs.filter(log => {
                // Search filter
                if (auditSearch.trim()) {
                  const search = auditSearch.toLowerCase()
                  const matchesSearch = 
                    log.admin_email?.toLowerCase().includes(search) ||
                    log.admin_name?.toLowerCase().includes(search) ||
                    log.target_email?.toLowerCase().includes(search) ||
                    log.target_name?.toLowerCase().includes(search) ||
                    log.action?.toLowerCase().includes(search) ||
                    log.details?.toLowerCase().includes(search)
                  if (!matchesSearch) return false
                }
                
                // Category filter
                if (auditFilter === "all") return true
                if (auditFilter === "security") {
                  return ["reset_password", "revoke_sessions", "revoke_api_keys", "reset_2fa", "force_logout_all", "reset_temp_password"].includes(log.action)
                }
                if (auditFilter === "user") {
                  return ["set_role", "make_admin", "remove_admin", "change_email", "award_badge", "revoke_badge"].includes(log.action)
                }
                if (auditFilter === "plan") {
                  return ["set_plan", "gift_plan", "remove_gift"].includes(log.action)
                }
                if (auditFilter === "danger") {
                  return ["delete_user", "disable_user", "delete_scan", "delete_scans", "revoke_sessions", "revoke_api_keys"].includes(log.action)
                }
                return true
              })
              
              return (
                <div className="space-y-4">
                  {/* Header Card with Search & Filters */}
                  <Card className="bg-card border-border">
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex flex-col gap-4">
                        {/* Title row */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <h2 className="text-lg font-semibold">Audit Log</h2>
                            <p className="text-xs text-muted-foreground">Track all administrative actions</p>
                          </div>
                          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs self-start sm:self-auto" onClick={() => fetchAudit(1)}>
                            <RefreshCw className={cn("h-3.5 w-3.5", auditPaging && "animate-spin")} />
                            Refresh
                          </Button>
                        </div>
                        
                        {/* Search bar */}
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search by admin, user, or action..."
                            value={auditSearch}
                            onChange={(e) => setAuditSearch(e.target.value)}
                            className="pl-9 h-10 bg-background"
                          />
                          {auditSearch && (
                            <button 
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              onClick={() => setAuditSearch("")}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        
                        {/* Filter chips - horizontal scroll on mobile */}
                        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
                          {filterCategories.map(cat => {
                            const isActive = auditFilter === cat.id
                            const Icon = cat.icon
                            return (
                              <button
                                key={cat.id}
                                onClick={() => setAuditFilter(cat.id)}
                                className={cn(
                                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all shrink-0",
                                  isActive 
                                    ? "bg-primary text-primary-foreground" 
                                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                              >
                                <Icon className="h-3 w-3" />
                                {cat.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  
                  {/* Results Card */}
                  <Card className="bg-card border-border overflow-hidden">
                    {filteredLogs.length === 0 ? (
                      <div className="py-16 px-4 text-center">
                        <div className="h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
                          <History className="h-8 w-8 text-muted-foreground/40" />
                        </div>
                        <p className="text-base font-medium text-muted-foreground">
                          {auditSearch || auditFilter !== "all" ? "No matching entries" : "No audit log entries yet"}
                        </p>
                        <p className="text-sm text-muted-foreground/70 mt-1 max-w-xs mx-auto">
                          {auditSearch || auditFilter !== "all" 
                            ? "Try adjusting your search or filters" 
                            : "Admin actions will appear here as they occur"
                          }
                        </p>
                        {(auditSearch || auditFilter !== "all") && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="mt-4"
                            onClick={() => { setAuditSearch(""); setAuditFilter("all") }}
                          >
                            Clear Filters
                          </Button>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Results count */}
                        <div className="px-4 sm:px-5 py-3 border-b border-border bg-muted/20">
                          <p className="text-xs text-muted-foreground">
                            Showing <span className="font-medium text-foreground">{filteredLogs.length}</span> {filteredLogs.length === 1 ? "entry" : "entries"}
                            {(auditSearch || auditFilter !== "all") && " (filtered)"}
                          </p>
                        </div>
                        
                        {/* Desktop Table View */}
                        <div className="hidden md:block">
                          <div className={cn("transition-opacity duration-200", auditPaging && "opacity-40 pointer-events-none")}>
                            <table className="w-full">
                              <thead>
                                <tr className="border-b border-border bg-muted/10">
                                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Admin</th>
                                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Action</th>
                                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Target</th>
                                  <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Time</th>
                                  <th className="w-10"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredLogs.map((log, i) => {
                                  const isExpanded = expandedLog === log.id
                                  const actionMeta = ACTION_META[log.action]
                                  const logDate = new Date(log.created_at)
                                  
                                  return (
                                    <React.Fragment key={log.id}>
                                      <tr 
                                        className={cn(
                                          "group cursor-pointer transition-colors hover:bg-muted/30",
                                          isExpanded && "bg-muted/20",
                                          i < filteredLogs.length - 1 && !isExpanded && "border-b border-border/50"
                                        )}
                                        onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                                      >
                                        {/* Admin */}
                                        <td className="px-5 py-3.5">
                                          <div className="flex items-center gap-3">
                                            <UserAvatar name={log.admin_name} email={log.admin_email} size="sm" avatarUrl={log.admin_avatar_url} />
                                            <div className="min-w-0">
                                              <p className="text-sm font-medium text-foreground truncate max-w-[150px]">
                                                {log.admin_name || log.admin_email.split("@")[0]}
                                              </p>
                                            </div>
                                          </div>
                                        </td>
                                        
                                        {/* Action */}
                                        <td className="px-3 py-3.5">
                                          <ActionBadge action={log.action} />
                                        </td>
                                        
                                        {/* Target */}
                                        <td className="px-3 py-3.5">
                                          {log.target_email ? (
                                            <div className="min-w-0">
                                              <p className="text-sm text-foreground truncate max-w-[150px]">
                                                {log.target_name || log.target_email.split("@")[0]}
                                              </p>
                                              <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                                                {log.target_email}
                                              </p>
                                            </div>
                                          ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                          )}
                                        </td>
                                        
                                        {/* Time */}
                                        <td className="px-3 py-3.5">
                                          <div className="flex flex-col">
                                            <span className="text-xs text-foreground">{formatRelativeTime(logDate)}</span>
                                            <span className="text-[10px] text-muted-foreground">
                                              {logDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                            </span>
                                          </div>
                                        </td>
                                        
                                        {/* Expand */}
                                        <td className="px-3 py-3.5">
                                          <ChevronDown className={cn(
                                            "h-4 w-4 text-muted-foreground transition-transform",
                                            isExpanded && "rotate-180"
                                          )} />
                                        </td>
                                      </tr>
                                      
                                      {/* Expanded Row */}
                                      {isExpanded && (
                                        <tr>
                                          <td colSpan={5} className="px-5 pb-4 pt-0 border-b border-border">
                                            <div className="rounded-xl bg-gradient-to-br from-muted/40 to-muted/10 border border-border/60 p-4 mt-1">
                                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                                {/* Admin info */}
                                                <div className="flex items-start gap-3">
                                                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                                    <Shield className="h-4 w-4 text-primary" />
                                                  </div>
                                                  <div className="min-w-0">
                                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Performed by</p>
                                                    <p className="text-sm font-medium text-foreground truncate">{log.admin_name || log.admin_email.split("@")[0]}</p>
                                                    <p className="text-xs text-muted-foreground truncate">{log.admin_email}</p>
                                                  </div>
                                                </div>
                                                
                                                {/* Target info */}
                                                {log.target_email && (
                                                  <div className="flex items-start gap-3">
                                                    <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                                      <User className="h-4 w-4 text-muted-foreground" />
                                                    </div>
                                                    <div className="min-w-0">
                                                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Target user</p>
                                                      <p className="text-sm font-medium text-foreground truncate">{log.target_name || log.target_email.split("@")[0]}</p>
                                                      <p className="text-xs text-muted-foreground truncate">{log.target_email}</p>
                                                    </div>
                                                  </div>
                                                )}
                                                
                                                {/* Technical details */}
                                                <div className="flex items-start gap-3">
                                                  <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                                    <Clock className="h-4 w-4 text-muted-foreground" />
                                                  </div>
                                                  <div className="min-w-0">
                                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Timestamp</p>
                                                    <p className="text-sm font-medium text-foreground">
                                                      {logDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                      {logDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                                                      {log.ip_address && <span className="ml-2 font-mono">IP: {log.ip_address}</span>}
                                                    </p>
                                                  </div>
                                                </div>
                                              </div>
                                              
                                              {/* Details */}
                                              {log.details && (
                                                <div className="mt-4 pt-4 border-t border-border/50">
                                                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Details</p>
                                                  <div className="bg-card/60 rounded-lg p-3 border border-border/50">
                                                    <p className="text-sm text-foreground leading-relaxed">{log.details}</p>
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        
                        {/* Mobile Card View */}
                        <div className="md:hidden">
                          <div className={cn("divide-y divide-border transition-opacity duration-200", auditPaging && "opacity-40 pointer-events-none")}>
                            {filteredLogs.map((log) => {
                              const isExpanded = expandedLog === log.id
                              const logDate = new Date(log.created_at)
                              
                              return (
                                <div key={log.id} className="p-4">
                                  <button
                                    className="w-full text-left"
                                    onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                                  >
                                    {/* Header row */}
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                      <div className="flex items-center gap-2.5">
                                        <UserAvatar name={log.admin_name} email={log.admin_email} size="sm" avatarUrl={log.admin_avatar_url} />
                                        <div className="min-w-0">
                                          <p className="text-sm font-medium text-foreground">
                                            {log.admin_name || log.admin_email.split("@")[0]}
                                          </p>
                                          <p className="text-[10px] text-muted-foreground">{formatRelativeTime(logDate)}</p>
                                        </div>
                                      </div>
                                      <ChevronDown className={cn(
                                        "h-4 w-4 text-muted-foreground shrink-0 transition-transform mt-1",
                                        isExpanded && "rotate-180"
                                      )} />
                                    </div>
                                    
                                    {/* Action + Target */}
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <ActionBadge action={log.action} />
                                      {log.target_email && (
                                        <>
                                          <span className="text-muted-foreground">→</span>
                                          <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                                            {log.target_name || log.target_email.split("@")[0]}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </button>
                                  
                                  {/* Expanded content */}
                                  {isExpanded && (
                                    <div className="mt-4 pt-4 border-t border-border/50 space-y-3 animate-in slide-in-from-top-1">
                                      {/* Full sentence */}
                                      <p className="text-sm text-foreground leading-relaxed">
                                        {getActionSentence(log)}
                                      </p>
                                      
                                      {/* Details */}
                                      {log.details && (
                                        <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                                          <p className="text-xs text-muted-foreground mb-1 font-medium">Details</p>
                                          <p className="text-sm text-foreground">{log.details}</p>
                                        </div>
                                      )}
                                      
                                      {/* Meta info */}
                                      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                          <Clock className="h-3 w-3" />
                                          {logDate.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                                        </span>
                                        {log.ip_address && (
                                          <span className="flex items-center gap-1 font-mono">
                                            <Globe className="h-3 w-3" />
                                            {log.ip_address}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                        
                        {/* Pagination */}
                        {auditTotalPages > 1 && (
                          <div className="px-4 sm:px-5 py-3 border-t border-border bg-muted/10">
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
                  </Card>
                </div>
              )
            })()}

            {/* Active Admins tab */}
            {activeTab === "admins" && (
              <Card className="bg-card border-border overflow-hidden">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-semibold">Staff Members</h2>
                        <Badge variant="secondary" className="text-[10px] font-medium">{activeAdmins.length}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">All staff members (admins, moderators, support) and their current activity status.</p>
                    </div>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs self-start sm:self-auto" onClick={fetchActiveAdmins}>
                      <RefreshCw className={cn("h-3.5 w-3.5", adminsLoading && "animate-spin")} />
                      Refresh
                    </Button>
                  </div>
                </CardContent>
                <CardContent className="p-0">
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
                          // Real-time activity is based ONLY on heartbeat, not sessions
                          // is_active = heartbeat within 2 minutes
                          // "Recently Active" = heartbeat within 10 minutes
                          // "Offline" = no heartbeat or older than 10 minutes
                          const isActive = admin.is_active === true
                          const isRecentlyActive = !isActive && admin.seconds_since_heartbeat != null && admin.seconds_since_heartbeat < 600
                          const displayName = admin.name || admin.email.split("@")[0]
                          const statusDisplay = isActive ? "Active Now" : isRecentlyActive ? "Recently Active" : "Offline"
                          return (
                            <div key={admin.id} className={cn("flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/20", i < pagedStaff.length - 1 && "border-b border-border")}>
                              {/* Avatar with activity indicator */}
                              <div className="relative shrink-0">
                                <UserAvatar name={admin.name} email={admin.email} avatarUrl={admin.avatar_url} />
                                <div className={cn(
                                  "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                                  isActive ? "bg-primary animate-pulse" : isRecentlyActive ? "bg-emerald-500" : "bg-muted-foreground/40"
                                )} />
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-semibold text-foreground">{displayName}</span>
                                  <Badge className={cn("text-[10px] px-1.5 font-medium", ROLE_BADGE_STYLES[admin.role] || ROLE_BADGE_STYLES.user)}>
                                    {STAFF_ROLE_LABELS[admin.role] || admin.role}
                                  </Badge>
                                  <Badge className={cn("text-[10px] px-1.5 font-medium flex items-center gap-1",
                                    isActive
                                      ? "bg-accent text-accent-foreground border-accent/30"
                                      : isRecentlyActive
                                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                      : "bg-muted text-muted-foreground border-border"
                                  )}>
                                    <Dot className="h-2 w-2 fill-current" />
                                    {statusDisplay}
                                  </Badge>
                                  {admin.totp_enabled && (
                                    <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-1.5 font-medium">2FA</Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">{admin.email}</p>

                                {/* Activity stats row */}
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5">
                                  {admin.current_section && isActive && (
                                    <span className="flex items-center gap-1 text-[11px] text-accent-foreground font-medium">
                                      <Monitor className="h-3 w-3" />
                                      Viewing {admin.current_section}
                                    </span>
                                  )}
                                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <Monitor className="h-3 w-3" />
                                    {admin.active_sessions} active session{admin.active_sessions !== 1 ? "s" : ""}
                                  </span>
                                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <Activity className="h-3 w-3" />
                                    {admin.total_actions} total action{admin.total_actions !== 1 ? "s" : ""}
                                    {admin.actions_24h > 0 && <span className="text-primary font-medium">({admin.actions_24h} today)</span>}
                                  </span>
                                  {admin.recent_actions && admin.recent_actions > 0 && (
                                    <span className="flex items-center gap-1 text-[11px] text-primary font-medium">
                                      <Clock className="h-3 w-3" />
                                      {admin.recent_actions} action{admin.recent_actions !== 1 ? "s" : ""} (5 min)
                                    </span>
                                  )}
                                  {admin.last_ip && (
                                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                                      <Globe className="h-3 w-3" />
                                      {admin.last_ip}
                                    </span>
                                  )}
                                </div>

                                {/* Last action & heartbeat */}
                                <div className="mt-2 flex items-center gap-4 flex-wrap text-[11px] text-muted-foreground">
                                  {admin.last_admin_action && (
                                    <div>
                                      Last action: <ActionBadge action={admin.last_action_type || ""} />
                                      <span className="ml-1.5">
                                        {new Date(admin.last_admin_action).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                      </span>
                                    </div>
                                  )}
                                  {admin.last_heartbeat && admin.seconds_since_heartbeat !== undefined && (
                                    <div className="text-muted-foreground/60 text-[10px]">
                                      Last seen {admin.seconds_since_heartbeat < 60 ? "just now" : `${Math.floor(admin.seconds_since_heartbeat / 60)}m ago`}
                                    </div>
                                  )}
                                </div>
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

            {/* Teams Tab */}
            {activeTab === "teams" && (
              <div className="space-y-4">
                {/* Header Card */}
                <Card className="bg-card border-border">
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold">Team Management</h2>
                          <p className="text-xs text-muted-foreground">View and manage all platform teams</p>
                        </div>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs self-start sm:self-auto" onClick={() => fetchTeams(1)}>
                          <RefreshCw className={cn("h-3.5 w-3.5", teamsLoading && "animate-spin")} />
                          Refresh
                        </Button>
                      </div>
                      
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search teams by name..."
                          value={teamsSearch}
                          onChange={(e) => setTeamsSearch(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && fetchTeams(1, teamsSearch)}
                          className="pl-9 h-10 bg-background"
                        />
                        {teamsSearch && (
                          <button 
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => { setTeamsSearch(""); fetchTeams(1, "") }}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                {/* Team Members Modal */}
                {teamMembers && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setTeamMembers(null)}>
                    <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-foreground">{teamMembers.team.name}</h3>
                          <p className="text-xs text-muted-foreground">{teamMembers.members.length} members</p>
                        </div>
                        <button onClick={() => setTeamMembers(null)} className="p-1 rounded hover:bg-muted">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      
                      {teamMembersLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {teamMembers.members.map((member) => (
                            <div key={member.user_id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                              <UserAvatar name={member.name} email={member.email} size="sm" avatarUrl={member.avatar_url} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{member.name || member.email.split("@")[0]}</p>
                                <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                              </div>
                              <Badge variant="outline" className={cn(
                                "text-[10px] capitalize",
                                member.role === "owner" && "bg-primary/10 text-primary border-primary/20",
                                member.role === "admin" && "bg-amber-500/10 text-amber-500 border-amber-500/20",
                              )}>
                                {member.role}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Teams List */}
                <Card className="bg-card border-border overflow-hidden">
                  {teamsLoading ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <p className="text-xs text-muted-foreground">Loading teams...</p>
                    </div>
                  ) : teams.length === 0 ? (
                    <div className="py-16 text-center px-4">
                      <div className="h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
                        <UsersRound className="h-8 w-8 text-muted-foreground/40" />
                      </div>
                      <p className="text-base font-medium text-muted-foreground">
                        {teamsSearch ? "No teams found" : "No teams yet"}
                      </p>
                      <p className="text-sm text-muted-foreground/70 mt-1">
                        {teamsSearch ? "Try a different search term" : "Teams created by users will appear here"}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="px-4 sm:px-5 py-3 border-b border-border bg-muted/20">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{teams.length}</span> teams
                        </p>
                      </div>
                      
                      {/* Desktop Table */}
                      <div className="hidden md:block">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border bg-muted/10">
                              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-5 py-3">Team</th>
                              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Owner</th>
                              <th className="text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Members</th>
                              <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-3">Created</th>
                              <th className="w-20"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {teams.map((team, i) => (
                              <tr key={team.id} className={cn("hover:bg-muted/30 transition-colors", i < teams.length - 1 && "border-b border-border/50")}>
                                <td className="px-5 py-3.5">
                                  {editingTeam?.id === team.id ? (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        value={editingTeam.name}
                                        onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
                                        className="h-8 text-sm w-40"
                                        autoFocus
                                      />
                                      <Button size="sm" className="h-8 px-2" onClick={() => handleTeamRename(team.id, editingTeam.name)} disabled={actionLoading === `team-rename-${team.id}`}>
                                        {actionLoading === `team-rename-${team.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditingTeam(null)}>
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <div>
                                      <p className="text-sm font-medium text-foreground">{team.name}</p>
                                      <p className="text-[10px] text-muted-foreground font-mono">{team.slug}</p>
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-3.5">
                                  <div className="flex items-center gap-2">
                                    <UserAvatar name={team.owner_name} email={team.owner_email} size="sm" avatarUrl={team.owner_avatar_url} />
                                    <div className="min-w-0">
                                      <p className="text-sm text-foreground truncate max-w-[120px]">{team.owner_name || team.owner_email.split("@")[0]}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-3.5 text-center">
                                  <Badge variant="secondary" className="text-xs">{team.member_count}</Badge>
                                </td>
                                <td className="px-3 py-3.5">
                                  <span className="text-xs text-muted-foreground">{new Date(team.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                                </td>
                                <td className="px-3 py-3.5">
                                  <div className="flex items-center gap-1 justify-end">
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => fetchTeamMembers(team.id)} title="View members">
                                      <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingTeam({ id: team.id, name: team.name })} title="Rename">
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_USER) && (
                                      <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                        onClick={() => setConfirmDialog({
                                          title: "Delete Team",
                                          description: `This will permanently delete "${team.name}" and remove all ${team.member_count} members. This cannot be undone.`,
                                          confirmLabel: "Delete Team",
                                          danger: true,
                                          action: () => handleTeamDelete(team.id)
                                        })}
                                        title="Delete team"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      
                      {/* Mobile Card View */}
                      <div className="md:hidden divide-y divide-border">
                        {teams.map((team) => (
                          <div key={team.id} className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground">{team.name}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">{team.slug}</p>
                              </div>
                              <Badge variant="secondary" className="text-xs shrink-0">{team.member_count} members</Badge>
                            </div>
                            
                            <div className="flex items-center gap-2 mt-3">
                              <UserAvatar name={team.owner_name} email={team.owner_email} size="sm" avatarUrl={team.owner_avatar_url} />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-muted-foreground">Owner</p>
                                <p className="text-sm text-foreground truncate">{team.owner_name || team.owner_email.split("@")[0]}</p>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
                              <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => fetchTeamMembers(team.id)}>
                                <Eye className="h-3 w-3 mr-1.5" /> View Members
                              </Button>
                              <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setEditingTeam({ id: team.id, name: team.name })}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              {hasStaffPermission(callerRole, STAFF_PERMISSIONS.DELETE_USER) && (
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-8 w-8 p-0 text-destructive border-destructive/30 hover:bg-destructive/10"
                                  onClick={() => setConfirmDialog({
                                    title: "Delete Team",
                                    description: `This will permanently delete "${team.name}" and remove all ${team.member_count} members.`,
                                    confirmLabel: "Delete Team",
                                    danger: true,
                                    action: () => handleTeamDelete(team.id)
                                  })}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {/* Pagination */}
                      {teamsTotalPages > 1 && (
                        <div className="px-4 sm:px-5 py-3 border-t border-border bg-muted/10">
                          <PaginationControl
                            currentPage={teamsPage}
                            totalPages={teamsTotalPages}
                            onPageChange={(p) => fetchTeams(p)}
                          />
                        </div>
                      )}
                    </>
                  )}
                </Card>
              </div>
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

      {toast && <AdminToast toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}
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
                    user: "border-border hover:border-accent",
                    support: "border-blue-500/30 hover:border-accent",
                    moderator: "border-[hsl(var(--severity-medium))]/30 hover:border-accent",
                    admin: "border-primary/30 hover:border-accent",
                  }
                  const activeColors: Record<string, string> = {
                    user: "bg-muted/50 border-border",
                    support: "bg-blue-500/10 border-blue-500/50",
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
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 bg-transparent text-destructive dark:text-red-400 border-destructive/30 hover:bg-destructive/10 flex-1" onClick={() => setShowManageBadges(true)}>
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

      {/* Admin Notes */}
      {!detailLoading && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-0 pt-4 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Admin Notes</p>
                <span className="text-[10px] text-muted-foreground">({detail.notes?.length || 0})</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Internal notes about this user. Only visible to staff.</p>
          </CardHeader>
          <CardContent className="p-5 pt-3 flex flex-col gap-3">
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
                  <div key={note.id} className="group flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
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
                          onClick={() => onAction(u.id, "delete_note", { noteId: note.id })}
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
                    {!u.email_verified_at ? (
                      <ActionCard
                        icon={MailCheck} label="Verify Email"
                        description="Manually verify email address"
                        color="text-emerald-500" bg="bg-emerald-500/10"
                        loading={isLoading("verify_email")}
                        onClick={() => queueSupportAction("verify_email", "Verify Email", `Manually verify email address for ${u.name || u.email}`)}
                      />
                    ) : (
                      <ActionCard
                        icon={MailX} label="Unverify Email"
                        description="Remove email verification"
                        color="text-[hsl(var(--severity-medium))]" bg="bg-[hsl(var(--severity-medium))]/10"
                        loading={isLoading("unverify_email")}
                        onClick={() => queueSupportAction("unverify_email", "Unverify Email", `Remove email verification for ${u.name || u.email}`)}
                      />
                    )}
                    <ActionCard
                      icon={ImageOff} label="Clear Avatar"
                      description="Remove profile picture"
                      color="text-muted-foreground" bg="bg-muted/50"
                      loading={isLoading("clear_avatar")}
                      onClick={() => queueSupportAction("clear_avatar", "Clear Avatar", `Remove profile picture for ${u.name || u.email}`)}
                    />
                    {hasStaffPermission(callerRole, STAFF_PERMISSIONS.EDIT_USER_ROLE) && (
                      <ActionCard
                        icon={Beaker} label="Toggle Beta Access"
                        description="Enable/disable beta features"
                        color="text-primary" bg="bg-primary/10"
                        loading={isLoading("toggle_beta_access")}
                        onClick={() => queueSupportAction("toggle_beta_access", "Toggle Beta Access", `Enable/disable beta features for ${u.name || u.email}`)}
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
