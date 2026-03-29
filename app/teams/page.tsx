"use client"
import { TEAM_ROLES, STAFF_ROLE_LABELS, ROLE_BADGE_STYLES, STAFF_ROLES, API } from "@/lib/config/constants"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/ui/utils"
import { PaginationControl, usePagination } from "@/components/ui/pagination-control"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Users,
  Plus,
  Loader2,
  Crown,
  Shield,
  Eye,
  Mail,
  Trash2,
  UserPlus,
  X,
  Copy,
  Check,
  LogOut,
  ChevronRight,
  ArrowLeft,
  Pencil,
  Search,
  MoreHorizontal,
  ExternalLink,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface Team {
  id: number
  name: string
  created_at: string
  role: string
  member_count: number
}

interface Member {
  user_id: number
  role: string
  joined_at: string
  name: string
  email: string
  avatar_url?: string
  staff_role?: string
}

interface Invite {
  id: number
  email: string
  role: string
  invited_at: string
  expires_at: string
}

const ROLE_ICONS: Record<string, typeof Crown> = { owner: Crown, admin: Shield, viewer: Eye }
const ROLE_COLORS: Record<string, string> = {
  owner: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  admin: "bg-primary/10 text-primary border-primary/20",
  viewer: "bg-muted text-muted-foreground border-border",
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export default function TeamsPage() {
  const router = useRouter()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  // Detail view
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [currentRole, setCurrentRole] = useState("")
  const [membersLoading, setMembersLoading] = useState(false)

  // Edit team name
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState("")
  const [savingName, setSavingName] = useState(false)

  // Invite
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"admin" | "viewer">("viewer")
  const [inviting, setInviting] = useState(false)
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Member scan history
  const [viewingMember, setViewingMember] = useState<Member | null>(null)
  const [memberScans, setMemberScans] = useState<any[]>([])
  const [scansLoading, setScansLoading] = useState(false)
  const [scanPage, setScanPage] = useState(1)

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch(API.TEAMS)
      if (!res.ok) { router.push("/login"); return }
      const data = await res.json()
      setTeams(data.teams || [])
    } catch {/* */ } finally { setLoading(false) }
  }, [router])

  useEffect(() => { fetchTeams() }, [fetchTeams])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch(API.TEAMS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (res.ok) {
        await fetchTeams()
        setNewName("")
        setShowCreate(false)
      }
    } catch {/* */ } finally { setCreating(false) }
  }

  async function handleDelete(teamId: number) {
    if (!confirm("Delete this team? All members will lose access.")) return
    await fetch(API.TEAMS, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    })
    setSelectedTeam(null)
    await fetchTeams()
  }

  async function openTeam(team: Team) {
    setSelectedTeam(team)
    setMembersLoading(true)
    setShowInvite(false)
    setInviteToken(null)
    try {
      const res = await fetch(`${API.TEAMS_MEMBERS}?teamId=${team.id}`)
      if (res.ok) {
        const data = await res.json()
        setMembers(data.members || [])
        setInvites(data.invites || [])
        setCurrentRole(data.currentRole || "viewer")
      }
    } catch {/* */ } finally { setMembersLoading(false) }
  }

  async function handleInvite() {
    if (!inviteEmail.trim() || !selectedTeam) return
    setInviting(true)
    setInviteToken(null)
    try {
      const res = await fetch(API.TEAMS_MEMBERS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeam.id, email: inviteEmail.trim(), role: inviteRole }),
      })
      const data = await res.json()
      if (res.ok) {
        setInviteToken(data.token)
        setInviteEmail("")
        await openTeam(selectedTeam)
      }
    } catch {/* */ } finally { setInviting(false) }
  }

  async function handleRemoveMember(userId: number) {
    if (!selectedTeam) return
    if (!confirm("Remove this member from the team?")) return
    await fetch(API.TEAMS_MEMBERS, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: selectedTeam.id, userId }),
    })
    await openTeam(selectedTeam)
  }

  async function handleCancelInvite(inviteId: number) {
    if (!selectedTeam) return
    await fetch(API.TEAMS_MEMBERS, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: selectedTeam.id, inviteId }),
    })
    await openTeam(selectedTeam)
  }

  async function handleLeave() {
    if (!selectedTeam) return
    if (!confirm("Leave this team?")) return
    const res = await fetch(API.TEAMS_MEMBERS, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: selectedTeam.id, userId: "self" }),
    })
    if (res.ok) {
      setSelectedTeam(null)
      await fetchTeams()
    }
  }

  async function handleRename() {
    if (!selectedTeam || !nameInput.trim() || nameInput.trim() === selectedTeam.name) {
      setEditingName(false)
      return
    }
    setSavingName(true)
    try {
      const res = await fetch(API.TEAMS, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeam.id, name: nameInput.trim() }),
      })
      if (res.ok) {
        setSelectedTeam({ ...selectedTeam, name: nameInput.trim() })
        await fetchTeams()
      }
    } catch {/* */} finally {
      setSavingName(false)
      setEditingName(false)
    }
  }

  async function handleViewMemberScans(member: Member) {
    setViewingMember(member)
    setScanPage(1)
    setScansLoading(true)
    try {
      const res = await fetch(`${API.TEAMS_MEMBER_SCANS}?teamId=${selectedTeam?.id}&userId=${member.user_id}`)
      if (res.ok) {
        const data = await res.json()
        setMemberScans(data.scans || [])
      }
    } catch (err) {
      console.error("Failed to fetch member scans:", err)
    } finally {
      setScansLoading(false)
    }
  }

  function copyInviteLink() {
    if (inviteToken) {
      navigator.clipboard.writeText(`${window.location.origin}/teams/join?token=${inviteToken}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const [scansPageSize, setScansPageSize] = useState(10)
  const SCANS_PAGE_SIZE = scansPageSize
  const { totalPages: scanTotalPages, getPage: getScanPage } = usePagination(memberScans, SCANS_PAGE_SIZE)
  const paginatedScans = getScanPage(scanPage)

  const canManage = currentRole === TEAM_ROLES.OWNER || currentRole === TEAM_ROLES.ADMIN

  // Filter teams by search
  const filteredTeams = teams.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading teams...</p>
            </div>
          ) : selectedTeam ? (
            /* Team Detail View */
            <>
              <button type="button" onClick={() => setSelectedTeam(null)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
                <ArrowLeft className="h-4 w-4" />Back to Teams
              </button>

              {/* Team header card */}
              <Card className="bg-card border-border">
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {editingName ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={nameInput}
                            onChange={(e) => setNameInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditingName(false) }}
                            className="h-9 text-base font-semibold w-48 sm:w-64"
                            autoFocus
                            maxLength={50}
                          />
                          <Button size="sm" className="h-9 w-9 p-0" onClick={handleRename} disabled={savingName}>
                            {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => setEditingName(false)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <h2 className="text-xl font-semibold tracking-tight truncate">{selectedTeam.name}</h2>
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => { setNameInput(selectedTeam.name); setEditingName(true) }}
                              className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted shrink-0"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      <p className="text-sm text-muted-foreground mt-1">
                        {members.length} member{members.length !== 1 && "s"} · Your role: <span className="capitalize">{currentRole}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      {canManage && (
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setShowInvite(!showInvite); setInviteToken(null) }}>
                          <UserPlus className="h-4 w-4" />
                          <span className="hidden sm:inline">Invite</span>
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {currentRole === TEAM_ROLES.OWNER ? (
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(selectedTeam.id)}>
                              <Trash2 className="h-4 w-4 mr-2" />Delete Team
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleLeave}>
                              <LogOut className="h-4 w-4 mr-2" />Leave Team
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Invite form */}
              {showInvite && (
                <Card className="bg-card border-border">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-sm font-medium">Invite Team Member</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Send an invite link to add a new member</p>
                      </div>
                      <button type="button" onClick={() => { setShowInvite(false); setInviteToken(null) }} className="text-muted-foreground hover:text-foreground p-1">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input placeholder="email@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="flex-1" />
                      <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "admin" | "viewer")} className="h-10 rounded-md border border-border bg-background px-3 text-sm">
                        <option value="viewer">Viewer</option>
                        <option value="admin">Admin</option>
                      </select>
                      <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()} className="h-10">
                        {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Invite"}
                      </Button>
                    </div>
                    {inviteToken && (
                      <div className="mt-4 p-4 rounded-lg bg-muted/50 border border-border">
                        <p className="text-xs text-muted-foreground mb-2">Share this invite link (expires in 7 days):</p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-xs bg-background border border-border rounded px-3 py-2 font-mono break-all select-all">
                            {`${typeof window !== "undefined" ? window.location.origin : ""}/teams/join?token=${inviteToken}`}
                          </code>
                          <Button variant="outline" size="sm" className="shrink-0 h-9 w-9 p-0" onClick={copyInviteLink}>
                            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Members list */}
              <Card className="bg-card border-border">
                <CardContent className="p-0">
                  <div className="px-5 py-4 border-b border-border">
                    <p className="text-sm font-medium">Members</p>
                  </div>
                  {membersLoading ? (
                    <div className="flex items-center gap-2 py-12 justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Loading members...</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {members.map((m) => {
                        const Icon = ROLE_ICONS[m.role] || Eye
                        return (
                          <div key={m.user_id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                            {m.avatar_url ? (
                              <img src={m.avatar_url} alt="" loading="lazy" className="w-9 h-9 rounded-full object-cover shrink-0" />
                            ) : (
                              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-muted shrink-0">
                                <span className="text-sm font-medium">{(m.name || m.email)[0].toUpperCase()}</span>
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium truncate">{m.name || "Unnamed"}</p>
                                {m.staff_role && m.staff_role !== STAFF_ROLES.USER && ROLE_BADGE_STYLES[m.staff_role] && (
                                  <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border shrink-0", ROLE_BADGE_STYLES[m.staff_role])}>
                                    {STAFF_ROLE_LABELS[m.staff_role] || m.staff_role}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                            </div>
                            <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border shrink-0", ROLE_COLORS[m.role])}>
                              <Icon className="h-3 w-3" /><span className="capitalize">{m.role}</span>
                            </span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem onClick={() => handleViewMemberScans(m)}>
                                  <Eye className="h-4 w-4 mr-2" />View Scans
                                </DropdownMenuItem>
                                {canManage && m.role !== TEAM_ROLES.OWNER && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleRemoveMember(m.user_id)}>
                                      <X className="h-4 w-4 mr-2" />Remove
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Pending invites */}
              {invites.length > 0 && (
                <Card className="bg-card border-border">
                  <CardContent className="p-0">
                    <div className="px-5 py-4 border-b border-border">
                      <p className="text-sm font-medium">Pending Invites</p>
                    </div>
                    <div className="divide-y divide-border">
                      {invites.map((inv) => (
                        <div key={inv.id} className="flex items-center gap-3 px-5 py-3">
                          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-muted/50 shrink-0">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-muted-foreground truncate">{inv.email}</p>
                            <p className="text-xs text-muted-foreground/70">Expires {new Date(inv.expires_at).toLocaleDateString()}</p>
                          </div>
                          <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border capitalize", ROLE_COLORS[inv.role])}>
                            {inv.role}
                          </span>
                          {canManage && (
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleCancelInvite(inv.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Member Scan History Modal */}
              {viewingMember && (
                <Card className="bg-card border-border">
                  <CardContent className="p-0">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                      <div>
                        <p className="text-sm font-medium">{viewingMember.name || viewingMember.email}&apos;s Scan History</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{memberScans.length} scan{memberScans.length !== 1 && "s"} total</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setViewingMember(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {scansLoading ? (
                      <div className="flex items-center gap-2 py-12 justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Loading scans...</p>
                      </div>
                    ) : memberScans.length === 0 ? (
                      <div className="py-12 text-center">
                        <p className="text-sm text-muted-foreground">No scans found</p>
                      </div>
                    ) : (
                      <>
                        <div className="divide-y divide-border">
                          {paginatedScans.map((scan: any) => (
                            <div key={scan.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{scan.url}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatRelativeTime(new Date(scan.scanned_at))} · {scan.findings_count} issue{scan.findings_count !== 1 ? "s" : ""}
                                </p>
                              </div>
                              <Button variant="ghost" size="sm" className="gap-1.5" asChild>
                                <a href={`/history#${scan.id}`}>
                                  View<ExternalLink className="h-3 w-3" />
                                </a>
                              </Button>
                            </div>
                          ))}
                        </div>
                        <div className="p-4 border-t border-border">
                          <PaginationControl
                            currentPage={scanPage}
                            totalPages={scanTotalPages}
                            onPageChange={setScanPage}
                            pageSize={scansPageSize}
                            onPageSizeChange={(s) => { setScansPageSize(s); setScanPage(1) }}
                            totalItems={memberScans.length}
                          />
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            /* Teams List View */
            <>
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
                <p className="text-sm text-muted-foreground">Collaborate with team members on security scans.</p>
              </div>

              {/* Search and create */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search teams..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Button className="gap-1.5 shrink-0" onClick={() => setShowCreate(!showCreate)}>
                  <Plus className="h-4 w-4" />New Team
                </Button>
              </div>

              {/* Create form */}
              {showCreate && (
                <Card className="bg-card border-border">
                  <CardContent className="p-5">
                    <p className="text-sm font-medium mb-3">Create New Team</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input placeholder="Team name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} className="flex-1" autoFocus />
                      <div className="flex gap-2">
                        <Button onClick={handleCreate} disabled={creating || !newName.trim()} className="h-10">
                          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
                        </Button>
                        <Button variant="outline" className="h-10" onClick={() => { setShowCreate(false); setNewName("") }}>Cancel</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Teams list */}
              {filteredTeams.length === 0 && !searchQuery ? (
                <Card className="bg-card border-border border-dashed">
                  <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
                      <Users className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">No teams yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Create a team to collaborate on security scans with others.</p>
                    </div>
                    <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
                      <Plus className="h-4 w-4" />Create Your First Team
                    </Button>
                  </CardContent>
                </Card>
              ) : filteredTeams.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">No teams match &quot;{searchQuery}&quot;</p>
                </div>
              ) : (
                <Card className="bg-card border-border">
                  <CardContent className="p-0">
                    {/* Table header */}
                    <div className="hidden sm:grid grid-cols-[1fr_100px_100px_32px] gap-4 px-5 py-3 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <span>Team</span>
                      <span>Members</span>
                      <span>Your Role</span>
                      <span></span>
                    </div>
                    <div className="divide-y divide-border">
                      {filteredTeams.map((team) => {
                        const Icon = ROLE_ICONS[team.role] || Eye
                        return (
                          <button
                            key={team.id}
                            type="button"
                            onClick={() => openTeam(team)}
                            className="group w-full flex items-center sm:grid sm:grid-cols-[1fr_100px_100px_32px] gap-4 px-5 py-4 hover:bg-muted/30 transition-colors text-left"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{team.name}</p>
                              <p className="text-xs text-muted-foreground sm:hidden">{team.member_count} member{team.member_count !== 1 && "s"}</p>
                            </div>
                            <span className="hidden sm:block text-sm text-muted-foreground tabular-nums">{team.member_count}</span>
                            <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border shrink-0", ROLE_COLORS[team.role])}>
                              <Icon className="h-3 w-3" /><span className="capitalize">{team.role}</span>
                            </span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
                          </button>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
