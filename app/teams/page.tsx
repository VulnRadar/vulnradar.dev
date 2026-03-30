"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { usePagination } from "@/components/ui/pagination-control"
import { API, TEAM_ROLES } from "@/lib/config/constants"
import {
  type Team, type Member, type Invite, type MemberScan,
  TeamsList, TeamDetailHeader, TeamInviteForm, TeamMembersList, TeamMemberScans,
} from "@/components/teams"

export default function TeamsPage() {
  const router = useRouter()

  // List view state
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  // Detail view state
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [currentRole, setCurrentRole] = useState("")
  const [membersLoading, setMembersLoading] = useState(false)

  // Rename state
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState("")
  const [savingName, setSavingName] = useState(false)

  // Invite state
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"admin" | "viewer">("viewer")
  const [inviting, setInviting] = useState(false)
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Member scans state
  const [viewingMember, setViewingMember] = useState<Member | null>(null)
  const [memberScans, setMemberScans] = useState<MemberScan[]>([])
  const [scansLoading, setScansLoading] = useState(false)
  const [scanPage, setScanPage] = useState(1)
  const [scansPageSize, setScansPageSize] = useState(10)

  const { totalPages: scanTotalPages, getPage: getScanPage } = usePagination(memberScans, scansPageSize)
  const paginatedScans = getScanPage(scanPage)

  const canManage = currentRole === TEAM_ROLES.OWNER || currentRole === TEAM_ROLES.ADMIN

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch(API.TEAMS)
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
      const res = await fetch(API.TEAMS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (res.ok) { await fetchTeams(); setNewName(""); setShowCreate(false) }
    } catch {/* */} finally { setCreating(false) }
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
    setViewingMember(null)
    try {
      const res = await fetch(`${API.TEAMS_MEMBERS}?teamId=${team.id}`)
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
      const res = await fetch(API.TEAMS_MEMBERS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeam.id, email: inviteEmail.trim(), role: inviteRole }),
      })
      const data = await res.json()
      if (res.ok) { setInviteToken(data.token); setInviteEmail(""); await openTeam(selectedTeam) }
    } catch {/* */} finally { setInviting(false) }
  }

  async function handleRemoveMember(userId: number) {
    if (!selectedTeam || !confirm("Remove this member from the team?")) return
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
    if (!selectedTeam || !confirm("Leave this team?")) return
    const res = await fetch(API.TEAMS_MEMBERS, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: selectedTeam.id, userId: "self" }),
    })
    if (res.ok) { setSelectedTeam(null); await fetchTeams() }
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
      if (res.ok) { setSelectedTeam({ ...selectedTeam, name: nameInput.trim() }); await fetchTeams() }
    } catch {/* */} finally { setSavingName(false); setEditingName(false) }
  }

  async function handleViewMemberScans(member: Member) {
    setViewingMember(member)
    setScanPage(1)
    setScansLoading(true)
    try {
      const res = await fetch(`${API.TEAMS_MEMBER_SCANS}?teamId=${selectedTeam?.id}&userId=${member.user_id}`)
      if (res.ok) { const data = await res.json(); setMemberScans(data.scans || []) }
    } catch {/* */} finally { setScansLoading(false) }
  }

  function copyInviteLink() {
    if (!inviteToken) return
    navigator.clipboard.writeText(`${window.location.origin}/teams/join?token=${inviteToken}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading teams...</p>
          </div>
        ) : selectedTeam ? (
          <div className="flex flex-col gap-6">
            <TeamDetailHeader
              team={selectedTeam}
              currentRole={currentRole}
              memberCount={members.length}
              editingName={editingName}
              nameInput={nameInput}
              savingName={savingName}
              onBack={() => setSelectedTeam(null)}
              onEditName={() => { setNameInput(selectedTeam.name); setEditingName(true) }}
              onNameInputChange={setNameInput}
              onSaveName={handleRename}
              onCancelEdit={() => setEditingName(false)}
              onToggleInvite={() => { setShowInvite(!showInvite); setInviteToken(null) }}
              onDelete={() => handleDelete(selectedTeam.id)}
              onLeave={handleLeave}
            />

            {showInvite && canManage && (
              <TeamInviteForm
                inviteEmail={inviteEmail}
                inviteRole={inviteRole}
                inviting={inviting}
                inviteToken={inviteToken}
                copied={copied}
                onEmailChange={setInviteEmail}
                onRoleChange={setInviteRole}
                onInvite={handleInvite}
                onCopy={copyInviteLink}
                onClose={() => { setShowInvite(false); setInviteToken(null) }}
              />
            )}

            <TeamMembersList
              members={members}
              invites={invites}
              loading={membersLoading}
              currentRole={currentRole}
              onViewScans={handleViewMemberScans}
              onRemoveMember={handleRemoveMember}
              onCancelInvite={handleCancelInvite}
            />

            {viewingMember && (
              <TeamMemberScans
                member={viewingMember}
                scans={memberScans}
                loading={scansLoading}
                page={scanPage}
                pageSize={scansPageSize}
                totalPages={scanTotalPages}
                paginatedScans={paginatedScans as MemberScan[]}
                onClose={() => setViewingMember(null)}
                onPageChange={setScanPage}
                onPageSizeChange={setScansPageSize}
              />
            )}
          </div>
        ) : (
          <TeamsList
            teams={teams}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onOpenTeam={openTeam}
            onShowCreate={() => setShowCreate(true)}
            showCreate={showCreate}
            newName={newName}
            onNewNameChange={setNewName}
            onCreate={handleCreate}
            onCancelCreate={() => { setShowCreate(false); setNewName("") }}
            creating={creating}
          />
        )}
      </main>
      <Footer />
    </div>
  )
}
