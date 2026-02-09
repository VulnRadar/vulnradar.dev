"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
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
} from "lucide-react"

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
  owner: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  admin: "bg-primary/10 text-primary border-primary/20",
  viewer: "bg-muted text-muted-foreground border-border",
}

export default function TeamsPage() {
  const router = useRouter()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [showCreate, setShowCreate] = useState(false)

  // Detail view
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [currentRole, setCurrentRole] = useState("")
  const [membersLoading, setMembersLoading] = useState(false)

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

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch("/api/teams")
      if (!res.ok) { router.push("/login"); return }
      const data = await res.json()
      setTeams(data.teams || [])
    } catch {/* */} finally { setLoading(false) }
  }, [router])

  useEffect(() => { fetchTeams() }, [fetchTeams])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (res.ok) {
        await fetchTeams()
        setNewName("")
        setShowCreate(false)
      }
    } catch {/* */} finally { setCreating(false) }
  }

  async function handleDelete(teamId: number) {
    if (!confirm("Delete this team? All members will lose access.")) return
    await fetch("/api/teams", {
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
      const res = await fetch(`/api/teams/members?teamId=${team.id}`)
      if (res.ok) {
        const data = await res.json()
        setMembers(data.members || [])
        setInvites(data.invites || [])
        setCurrentRole(data.currentRole || "viewer")
      }
    } catch {/* */} finally { setMembersLoading(false) }
  }

  async function handleInvite() {
    if (!inviteEmail.trim() || !selectedTeam) return
    setInviting(true)
    setInviteToken(null)
    try {
      const res = await fetch("/api/teams/members", {
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
    } catch {/* */} finally { setInviting(false) }
  }

  async function handleRemoveMember(userId: number) {
    if (!selectedTeam) return
    if (!confirm("Remove this member from the team?")) return
    await fetch("/api/teams/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: selectedTeam.id, userId }),
    })
    await openTeam(selectedTeam)
  }

  async function handleCancelInvite(inviteId: number) {
    if (!selectedTeam) return
    await fetch("/api/teams/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: selectedTeam.id, inviteId }),
    })
    await openTeam(selectedTeam)
  }

  async function handleLeave() {
    if (!selectedTeam) return
    if (!confirm("Leave this team?")) return
    const res = await fetch("/api/teams/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: selectedTeam.id, userId: "self" }),
    })
    if (res.ok) {
      setSelectedTeam(null)
      await fetchTeams()
    }
  }

  async function handleViewMemberScans(member: Member) {
    setViewingMember(member)
    setScansLoading(true)
    try {
      const res = await fetch(`/api/teams/member-scans?teamId=${selectedTeam?.id}&userId=${member.user_id}`)
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

  const canManage = currentRole === "owner" || currentRole === "admin"

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-6 sm:py-8 flex flex-col gap-6">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading teams...</p>
          </div>
        ) : selectedTeam ? (
          /* Team Detail View */
          <div className="flex flex-col gap-6">
            <button type="button" onClick={() => setSelectedTeam(null)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
              <ArrowLeft className="h-4 w-4" />Back to Teams
            </button>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">{selectedTeam.name}</h2>
                  <p className="text-xs text-muted-foreground">{members.length} member{members.length !== 1 && "s"} | Your role: {currentRole}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                {canManage && (
                  <Button variant="outline" size="sm" className="bg-transparent gap-1.5" onClick={() => { setShowInvite(!showInvite); setInviteToken(null) }}>
                    <UserPlus className="h-3.5 w-3.5" />Invite
                  </Button>
                )}
                {currentRole === "owner" ? (
                  <Button variant="outline" size="sm" className="bg-transparent text-destructive hover:text-destructive gap-1.5" onClick={() => handleDelete(selectedTeam.id)}>
                    <Trash2 className="h-3.5 w-3.5" />Delete Team
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="bg-transparent text-destructive hover:text-destructive gap-1.5" onClick={handleLeave}>
                    <LogOut className="h-3.5 w-3.5" />Leave
                  </Button>
                )}
              </div>
            </div>

            {/* Invite form */}
            {showInvite && (
              <Card className="bg-card border-border">
                <CardContent className="pt-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">Invite Team Member</p>
                    <button type="button" onClick={() => { setShowInvite(false); setInviteToken(null) }} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input placeholder="email@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="flex-1" />
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "admin" | "viewer")} className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground">
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()} size="sm" className="h-10">
                      {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send Invite"}
                    </Button>
                  </div>
                  {inviteToken && (
                    <div className="bg-muted/30 border border-border rounded-lg p-3">
                      <p className="text-xs text-muted-foreground mb-2">Share this invite link (expires in 7 days):</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-[11px] text-foreground bg-background border border-border rounded px-2 py-1.5 font-mono break-all select-all">
                          {`${typeof window !== "undefined" ? window.location.origin : ""}/teams/join?token=${inviteToken}`}
                        </code>
                        <Button variant="outline" size="sm" className="bg-transparent shrink-0 h-8 w-8 p-0" onClick={copyInviteLink}>
                          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Members list */}
            {membersLoading ? (
              <div className="flex items-center gap-2 py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading members...</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {members.map((m) => {
                  const Icon = ROLE_ICONS[m.role] || Eye
                  return (
                    <div key={m.user_id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
                      <div className="flex items-center justify-center w-9 h-9 rounded-full bg-muted">
                        <span className="text-sm font-medium text-foreground">{(m.name || m.email)[0].toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{m.name || "Unnamed"}</p>
                        <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                      </div>
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border", ROLE_COLORS[m.role])}>
                        <Icon className="h-3 w-3" />{m.role}
                      </span>
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-foreground gap-1" onClick={() => handleViewMemberScans(m)}>
                        <Eye className="h-3.5 w-3.5" />
                        <span className="text-xs">View Scans</span>
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                      {canManage && m.role !== "owner" && (
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleRemoveMember(m.user_id)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )
                })}

                {/* Pending invites */}
                {invites.length > 0 && (
                  <>
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mt-4 mb-1">Pending Invites</p>
                    {invites.map((inv) => (
                      <div key={inv.id} className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-border bg-card/50">
                        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-muted/50">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-muted-foreground truncate">{inv.email}</p>
                          <p className="text-[10px] text-muted-foreground">Expires {new Date(inv.expires_at).toLocaleDateString()}</p>
                        </div>
                        <span className={cn("text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border", ROLE_COLORS[inv.role])}>
                          {inv.role}
                        </span>
                        {canManage && (
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleCancelInvite(inv.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Member Scan History Modal */}
            {viewingMember && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Eye className="h-4 w-4 text-primary" />
                      {viewingMember.name || viewingMember.email}'s Scan History
                    </CardTitle>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setViewingMember(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {scansLoading ? (
                    <div className="flex items-center gap-2 py-8 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Loading scans...</p>
                    </div>
                  ) : memberScans.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-sm text-muted-foreground">No scans found</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                      {memberScans.map((scan: any) => (
                        <div key={scan.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{scan.url}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(scan.scanned_at).toLocaleDateString()} • {scan.findings_count} issue{scan.findings_count !== 1 ? 's' : ''}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-3 gap-1.5"
                            onClick={() => router.push(`/history?id=${scan.id}`)}
                          >
                            View
                            <ChevronRight className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          /* Teams List View */
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />Teams
                </h1>
                <p className="text-sm text-muted-foreground">Collaborate with team members on security scans.</p>
              </div>
              <Button size="sm" className="shrink-0 gap-1.5 self-start sm:self-auto" onClick={() => setShowCreate(!showCreate)}>
                <Plus className="h-3.5 w-3.5" />New Team
              </Button>
            </div>

            {showCreate && (
              <Card className="bg-card border-border">
                <CardContent className="pt-4 flex flex-col sm:flex-row gap-2">
                  <Input placeholder="Team name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} className="flex-1" autoFocus />
                  <div className="flex gap-2">
                    <Button onClick={handleCreate} disabled={creating || !newName.trim()} size="sm" className="h-10">
                      {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
                    </Button>
                    <Button variant="outline" size="sm" className="h-10 bg-transparent" onClick={() => { setShowCreate(false); setNewName("") }}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {teams.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-16 text-center rounded-xl border border-dashed border-border">
                <Users className="h-10 w-10 text-muted-foreground/20" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-foreground">No teams yet</p>
                  <p className="text-xs text-muted-foreground">Create a team to collaborate on security scans with others.</p>
                </div>
                <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />Create Your First Team
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {teams.map((team) => {
                  const Icon = ROLE_ICONS[team.role] || Eye
                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => openTeam(team)}
                      className="group flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-muted/50 hover:border-primary/20 transition-all text-left"
                    >
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 shrink-0">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{team.name}</p>
                        <p className="text-xs text-muted-foreground">{team.member_count} member{team.member_count !== 1 && "s"}</p>
                      </div>
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border", ROLE_COLORS[team.role])}>
                        <Icon className="h-3 w-3" />{team.role}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
