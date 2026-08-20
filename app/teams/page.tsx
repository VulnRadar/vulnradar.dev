"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { usePagination } from "@/components/ui/pagination-control";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { API, TEAM_ROLES } from "@/lib/config/constants";
import {
  type Team,
  type Member,
  type Invite,
  type MemberScan,
  TeamsList,
  TeamDetailHeader,
  TeamInviteForm,
  TeamMembersList,
  TeamMemberScans,
} from "@/components/teams";
import { TeamsSkeleton } from "@/components/teams/teams-skeleton";
import { copyToClipboard } from "@/lib/ui/clipboard";

export default function TeamsPage() {
  const router = useRouter();

  // List view state
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Detail view state
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [currentRole, setCurrentRole] = useState("");
  const [membersLoading, setMembersLoading] = useState(false);

  // Rename state
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Invite state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<
    "admin" | "manager" | "operator" | "member" | "viewer"
  >("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Failures used to vanish into empty catch blocks. Surface them instead.
  const [actionError, setActionError] = useState<string | null>(null);

  // Confirmation state. Each destructive action names its target before it runs.
  type Confirmation =
    | { kind: "deleteTeam"; teamId: number; teamName: string }
    | { kind: "removeMember"; userId: number; label: string }
    | { kind: "leaveTeam"; teamName: string };
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Member scans state
  const [viewingMember, setViewingMember] = useState<Member | null>(null);
  const [memberScans, setMemberScans] = useState<MemberScan[]>([]);
  const [scansLoading, setScansLoading] = useState(false);
  // Ticket for the member-scans fetch so a slower earlier request can't
  // overwrite a newer one (see handleViewMemberScans).
  const memberScansReqRef = useRef(0);
  const [scanPage, setScanPage] = useState(1);
  const [scansPageSize, setScansPageSize] = useState(10);

  const { totalPages: scanTotalPages, getPage: getScanPage } = usePagination(
    memberScans,
    scansPageSize,
  );
  const paginatedScans = getScanPage(scanPage);

  const canManage =
    currentRole === TEAM_ROLES.OWNER || currentRole === TEAM_ROLES.ADMIN;

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch(API.TEAMS);
      if (!res.ok) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setTeams(data.teams || []);
    } catch {
      /* */
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchTeams();
  }, [fetchTeams]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setActionError(null);
    try {
      const res = await fetch(API.TEAMS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        await fetchTeams();
        setNewName("");
        setShowCreate(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setActionError(
          data.error || "We could not create that team. Try again.",
        );
      }
    } catch {
      setActionError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(teamId: number) {
    setActionError(null);
    try {
      const res = await fetch(API.TEAMS, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(
          data.error || "We could not delete that team. Try again.",
        );
        return;
      }
      setSelectedTeam(null);
      await fetchTeams();
    } catch {
      setActionError(
        "We could not reach the server. Check your connection and try again.",
      );
    }
  }

  // Reloads the member + invite lists WITHOUT touching the invite panel's
  // one-time-token state. handleInvite must use this, not openTeam: openTeam
  // resets inviteToken/showInvite, and React batches that reset into the same
  // render as handleInvite's setInviteToken, so the just-minted copy-once link
  // never renders (the only delivery path on a no-SMTP self-host).
  async function refreshMembers(team: Team) {
    setMembersLoading(true);
    try {
      const res = await fetch(`${API.TEAMS_MEMBERS}?teamId=${team.id}`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
        setInvites(data.invites || []);
        setCurrentRole(data.currentRole || "viewer");
      }
    } catch {
      /* */
    } finally {
      setMembersLoading(false);
    }
  }

  async function openTeam(team: Team) {
    setSelectedTeam(team);
    setShowInvite(false);
    setInviteToken(null);
    setViewingMember(null);
    await refreshMembers(team);
  }

  async function handleInvite() {
    if (!inviteEmail.trim() || !selectedTeam) return;
    setInviting(true);
    setInviteToken(null);
    setActionError(null);
    try {
      const res = await fetch(API.TEAMS_MEMBERS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: selectedTeam.id,
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteToken(data.token);
        setInviteEmail("");
        // Refresh the lists but KEEP the invite panel + one-time token visible.
        await refreshMembers(selectedTeam);
      } else {
        setActionError(
          data.error ||
            "We could not send that invite. Check the address and try again.",
        );
      }
    } catch {
      setActionError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(userId: number) {
    if (!selectedTeam) return;
    setActionError(null);
    try {
      const res = await fetch(API.TEAMS_MEMBERS, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeam.id, userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(
          data.error || "We could not remove that member. Try again.",
        );
        return;
      }
      await openTeam(selectedTeam);
    } catch {
      setActionError(
        "We could not reach the server. Check your connection and try again.",
      );
    }
  }

  async function handleCancelInvite(inviteId: number) {
    if (!selectedTeam) return;
    setActionError(null);
    try {
      const res = await fetch(API.TEAMS_MEMBERS, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeam.id, inviteId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(
          data.error || "We could not cancel that invite. Try again.",
        );
        return;
      }
      await openTeam(selectedTeam);
    } catch {
      setActionError(
        "We could not reach the server. Check your connection and try again.",
      );
    }
  }

  async function handleLeave() {
    if (!selectedTeam) return;
    setActionError(null);
    try {
      const res = await fetch(API.TEAMS_MEMBERS, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeam.id, userId: "self" }),
      });
      if (res.ok) {
        setSelectedTeam(null);
        await fetchTeams();
      } else {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || "We could not remove you from that team.");
      }
    } catch {
      setActionError(
        "We could not reach the server. Check your connection and try again.",
      );
    }
  }

  async function runConfirmation() {
    if (!confirmation) return;
    setConfirmBusy(true);
    try {
      if (confirmation.kind === "deleteTeam") {
        await handleDelete(confirmation.teamId);
      } else if (confirmation.kind === "removeMember") {
        await handleRemoveMember(confirmation.userId);
      } else {
        await handleLeave();
      }
    } finally {
      setConfirmBusy(false);
      setConfirmation(null);
    }
  }

  async function handleRename() {
    if (
      !selectedTeam ||
      !nameInput.trim() ||
      nameInput.trim() === selectedTeam.name
    ) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch(API.TEAMS, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: selectedTeam.id,
          name: nameInput.trim(),
        }),
      });
      if (res.ok) {
        setSelectedTeam({ ...selectedTeam, name: nameInput.trim() });
        await fetchTeams();
      }
    } catch {
      /* */
    } finally {
      setSavingName(false);
      setEditingName(false);
    }
  }

  async function handleViewMemberScans(member: Member) {
    // Guard against a last-response-wins race: clicking member A then quickly
    // member B could land A's response last, showing A's scans under B's name
    // (a privacy-adjacent mislabel). Only the latest request applies its result.
    const reqId = ++memberScansReqRef.current;
    setViewingMember(member);
    setScanPage(1);
    setScansLoading(true);
    try {
      const res = await fetch(
        `${API.TEAMS_MEMBER_SCANS}?teamId=${selectedTeam?.id}&userId=${member.user_id}`,
      );
      if (reqId !== memberScansReqRef.current) return;
      if (res.ok) {
        const data = await res.json();
        setMemberScans(data.scans || []);
      }
    } catch {
      /* */
    } finally {
      if (reqId === memberScansReqRef.current) setScansLoading(false);
    }
  }

  async function copyInviteLink() {
    if (!inviteToken) return;
    const success = await copyToClipboard(
      `${window.location.origin}/teams/join?token=${inviteToken}`,
    );
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (loading) {
    return <TeamsSkeleton />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-6">
        {actionError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <AlertTriangle
              className="h-4 w-4 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <span className="flex-1">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs font-medium underline underline-offset-4 opacity-80 hover:opacity-100 rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              Dismiss
            </button>
          </div>
        )}
        {selectedTeam ? (
          <div className="flex flex-col gap-6">
            <TeamDetailHeader
              team={selectedTeam}
              currentRole={currentRole}
              memberCount={members.length}
              editingName={editingName}
              nameInput={nameInput}
              savingName={savingName}
              onBack={() => setSelectedTeam(null)}
              onEditName={() => {
                setNameInput(selectedTeam.name);
                setEditingName(true);
              }}
              onNameInputChange={setNameInput}
              onSaveName={handleRename}
              onCancelEdit={() => setEditingName(false)}
              onToggleInvite={() => {
                setShowInvite(!showInvite);
                setInviteToken(null);
              }}
              onDelete={() =>
                setConfirmation({
                  kind: "deleteTeam",
                  teamId: selectedTeam.id,
                  teamName: selectedTeam.name,
                })
              }
              onLeave={() =>
                setConfirmation({
                  kind: "leaveTeam",
                  teamName: selectedTeam.name,
                })
              }
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
                onClose={() => {
                  setShowInvite(false);
                  setInviteToken(null);
                }}
              />
            )}

            <TeamMembersList
              members={members}
              invites={invites}
              loading={membersLoading}
              currentRole={currentRole}
              onViewScans={handleViewMemberScans}
              onRemoveMember={(userId) => {
                const m = members.find((x) => x.user_id === userId);
                setConfirmation({
                  kind: "removeMember",
                  userId,
                  label: m?.name || m?.email || "this member",
                });
              }}
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
            onCancelCreate={() => {
              setShowCreate(false);
              setNewName("");
            }}
            creating={creating}
          />
        )}
      </main>

      {/* Destructive actions confirm against the thing they will destroy. */}
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !confirmBusy) setConfirmation(null);
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className="h-5 w-5 text-destructive shrink-0"
                aria-hidden="true"
              />
              {confirmation?.kind === "deleteTeam" && "Delete this team?"}
              {confirmation?.kind === "removeMember" && "Remove this person?"}
              {confirmation?.kind === "leaveTeam" && "Leave this team?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              {confirmation?.kind === "deleteTeam" && (
                <>
                  <span className="font-medium text-foreground">
                    {confirmation.teamName}
                  </span>{" "}
                  and its member list are deleted. Everyone loses access to the
                  team&apos;s shared reports. This cannot be undone.
                </>
              )}
              {confirmation?.kind === "removeMember" && (
                <>
                  <span className="font-medium text-foreground">
                    {confirmation.label}
                  </span>{" "}
                  loses access to this team&apos;s reports right away. Their own
                  scan history is untouched, and you can invite them back later.
                </>
              )}
              {confirmation?.kind === "leaveTeam" && (
                <>
                  You lose access to reports shared in{" "}
                  <span className="font-medium text-foreground">
                    {confirmation.teamName}
                  </span>
                  . An owner or admin has to invite you back.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmation(null)}
              disabled={confirmBusy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={runConfirmation}
              disabled={confirmBusy}
              className="gap-2"
            >
              {confirmBusy && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {confirmation?.kind === "deleteTeam" && "Delete team"}
              {confirmation?.kind === "removeMember" && "Remove"}
              {confirmation?.kind === "leaveTeam" && "Leave"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Footer />
    </div>
  );
}
