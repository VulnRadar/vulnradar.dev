"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { PowerOff } from "lucide-react";

import { tourAnchor } from "@/lib/tour/anchors";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { useClientConfig } from "@/lib/hooks/use-client-config";
import { usePagination } from "@/components/ui/pagination-control";
import { API, TEAM_ROLES } from "@/lib/config/client-constants";
import {
  type Team,
  type Member,
  type Invite,
  type MemberScan,
  type TeamInvitation,
  type NewTeamInvite,
  TeamsList,
  TeamCreateDialog,
  TeamInvitations,
  TeamDetailHeader,
  TeamInviteForm,
  TeamMembersList,
  TeamMemberScans,
  TeamsDataSkeleton,
} from "@/components/teams";
import { copyToClipboard } from "@/lib/ui/clipboard";
import { useQueryParam } from "@/lib/ui/url-state";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
// The members list needs to know which row is you, so it can hide the
// "Change role" submenu on your own membership: a team owner demoting
// themselves would leave the team with nobody who can promote anyone back.
import { useAuth } from "@/components/providers/auth-provider";

/** A destructive action awaiting confirmation, carrying what it will act on. */
type Confirmation =
  | { kind: "deleteTeam"; teamId: number; teamName: string }
  | { kind: "removeMember"; userId: number; label: string }
  | { kind: "leaveTeam"; teamName: string };

const CONFIRM_COPY: Record<
  Confirmation["kind"],
  { title: string; confirmLabel: string }
> = {
  deleteTeam: { title: "Delete this team?", confirmLabel: "Delete team" },
  removeMember: { title: "Remove this person?", confirmLabel: "Remove" },
  leaveTeam: { title: "Leave this team?", confirmLabel: "Leave" },
};

function confirmDescription(confirmation: Confirmation): React.ReactNode {
  switch (confirmation.kind) {
    case "deleteTeam":
      return (
        <>
          <span className="font-medium text-foreground">
            {confirmation.teamName}
          </span>{" "}
          and its member list are deleted. Everyone loses access to the
          team&apos;s shared reports. This cannot be undone.
        </>
      );
    case "removeMember":
      return (
        <>
          <span className="font-medium text-foreground">
            {confirmation.label}
          </span>{" "}
          loses access to this team&apos;s reports right away. Their own scan
          history is untouched, and you can invite them back later.
        </>
      );
    case "leaveTeam":
      return (
        <>
          You lose access to reports shared in{" "}
          <span className="font-medium text-foreground">
            {confirmation.teamName}
          </span>
          . An owner or admin has to invite you back.
        </>
      );
  }
}

export default function TeamsPage() {
  const router = useRouter();
  const { me } = useAuth();
  const { featureTeams, loaded } = useClientConfig();

  // List view state
  const [teams, setTeams] = useState<Team[]>([]);
  const [limits, setLimits] = useState<{
    teams: number;
    teamMembers: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  // A failed teams request used to leave an empty list behind, which renders
  // identically to genuinely having no teams. Kept separate from actionError
  // (which is dismissable and belongs to a user-initiated action) because a
  // load failure is a standing fact about the page, not a one-off event.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Invitations addressed to the current user (accept/decline in-app).
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [inviteBusyId, setInviteBusyId] = useState<number | null>(null);

  // Detail view state.
  //
  // The open team is mirrored into ?team=<id>, the same way app/repos/page.tsx
  // backs its own selection with ?repo. Opening a team used to mutate state in
  // place with no history entry, so browser Back navigated off /teams entirely
  // instead of returning to the team list, and "the acme team page" could not
  // be linked or bookmarked: the only shareable URL was /teams itself.
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [teamParam, setTeamParam] = useQueryParam<string>("team", "");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [currentRole, setCurrentRole] = useState("");
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

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
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Member scans state
  const [viewingMember, setViewingMember] = useState<Member | null>(null);
  const [memberScans, setMemberScans] = useState<MemberScan[]>([]);
  const [scansLoading, setScansLoading] = useState(false);
  const [scansError, setScansError] = useState<string | null>(null);
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
        // Only an actual auth failure means "you are signed out". A 500 or a
        // gateway error used to bounce a perfectly good session to the login
        // screen, which reads as having been logged out. Matches the gating on
        // app/history/page.tsx and app/assets/page.tsx.
        if (res.status === 401 || res.status === 403) {
          router.push("/login");
          return;
        }
        setLoadError(
          "Your teams could not be loaded. You are still signed in, so this is a problem on our side.",
        );
        return;
      }
      const data = await res.json();
      setTeams(data.teams || []);
      setLimits(data.limits ?? null);
      setLoadError(null);
    } catch {
      setLoadError(
        "Could not reach the server to load your teams. Check your connection and try again.",
      );
    }
  }, [router]);

  const fetchInvitations = useCallback(async () => {
    try {
      const res = await fetch(API.TEAMS_INVITATIONS);
      if (res.ok) {
        const data = await res.json();
        setInvitations(data.invitations || []);
      }
    } catch {
      /* */
    }
  }, []);

  /**
   * Both feeders of the one region this page has, revealed together.
   *
   * TeamInvitations renders null with nothing to show, so it used to appear
   * out of nowhere at the top of the list a beat after the list itself and
   * push every team down by the height of a panel. The two requests still go
   * out at the same moment; only the swap out of the skeleton waits for both.
   *
   * allSettled, not all: a failing /teams/invitations must not be able to
   * leave this page in its skeleton with no way out.
   */
  const loadTeamsPage = useCallback(async () => {
    await Promise.allSettled([fetchTeams(), fetchInvitations()]);
    setLoading(false);
  }, [fetchTeams, fetchInvitations]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the requests settle, not synchronously in this effect
    loadTeamsPage();
  }, [loadTeamsPage]);

  // Resolves ?team=<id> against the loaded list. This is what makes a deep
  // link work (the param is read before `teams` has arrived, so it has to be
  // resolved again once it has) and what makes browser Back return to the team
  // list instead of leaving /teams: Back restores the previous ?team value and
  // this opens or closes the detail view to match.
  useEffect(() => {
    if (loading) return;
    if (!teamParam) {
      if (selectedTeam) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- follows a browser history change (an external system), and the `if (selectedTeam)` guard makes it a no-op on the very next render
        setSelectedTeam(null);
        setViewingMember(null);
      }
      return;
    }
    if (selectedTeam && String(selectedTeam.id) === teamParam) return;
    const match = teams.find((t) => String(t.id) === teamParam);
    if (match) applyTeamSelection(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyTeamSelection is redeclared every render; including it would re-run this on every render
  }, [teamParam, teams, loading, selectedTeam]);

  async function handleCreateTeam(name: string, invites: NewTeamInvite[]) {
    setCreating(true);
    setActionError(null);
    try {
      const res = await fetch(API.TEAMS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(
          data.error || "We could not create that team. Try again.",
        );
        return;
      }

      // Send the first-run invites one at a time so the team still gets
      // created and the user learns exactly which addresses didn't go through
      // (already a member, over the plan's seat cap, etc.).
      const teamId = data.team?.id;
      const failed: string[] = [];
      if (teamId) {
        for (const inv of invites) {
          try {
            const ir = await fetch(API.TEAMS_MEMBERS, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                teamId,
                email: inv.email,
                role: inv.role,
              }),
            });
            if (!ir.ok) {
              const idata = await ir.json().catch(() => ({}));
              failed.push(
                `${inv.email}: ${idata.error || "the server rejected it"}`,
              );
            }
          } catch {
            failed.push(`${inv.email}: could not reach the server`);
          }
        }
      }

      await fetchTeams();
      setShowCreate(false);
      if (failed.length > 0) {
        setActionError(
          `Team created. These invites did not send: ${failed.join("; ")}. Invite them again from the team page.`,
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

  async function handleAcceptInvite(inviteId: number) {
    setInviteBusyId(inviteId);
    setActionError(null);
    try {
      const res = await fetch(API.TEAMS_ACCEPT_INVITE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || "We could not accept that invite.");
        return;
      }
      await Promise.all([fetchTeams(), fetchInvitations()]);
    } catch {
      setActionError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setInviteBusyId(null);
    }
  }

  async function handleDeclineInvite(inviteId: number) {
    setInviteBusyId(inviteId);
    setActionError(null);
    try {
      const res = await fetch(API.TEAMS_INVITATIONS, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || "We could not decline that invite.");
        return;
      }
      await fetchInvitations();
    } catch {
      setActionError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setInviteBusyId(null);
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
      closeTeam();
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
    setMembersError(null);
    try {
      const res = await fetch(`${API.TEAMS_MEMBERS}?teamId=${team.id}`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
        setInvites(data.invites || []);
        setCurrentRole(data.currentRole || "viewer");
        setMembersError(null);
        return;
      }
      // Nothing is assigned on failure: members stays whatever it was, which
      // on first open is []. A team always contains at least its owner, so
      // "Members 0" over a blank list is a state real data cannot produce, and
      // an empty currentRole silently strips every management control from the
      // owner. Say the load failed instead of rendering a lie.
      setMembersError(
        "This team's members could not be loaded. Nothing has changed. Reopen the team to try again.",
      );
    } catch {
      setMembersError(
        "Could not reach the server to load this team's members. Nothing has changed. Check your connection and reopen the team.",
      );
    } finally {
      setMembersLoading(false);
    }
  }

  /** Opens a team without writing to the URL. Used by the ?team= resolver
   *  below, which must not push another history entry for the entry that just
   *  brought it here (setQueryParam always pushes, it does not dedupe). */
  async function applyTeamSelection(team: Team) {
    setSelectedTeam(team);
    setShowInvite(false);
    setInviteToken(null);
    setViewingMember(null);
    await refreshMembers(team);
  }

  async function openTeam(team: Team) {
    setTeamParam(String(team.id));
    await applyTeamSelection(team);
  }

  function closeTeam() {
    setSelectedTeam(null);
    setTeamParam(null);
    setViewingMember(null);
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

  // The role change the "Change role" submenu in TeamMembersList fires. That
  // submenu already filters the offered roles through canAssignTeamRole in
  // both directions (the caller may not appoint a role it does not hold, and
  // may not act on a member who already holds one); PATCH /teams/members
  // enforces the same ceiling server-side, so a hand-built request gains
  // nothing. Not a destructive action, so unlike handleRemoveMember it does
  // not route through the confirmation dialog.
  async function handleChangeRole(userId: number, role: string) {
    if (!selectedTeam) return;
    setActionError(null);
    try {
      const res = await fetch(API.TEAMS_MEMBERS, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeam.id, userId, role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(
          data.error || "We could not change that role. Try again.",
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
        closeTeam();
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

  /** The picture changed. TeamAvatarPicker already did the PATCH, so this only
   *  has to apply the new URL to both copies of the team: the open detail view
   *  and the row behind it in the list, which would otherwise keep showing the
   *  old picture until the next full load. */
  function handleAvatarChange(avatarUrl: string | null) {
    setActionError(null);
    setSelectedTeam((prev) =>
      prev ? { ...prev, avatar_url: avatarUrl } : prev,
    );
    setTeams((prev) =>
      prev.map((t) =>
        t.id === selectedTeam?.id ? { ...t, avatar_url: avatarUrl } : t,
      ),
    );
  }

  async function handleViewMemberScans(member: Member) {
    // Guard against a last-response-wins race: clicking member A then quickly
    // member B could land A's response last, showing A's scans under B's name
    // (a privacy-adjacent mislabel). Only the latest request applies its result.
    const reqId = ++memberScansReqRef.current;
    setViewingMember(member);
    // The ticket above guarded response ordering but not the error path:
    // memberScans was only ever assigned inside the res.ok branch and never
    // cleared, so a failed load for member B left member A's scanned URLs on
    // screen under B's name. Clear first, and say so when the load fails.
    setMemberScans([]);
    setScansError(null);
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
      } else {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setScansError(
          body?.error ||
            "This member's scans could not be loaded. That is a problem on our side, not an empty history.",
        );
      }
    } catch {
      if (reqId !== memberScansReqRef.current) return;
      setScansError(
        "Could not reach the server, so this member's scans were not loaded.",
      );
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

  // How many people the create dialog lets you invite up front: the owner's
  // plan seat cap minus the owner's own seat, clamped to a sane UI maximum.
  // No limits (billing off) or the plan's -1 "unlimited" both fall back to the
  // clamp; a plan with no team seats yields 0 (name-only creation).
  const maxInvites =
    !limits || limits.teamMembers < 0
      ? 10
      : Math.min(10, Math.max(0, limits.teamMembers - 1));

  // `loaded` here, unlike the landing entry points: the body already waits
  // behind TeamsDataSkeleton, so gating costs no extra shift and the disabled
  // state never flashes on a deployment that has teams on.
  if (loaded && !featureTeams) {
    return (
      <AppPageShell>
        <EmptyState
          icon={PowerOff}
          title="Teams are turned off"
          description="This deployment runs with the teams feature disabled, so there is nothing to create or join here. Your own scans, history and shared reports are unaffected."
        />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell className="flex flex-col gap-5">
      {/* A load failure is a dead end without a way out of it: this alert
          has no dismiss (the failure is a standing fact, not an event) and
          the list behind it stays empty, so it carries the retry. The team
          picker and the Shared page both already do this. */}
      {loadError && (
        <InlineAlert tone="error">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                fetchTeams();
              }}
              className="shrink-0 font-medium underline underline-offset-2 rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              Try again
            </button>
          </span>
        </InlineAlert>
      )}
      {actionError && (
        <InlineAlert tone="error" onDismiss={() => setActionError(null)}>
          {actionError}
        </InlineAlert>
      )}
      {/* Unlike /history and /shares, nothing here can render early: the page
          title and the New team button belong to TeamsList, and TeamsList with
          an empty array is not a placeholder, it is the "No teams yet" empty
          state making a claim about the account. So the whole body waits, and
          only the shell around it stays mounted. */}
      {loading ? (
        <TeamsDataSkeleton />
      ) : selectedTeam ? (
        <div className="flex flex-col gap-6">
          <TeamDetailHeader
            team={selectedTeam}
            currentRole={currentRole}
            memberCount={members.length}
            editingName={editingName}
            nameInput={nameInput}
            savingName={savingName}
            onBack={closeTeam}
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
            onAvatarChange={handleAvatarChange}
            onAvatarError={setActionError}
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
            loadError={membersError}
            currentRole={currentRole}
            currentUserId={me?.userId}
            onViewScans={handleViewMemberScans}
            onChangeRole={handleChangeRole}
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
              loadError={scansError}
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
        // TeamsList takes a fixed prop list and lives outside this page, so
        // the tour anchor goes on a wrapper. A plain block div in a flex
        // column takes the list's place exactly, gap included.
        <div {...tourAnchor("teamsList")}>
          <TeamsList
            teams={teams}
            searchQuery={searchQuery}
            teamLimit={limits?.teams ?? null}
            // Rendered inside the list rather than above it so the page's h1
            // comes first in the document and stays at the top of the screen
            // when an invitation is waiting.
            invitations={
              <TeamInvitations
                invitations={invitations}
                busyId={inviteBusyId}
                onAccept={handleAcceptInvite}
                onDecline={handleDeclineInvite}
              />
            }
            onSearchChange={setSearchQuery}
            onOpenTeam={openTeam}
            onShowCreate={() => setShowCreate(true)}
          />
        </div>
      )}

      <TeamCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        maxInvites={maxInvites}
        creating={creating}
        onCreate={handleCreateTeam}
      />

      {/* Destructive actions confirm against the thing they will destroy. One
          copy table per action rather than three ternaries inside the dialog,
          the shape profile-developer-tab.tsx's getConfirmCopy already uses. */}
      {confirmation && (
        <ConfirmDialog
          open
          danger
          busy={confirmBusy}
          title={CONFIRM_COPY[confirmation.kind].title}
          description={confirmDescription(confirmation)}
          confirmLabel={CONFIRM_COPY[confirmation.kind].confirmLabel}
          onCancel={() => setConfirmation(null)}
          onConfirm={runConfirmation}
        />
      )}
    </AppPageShell>
  );
}
