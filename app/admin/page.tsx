"use client"

import React from "react"
import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ShieldOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { usePagination } from "@/components/ui/pagination-control"
import { API } from "@/lib/constants"
import {
  hasStaffPermission,
  getAvailableActions,
  STAFF_PERMISSIONS,
} from "@/lib/permissions-client"
import { SaveConfirmationModal, type ChangeItem, type AffectedUser } from "@/components/save-confirmation-modal"

// New modular components
import {
  type AdminStats,
  type AdminUser,
  type UserDetail,
  type AuditEntry,
  type ActiveAdmin,
  type BadgeDef,
  type AdminTab,
  Toast,
  ConfirmDialog,
  AdminLayout,
  AdminSidebar,
  AdminHeader,
  StatsGrid,
  UsersTable,
  UserDetailPanel,
  AuditLog,
  TeamsList,
  ActiveStaff,
} from "@/components/admin"

export default function AdminPage() {
  return <AdminContent />
}

function AdminContent() {
  const router = useRouter()
  
  // Core state
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [callerRole, setCallerRole] = useState<string>("user")
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<AdminTab>("overview")
  
  // Stats
  const [stats, setStats] = useState<AdminStats | null>(null)
  
  // Users state
  const [users, setUsers] = useState<AdminUser[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [usersPageSize, setUsersPageSize] = useState(10)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchLoading, setSearchLoading] = useState(false)
  const [sortBy, setSortBy] = useState("created_at")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const searchInitRef = useRef(false)
  
  // User detail state
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [allBadges, setAllBadges] = useState<BadgeDef[]>([])
  
  // Audit state
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [auditPage, setAuditPage] = useState(1)
  const [auditTotalPages, setAuditTotalPages] = useState(1)
  const [auditPageSize, setAuditPageSize] = useState(10)
  const [auditLoading, setAuditLoading] = useState(false)
  
  // Teams state
  const [teams, setTeams] = useState<{ id: number; name: string; slug: string; created_at: string; owner_id: number; owner_email: string; owner_name: string | null; owner_avatar: string | null; member_count: number; pending_invites: number }[]>([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [teamsPage, setTeamsPage] = useState(1)
  const [teamsTotalPages, setTeamsTotalPages] = useState(1)
  const [teamsPageSize, setTeamsPageSize] = useState(10)
  
  // Staff state
  const [activeAdmins, setActiveAdmins] = useState<ActiveAdmin[]>([])
  const [adminsLoading, setAdminsLoading] = useState(false)
  
  // Dialogs
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    description: string
    confirmLabel: string
    danger?: boolean
    action: () => Promise<void>
  } | null>(null)
  
  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type })
  }, [])

  // URL hash sync
  const updateUrlWithUser = useCallback((userId: number | null, tab?: string, replace = true) => {
    if (typeof window === "undefined") return
    const parts: string[] = []
    if (tab) parts.push(tab)
    if (userId) parts.push(`user-${userId}`)
    const hash = parts.join("/")
    const method = replace ? "replaceState" : "pushState"
    window.history[method](null, "", `/admin${hash ? `#${hash}` : ""}`)
  }, [])

  const handleHashChange = useCallback(() => {
    if (typeof window === "undefined") return
    const hash = window.location.hash.replace("#", "")
    if (!hash) {
      window.history.replaceState(null, "", "/admin#overview")
      setSelectedUser(null)
      return
    }

    const parts = hash.split("/")
    let foundUser = false
    for (const part of parts) {
      if (["overview", "users", "audit", "teams", "staff"].includes(part)) {
        setActiveTab(part as AdminTab)
        if (part === "audit") fetchAudit()
        if (part === "staff") fetchActiveAdmins()
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
  }, [])

  useEffect(() => {
    handleHashChange()
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [handleHashChange])

  // Data fetching
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
    setAuditLoading(true)
    try {
      const res = await fetch(`${API.ADMIN}?section=audit&page=${p}&limit=${limit}`)
      const data = await res.json()
      setAuditLogs(data.logs)
      setAuditPage(data.page)
      setAuditTotalPages(data.totalPages)
    } catch { /* ignore */ }
    setAuditLoading(false)
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

  async function fetchTeams(p = 1) {
    setTeamsLoading(true)
    try {
      const res = await fetch(`/api/v2/admin/teams?page=${p}&limit=10`)
      const data = await res.json()
      setTeams(data.teams || [])
      setTeamsPage(data.page || 1)
      setTeamsTotalPages(data.totalPages || 1)
    } catch { /* ignore */ }
    setTeamsLoading(false)
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
    if (activeTab === "staff") fetchActiveAdmins()
    if (activeTab === "teams") fetchTeams()
  }, [activeTab])

  // Action handler
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
          add_note: "Note added.",
          impersonate: "Impersonation started.",
          clear_avatar: "Avatar cleared.",
          export_data: "Data export started.",
          delete_schedules: "All schedules deleted.",
          delete_webhooks: "All webhooks deleted.",
        }
        if (action === "create_badge" || action === "delete_badge") fetchAllBadges()
        showToast(labels[action] || "Action completed.", "success")
        
        const skipRefetch = action === "award_badge" || action === "revoke_badge" || action === "add_note"
        if (!skipRefetch) {
          await fetchData(page)
          if (selectedUser && selectedUser.user.id === userId) {
            if (action === "delete") { setSelectedUser(null); updateUrlWithUser(null, activeTab) }
            else await fetchUserDetail(userId)
          }
        } else if (selectedUser && selectedUser.user.id === userId) {
          await fetchUserDetail(userId)
        }
      } else {
        showToast(data.error || "Action failed.", "error")
      }
    } catch { showToast("Action failed.", "error") }
    setActionLoading(null)
    setConfirmDialog(null)
  }

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

  // Sort handler
  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortBy(field)
      setSortDir("desc")
    }
  }

  // Permissions
  const availableActions = getAvailableActions(callerRole)
  const canDisable = hasStaffPermission(callerRole, STAFF_PERMISSIONS.DISABLE_USER)
  const canReset2FA = hasStaffPermission(callerRole, STAFF_PERMISSIONS.RESET_2FA)
  const canRevokeSessions = hasStaffPermission(callerRole, STAFF_PERMISSIONS.REVOKE_SESSIONS)
  const canResetPassword = hasStaffPermission(callerRole, STAFF_PERMISSIONS.RESET_PASSWORD)
  const canManageBadges = hasStaffPermission(callerRole, STAFF_PERMISSIONS.MANAGE_BADGES)

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
      
      <AdminLayout>
        {/* Sidebar Navigation */}
        <AdminSidebar
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab)
            updateUrlWithUser(null, tab)
          }}
        />

        {/* Main Content */}
        <main className="flex-1 p-6 lg:p-8 pb-20 lg:pb-8 overflow-auto">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Page Header - Only show on non-overview tabs */}
            {activeTab !== "overview" && (
              <AdminHeader
                title={activeTab === "users" ? "User Management" : activeTab === "audit" ? "Audit Log" : activeTab === "teams" ? "Team Management" : "Staff Directory"}
                subtitle={activeTab === "users" ? "View and manage user accounts" : activeTab === "audit" ? "Track administrative actions" : activeTab === "teams" ? "Monitor teams and organizations" : "View active staff members"}
                onRefresh={() => {
                  if (activeTab === "users") fetchData(page, searchQuery)
                  if (activeTab === "audit") fetchAudit()
                  if (activeTab === "teams") fetchTeams()
                  if (activeTab === "staff") fetchActiveAdmins()
                }}
                refreshing={activeTab === "users" ? loading : activeTab === "audit" ? auditLoading : activeTab === "teams" ? teamsLoading : adminsLoading}
              />
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading admin data...</p>
              </div>
            ) : (
              <>
                {/* Overview Tab - Stats */}
                {activeTab === "overview" && (
                  <StatsGrid stats={stats} loading={loading} />
                )}

                {/* Users Tab */}
                {activeTab === "users" && (
                  <div className="space-y-6">
                    {/* User Detail Panel */}
                    {selectedUser && (
                      <UserDetailPanel
                        detail={selectedUser}
                        loading={detailLoading}
                        onClose={() => {
                          setSelectedUser(null)
                          updateUrlWithUser(null, activeTab)
                        }}
                        onAction={async (userId, action, extra) => {
                          await handleAction(userId, action, extra)
                        }}
                        onConfirmAction={(config) => setConfirmDialog({
                          title: config.title,
                          description: config.description,
                          confirmLabel: config.confirmLabel,
                          danger: config.danger,
                          action: async () => {
                            await config.action()
                            setConfirmDialog(null)
                          },
                        })}
                        actionLoading={actionLoading}
                        allBadges={allBadges}
                        availableActions={availableActions}
                        canDisable={canDisable}
                        canReset2FA={canReset2FA}
                        canRevokeSessions={canRevokeSessions}
                        canResetPassword={canResetPassword}
                        canManageBadges={canManageBadges}
                      />
                    )}

                    {/* Users Table */}
                    {!selectedUser && (
                      <UsersTable
                        users={users}
                        loading={loading}
                        searchLoading={searchLoading}
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        onUserSelect={(userId) => fetchUserDetail(userId)}
                        onAction={async (userId, action) => {
                          await handleAction(userId, action)
                        }}
                        onConfirmAction={(config) => setConfirmDialog({
                          title: config.title,
                          description: config.description,
                          confirmLabel: config.confirmLabel,
                          danger: config.danger,
                          action: async () => {
                            await config.action()
                            setConfirmDialog(null)
                          },
                        })}
                        actionLoading={actionLoading}
                        callerRole={callerRole}
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
                  </div>
                )}

                {/* Audit Tab */}
                {activeTab === "audit" && (
                  <AuditLog
                    logs={auditLogs}
                    loading={auditLoading}
                    onRefresh={() => fetchAudit(1)}
                    page={auditPage}
                    totalPages={auditTotalPages}
                    pageSize={auditPageSize}
                    onPageChange={(p) => fetchAudit(p)}
                    onPageSizeChange={(s) => { setAuditPageSize(s); fetchAudit(1, s) }}
                  />
                )}

                {/* Teams Tab */}
                {activeTab === "teams" && (
                  <TeamsList
                    teams={teams.map(t => ({
                      ...t,
                      owner_avatar: t.owner_avatar || null,
                      pending_invites: t.pending_invites || 0,
                    }))}
                    loading={teamsLoading}
                    onRefresh={() => fetchTeams(teamsPage)}
                    page={teamsPage}
                    totalPages={teamsTotalPages}
                    pageSize={teamsPageSize}
                    onPageChange={(p) => fetchTeams(p)}
                    onPageSizeChange={(s) => { setTeamsPageSize(s); fetchTeams(1) }}
                  />
                )}

                {/* Staff Tab */}
                {activeTab === "staff" && (
                  <ActiveStaff
                    staff={activeAdmins}
                    loading={adminsLoading}
                    onRefresh={fetchActiveAdmins}
                    onStaffSelect={(staff) => {
                      setActiveTab("users")
                      fetchUserDetail(staff.id)
                      updateUrlWithUser(staff.id, "users", false)
                    }}
                  />
                )}
              </>
            )}
          </div>
        </main>
      </AdminLayout>

      <Footer />

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

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
    </div>
  )
}
