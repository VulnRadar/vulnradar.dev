"use client"

import React from "react"
import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { ShieldOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { API } from "@/lib/constants"
import { NotificationsManager } from "@/components/admin/notifications-manager"

// Import modular admin components
import type {
  AdminStats,
  AdminUser,
  UserDetail,
  BadgeDef,
  AuditEntry,
  ActiveAdmin,
  Team,
  TeamDetails,
  AdminTab,
  ToastState,
  ConfirmDialogConfig,
} from "@/components/admin/types"
import { Toast, ConfirmDialog } from "@/components/admin/shared"
import { StatsGrid } from "@/components/admin/stats"
import { AdminHeader, AdminTabs } from "@/components/admin/navigation"
import { UsersTable, UserDetailPanel } from "@/components/admin/users"
import { AuditLog } from "@/components/admin/audit"
import { TeamsList } from "@/components/admin/teams"
import { ActiveStaff } from "@/components/admin/staff"



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
  const [toast, setToast] = useState<ToastState | null>(null)
  const [activeTab, setActiveTab] = useState<AdminTab>("users")
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogConfig | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [auditPage, setAuditPage] = useState(1)
  const [auditTotalPages, setAuditTotalPages] = useState(1)
  const [auditPageSize, setAuditPageSize] = useState(10)
  const [auditPaging, setAuditPaging] = useState(false)
  const [teams, setTeams] = useState<Team[]>([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [teamsPage, setTeamsPage] = useState(1)
  const [teamsTotalPages, setTeamsTotalPages] = useState(1)
  const [teamsSearch, setTeamsSearch] = useState("")
  const [teamMembers, setTeamMembers] = useState<TeamDetails | null>(null)
  const [teamMembersLoading, setTeamMembersLoading] = useState(false)
  const [activeAdmins, setActiveAdmins] = useState<ActiveAdmin[]>([])
  const [adminsLoading, setAdminsLoading] = useState(false)
  const [staffPage, setStaffPage] = useState(1)
  const [staffPageSize, setStaffPageSize] = useState(10)
  const [searchLoading, setSearchLoading] = useState(false)
  const [callerRole, setCallerRole] = useState<string>("user")
  const [allBadges, setAllBadges] = useState<BadgeDef[]>([])
  const [sortBy, setSortBy] = useState("created_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const searchInitRef = useRef(false)
  const initialLoadRef = useRef(false)

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type })
  }, [])

  // URL state sync
  const updateUrlWithUser = useCallback((userId: number | null, tab: AdminTab, push = false) => {
    const newHash = userId ? `#${tab}/user-${userId}` : `#${tab}`
    if (push) {
      window.history.pushState(null, "", `/admin${newHash}`)
    } else {
      window.history.replaceState(null, "", `/admin${newHash}`)
    }
  }, [])

  // Parse URL hash
  const parseUrlHash = useCallback(() => {
    if (typeof window === "undefined") return { tab: "users" as AdminTab, userId: null }
    const hash = window.location.hash.slice(1)
    if (!hash) return { tab: "users" as AdminTab, userId: null }
    const parts = hash.split("/")
    const tab = (parts[0] || "users") as AdminTab
    let userId: number | null = null
    if (parts[1]?.startsWith("user-")) {
      userId = parseInt(parts[1].replace("user-", ""), 10)
      if (isNaN(userId)) userId = null
    }
    return { tab, userId }
  }, [])

  // Data fetching functions
  async function fetchData(p = 1, search = searchQuery, isInitial = false, limit = usersPageSize) {
    if (isInitial) setLoading(true)
    else setSearchLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) })
      if (search.trim()) params.set("search", search.trim())
      const res = await fetch(`${API.ADMIN}?${params}`)
      if (res.status === 403) { setForbidden(true); setLoading(false); setSearchLoading(false); return }
      if (!res.ok) { setLoading(false); setSearchLoading(false); return }
      const text = await res.text()
      if (!text) { setLoading(false); setSearchLoading(false); return }
      const data = JSON.parse(text)
      setStats(data.stats)
      setUsers(data.users || [])
      setPage(data.page || 1)
      setTotalPages(data.totalPages || 1)
      if (data.callerRole) setCallerRole(data.callerRole)
    } catch (e) { 
      console.error("[Admin] fetchData error:", e)
      if (isInitial) setForbidden(true)
    }
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

  async function fetchUserDetail(userId: number, skipUrlUpdate = false) {
    setDetailLoading(true)
    try {
      const res = await fetch(`${API.ADMIN}?section=user-detail&userId=${userId}`)
      if (!res.ok) { 
        showToast("Failed to load user details.", "error")
        setDetailLoading(false)
        return 
      }
      const text = await res.text()
      if (!text) {
        showToast("Empty response from server.", "error")
        setDetailLoading(false)
        return
      }
      const data = JSON.parse(text)
      if (data.error) {
        showToast(data.error, "error")
        setDetailLoading(false)
        return
      }
      setSelectedUser(data)
      if (!skipUrlUpdate) updateUrlWithUser(userId, activeTab, true)
    } catch (e) { 
      console.error("[Admin] fetchUserDetail error:", e)
      showToast("Failed to load user details.", "error") 
    }
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

  // Team actions
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

  // Action labels for success messages
  const actionLabels: Record<string, string> = {
    set_role: "User role updated.",
    make_admin: "User promoted to admin.",
    remove_admin: "Admin privileges removed.",
    reset_password: "Password has been reset.",
    revoke_sessions: "All sessions revoked.",
    revoke_api_keys: "All API keys revoked.",
    disable: "Account disabled.",
    enable: "Account re-enabled.",
    delete_user: "User permanently deleted.",
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
    force_logout_all: "All sessions and API keys revoked.",
    verify_email: "Email verified.",
    unverify_email: "Email verification removed.",
    clear_avatar: "Avatar cleared.",
    toggle_beta_access: "Beta access toggled.",
    delete_webhooks: "All webhooks deleted.",
    delete_schedules: "All scheduled scans deleted.",
    add_note: "Note added.",
    edit_note: "Note updated.",
    delete_note: "Note deleted.",
  }

  // User action handler
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
        if (action === "create_badge" || action === "delete_badge") { fetchAllBadges() }
        showToast(actionLabels[action] || "Action completed.", "success")
        const skipRefetch = action === "award_badge" || action === "revoke_badge"
        if (!skipRefetch) {
          await fetchData(page)
          if (selectedUser && selectedUser.user.id === userId) {
            if (action === "delete_user") { setSelectedUser(null); updateUrlWithUser(null, activeTab) }
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

  // Sorting handler
  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortBy(field)
      setSortDir("desc")
    }
  }

  // Tab change handler
  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab)
    if (tab === "audit") fetchAudit()
    if (tab === "admins") fetchActiveAdmins()
    if (tab === "teams") fetchTeams()
    setSelectedUser(null)
    updateUrlWithUser(null, tab, false)
  }

  // Initial data load with URL hash support
  useEffect(() => {
    if (initialLoadRef.current) return
    initialLoadRef.current = true
    
    const { tab, userId } = parseUrlHash()
    setActiveTab(tab)
    
    fetchData(1, "", true).then(() => {
      if (userId) {
        fetchUserDetail(userId, true)
      }
    })
    fetchAllBadges()
    
    // Handle browser back/forward
    const handleHashChange = () => {
      const { tab: newTab, userId: newUserId } = parseUrlHash()
      setActiveTab(newTab)
      if (newUserId) {
        fetchUserDetail(newUserId, true)
      } else {
        setSelectedUser(null)
      }
    }
    
    window.addEventListener("hashchange", handleHashChange)
    window.addEventListener("popstate", handleHashChange)
    return () => {
      window.removeEventListener("hashchange", handleHashChange)
      window.removeEventListener("popstate", handleHashChange)
    }
  }, [parseUrlHash])

  useEffect(() => {
    if (activeTab === "audit") fetchAudit()
    if (activeTab === "admins") fetchActiveAdmins()
  }, [activeTab])

  // Debounced search
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
          const text = await res.text()
          if (text) {
            const data = JSON.parse(text)
            setUsers(data.users || [])
            setPage(data.page || 1)
            setTotalPages(data.totalPages || 1)
          }
        }
      } catch (e) { console.error("[Admin] search error:", e) }
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
        <AdminHeader 
          title="Admin Panel" 
          subtitle="Manage users, monitor activity, and provide support."
        />

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading admin data...</p>
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            {stats && <StatsGrid stats={stats} />}

            {/* Tab Navigation */}
            <AdminTabs activeTab={activeTab} onTabChange={handleTabChange} />

            {/* Tab Content */}
            {activeTab === "users" && !selectedUser && (
              <UsersTable
                users={users}
                totalCount={stats ? Number(stats.total_users) : 0}
                loading={loading}
                searchLoading={searchLoading}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onUserSelect={fetchUserDetail}
                onRefresh={() => fetchData(page, searchQuery)}
                page={page}
                totalPages={totalPages}
                pageSize={usersPageSize}
                onPageChange={(p) => fetchData(p)}
                onPageSizeChange={(s) => { setUsersPageSize(s); fetchData(1, searchQuery, false, s) }}
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
              />
            )}

            {activeTab === "users" && selectedUser && (
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
                      .map((b) => ({ ...b, awarded_at: new Date().toISOString() }))
                    const kept = prev.badges.filter((b) => !revokedIds.includes(b.id))
                    return { ...prev, badges: [...kept, ...awardedBadges] }
                  })
                }}
                onClose={() => { setSelectedUser(null); setTempPassword(null); updateUrlWithUser(null, activeTab) }}
                onAction={async (userId, action, extra) => {
                  if (extra && Object.keys(extra).length > 0) {
                    return handleAction(userId, action, extra)
                  }
                  if (["set_role", "award_badge", "revoke_badge", "create_badge", "delete_badge", "update_name", "update_email", "update_plan", "enable", "clear_rate_limits", "gift_subscription", "revoke_gift", "add_note", "edit_note", "delete_note", "verify_email", "unverify_email", "clear_avatar", "toggle_beta_access"].includes(action)) {
                    return handleAction(userId, action, extra)
                  }
                  const confirmActions = ["delete_user", "disable", "reset_password", "revoke_sessions", "revoke_api_keys", "reset_2fa", "delete_scans", "delete_webhooks", "delete_schedules", "force_logout_all"]
                  if (confirmActions.includes(action)) {
                    const messages: Record<string, { title: string; desc: string; label: string; danger?: boolean }> = {
                      delete_user: { title: "Delete User", desc: `This will permanently delete ${selectedUser.user.email} and all their data. This cannot be undone.`, label: "Delete User", danger: true },
                      disable: { title: "Disable Account", desc: `This will suspend ${selectedUser.user.email}'s account and log them out of all sessions. They will not be able to log in until re-enabled.`, label: "Disable Account", danger: true },
                      reset_password: { title: "Reset Password", desc: `This will generate a temporary password for ${selectedUser.user.email}. All sessions will be invalidated. Share the temporary password securely.`, label: "Reset Password" },
                      revoke_sessions: { title: "Revoke All Sessions", desc: `This will force-logout ${selectedUser.user.email} from all devices and browsers.`, label: "Revoke Sessions" },
                      revoke_api_keys: { title: "Revoke All API Keys", desc: `This will immediately revoke all active API keys for ${selectedUser.user.email}.`, label: "Revoke Keys" },
                      reset_2fa: { title: "Reset Two-Factor Authentication", desc: `This will remove 2FA from ${selectedUser.user.email}'s account. They will need to set it up again.`, label: "Reset 2FA", danger: true },
                      delete_scans: { title: "Delete All Scans", desc: `This will permanently delete all scan history for ${selectedUser.user.email}. This cannot be undone.`, label: "Delete Scans", danger: true },
                      delete_webhooks: { title: "Delete All Webhooks", desc: `This will permanently delete all webhooks for ${selectedUser.user.email}. This cannot be undone.`, label: "Delete Webhooks", danger: true },
                      delete_schedules: { title: "Delete All Schedules", desc: `This will permanently delete all scheduled scans for ${selectedUser.user.email}. This cannot be undone.`, label: "Delete Schedules", danger: true },
                      force_logout_all: { title: "Force Logout All", desc: `This will revoke all sessions AND all API keys for ${selectedUser.user.email}.`, label: "Logout All", danger: true },
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

            {activeTab === "audit" && (
              <AuditLog
                logs={auditLogs}
                loading={auditPaging}
                page={auditPage}
                totalPages={auditTotalPages}
                pageSize={auditPageSize}
                onPageChange={(p) => fetchAudit(p)}
                onPageSizeChange={(s) => { setAuditPageSize(s); fetchAudit(1, s) }}
                onRefresh={() => fetchAudit(1)}
              />
            )}

            {activeTab === "teams" && (
              <TeamsList
                teams={teams}
                loading={teamsLoading}
                page={teamsPage}
                totalPages={teamsTotalPages}
                search={teamsSearch}
                onSearchChange={setTeamsSearch}
                onSearch={() => fetchTeams(1, teamsSearch)}
                onPageChange={(p) => fetchTeams(p)}
                onRefresh={() => fetchTeams(1)}
                onViewMembers={fetchTeamMembers}
                onRename={handleTeamRename}
                onDelete={(teamId, teamName) => setConfirmDialog({
                  title: "Delete Team",
                  description: `This will permanently delete "${teamName}" and remove all members. This cannot be undone.`,
                  confirmLabel: "Delete Team",
                  danger: true,
                  action: () => handleTeamDelete(teamId)
                })}
                callerRole={callerRole}
                actionLoading={actionLoading}
                teamMembers={teamMembers}
                teamMembersLoading={teamMembersLoading}
                onCloseTeamMembers={() => setTeamMembers(null)}
              />
            )}

            {activeTab === "admins" && (
              <ActiveStaff
                admins={activeAdmins}
                loading={adminsLoading}
                onRefresh={fetchActiveAdmins}
                page={staffPage}
                pageSize={staffPageSize}
                onPageChange={setStaffPage}
                onPageSizeChange={(s) => { setStaffPageSize(s); setStaffPage(1) }}
              />
            )}

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

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}


