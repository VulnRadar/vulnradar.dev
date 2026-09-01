import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  DocsTable,
  EndpointTable,
  CodeBlock,
  InlineCode,
} from "@/components/docs";
import { APP_NAME } from "@/lib/config/constants";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "creating", label: "Creating a Team" },
  { id: "plan-limits", label: "Plan Limits" },
  { id: "roles", label: "Roles and Permissions" },
  { id: "role-ceiling", label: "Role ceiling", level: 2 },
  { id: "invitations", label: "Invitations" },
  { id: "accepting", label: "Accepting an Invite", level: 2 },
  { id: "sharing", label: "Sharing Scans" },
  { id: "team-resources", label: "Webhooks and Domains" },
  { id: "endpoints", label: "API Endpoints" },
];

export default function TeamsPage() {
  return (
    <div className="space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
        badge="Collaboration"
        title="Teams"
        description={`A team lets several ${APP_NAME} accounts share scan reports and the resources attached to them. One account owns the team, everyone else joins by invitation, and a per-member team role decides what each person can do.`}
        stats={[
          { value: "6", label: "Distinct team roles" },
          { value: "1-3", label: "Teams owned (Pro / Elite)" },
          { value: "3-10", label: "Seats per team (Pro / Elite)" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A team is a group of accounts that can see each other&apos;s scans
          once those scans are shared into the team. Exactly one account is the{" "}
          <strong className="text-foreground">owner</strong> (set at creation,
          never handed out by invite), and every other member joins through an
          emailed or in-app invitation. Membership attaches to an account, not
          an email address alone, so accepting an invite requires being signed
          in as the account the invite was sent to.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The whole feature is gated behind the{" "}
          <InlineCode>FEATURE_TEAMS</InlineCode> flag. When it is off, the
          create endpoint returns 403 and no team routes do anything useful.
        </p>
        <DocsCallout variant="info" title="Team roles are not staff roles">
          A member&apos;s team role (owner, admin, manager, operator, member,
          viewer) is completely separate from their account-level staff role (
          <InlineCode>user</InlineCode>, <InlineCode>support</InlineCode>,{" "}
          <InlineCode>moderator</InlineCode>, <InlineCode>admin</InlineCode>,{" "}
          <InlineCode>super_admin</InlineCode>, and the specialist tiers) that
          governs the <InlineCode>/admin</InlineCode> panel. The members list
          surfaces a person&apos;s staff role as a badge, but it grants no team
          capability: being a site admin does not make you a team admin, and
          vice versa.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="creating" title="Creating a Team">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          <InlineCode>POST /api/v3/teams</InlineCode> with a{" "}
          <InlineCode>name</InlineCode> (2 to{" "}
          <InlineCode>MAX_TEAM_NAME_LENGTH</InlineCode>, 255 by default). The
          creator is inserted as the sole <InlineCode>owner</InlineCode> in the
          same transaction, and a URL slug is generated from the name plus a
          short timestamp suffix.
        </p>
        <CodeBlock
          language="json"
          code={`// POST /api/v3/teams
{ "name": "Platform Security" }

// 200
{
  "team": {
    "id": 42,
    "name": "Platform Security",
    "slug": "platform-security-lq9f3k",
    "role": "owner",
    "member_count": 1,
    "created_at": "2026-08-24T15:30:00.000Z"
  }
}`}
        />
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Rename:</strong>{" "}
            <InlineCode>PATCH /api/v3/teams</InlineCode> with{" "}
            <InlineCode>{`{ teamId, name }`}</InlineCode>. Requires the{" "}
            <InlineCode>manage_team</InlineCode> permission (owner, admin,
            manager, operator).
          </li>
          <li>
            <strong className="text-foreground">Delete:</strong>{" "}
            <InlineCode>DELETE /api/v3/teams</InlineCode> with{" "}
            <InlineCode>{`{ teamId }`}</InlineCode>. Owner-only (
            <InlineCode>delete_team</InlineCode>). The delete cascades to{" "}
            <InlineCode>team_members</InlineCode> and{" "}
            <InlineCode>team_invites</InlineCode> in one statement, so there is
            no half-deleted state.
          </li>
          <li>
            <strong className="text-foreground">First-run invites:</strong> the
            create dialog can pre-invite people as it makes the team. It caps
            the number of rows at the owner&apos;s seat limit minus one (their
            own seat), clamped to 10, and sends each invite as a separate call
            so the team is still created if one address fails.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="plan-limits" title="Plan Limits">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Two independent caps apply, and both are read from the{" "}
          <strong className="text-foreground">owner&apos;s</strong> plan, not
          the plan of whoever is doing the inviting: how many teams an account
          may own, and how many seats a team may hold. A seat is one member{" "}
          <em>plus</em> one pending, unexpired invite, so outstanding invites
          count against the cap until they are accepted, declined, or expire.
        </p>
        <DocsTable
          caption="Team ownership and seat limits per plan"
          columns={[
            { key: "plan", header: "Plan" },
            { key: "teams", header: "Teams owned" },
            { key: "seats", header: "Seats per team" },
          ]}
          data={[
            { plan: "Free", teams: "0", seats: "0" },
            { plan: "Core Supporter", teams: "0", seats: "0" },
            { plan: "Pro Supporter", teams: "1", seats: "3" },
            { plan: "Elite Supporter", teams: "3", seats: "10" },
          ]}
        />
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            Teams are a Pro Supporter and above feature. Free and Core Supporter
            both resolve to 0 teams and 0 seats, so the create endpoint returns
            a plan-limit error for them.
          </li>
          <li>
            <InlineCode>0</InlineCode> means the plan cannot use teams at all;{" "}
            <InlineCode>-1</InlineCode> means unlimited. With billing disabled
            entirely (a self-hosted deployment), both caps are treated as
            unlimited.
          </li>
          <li>
            The enforced numbers live in the admin Billing settings (resolved
            through <InlineCode>lib/billing/plan-limits.ts</InlineCode>), so an
            admin can retune them without a deploy. The values above are the
            shipped defaults, which also drive the pricing-page copy in{" "}
            <InlineCode>lib/billing/catalog.ts</InlineCode>.
          </li>
          <li>
            Staff accounts are treated as the Pro Supporter plan here, not as
            unlimited.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="roles" title="Roles and Permissions">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          There are six team roles. They are built from four underlying
          capabilities: <InlineCode>manage_team</InlineCode> (rename the team),{" "}
          <InlineCode>manage_members</InlineCode> (invite, remove, change
          roles), <InlineCode>manage_scans</InlineCode> (create and edit
          team-scoped scans), and <InlineCode>view_reports</InlineCode> (read
          shared reports), plus the owner-only{" "}
          <InlineCode>delete_team</InlineCode>. Every role holds{" "}
          <InlineCode>view_reports</InlineCode>.
        </p>
        <DocsTable
          caption="Team role capability matrix, from TEAM_ROLE_PERMISSIONS in lib/config/constants.ts"
          columns={[
            { key: "role", header: "Role" },
            { key: "manageTeam", header: "Rename team" },
            { key: "manageMembers", header: "Manage members" },
            { key: "manageScans", header: "Run/edit team scans" },
            { key: "viewReports", header: "View reports" },
            { key: "deleteTeam", header: "Delete team" },
          ]}
          data={[
            {
              role: "owner",
              manageTeam: "Yes",
              manageMembers: "Yes",
              manageScans: "Yes",
              viewReports: "Yes",
              deleteTeam: "Yes",
            },
            {
              role: "admin",
              manageTeam: "Yes",
              manageMembers: "Yes",
              manageScans: "Yes",
              viewReports: "Yes",
              deleteTeam: "No",
            },
            {
              role: "manager",
              manageTeam: "Yes",
              manageMembers: "Yes",
              manageScans: "No",
              viewReports: "Yes",
              deleteTeam: "No",
            },
            {
              role: "operator",
              manageTeam: "Yes",
              manageMembers: "No",
              manageScans: "Yes",
              viewReports: "Yes",
              deleteTeam: "No",
            },
            {
              role: "member",
              manageTeam: "No",
              manageMembers: "No",
              manageScans: "Yes",
              viewReports: "Yes",
              deleteTeam: "No",
            },
            {
              role: "viewer",
              manageTeam: "No",
              manageMembers: "No",
              manageScans: "No",
              viewReports: "Yes",
              deleteTeam: "No",
            },
          ]}
        />
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Manager and operator are deliberate opposites: a manager handles
          people and settings but does not run scans, while an operator runs
          scans and adjusts settings but does not handle onboarding. That is why
          the roles are not a single ladder.
        </p>

        <DocsSubSection id="role-ceiling" title="Role ceiling">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Because the roles are a partial order rather than a strict ranking,
            a caller may only invite, promote, demote, or remove someone at a
            role whose permission set is a{" "}
            <strong className="text-foreground">subset</strong> of the
            caller&apos;s own (the <InlineCode>canAssignTeamRole</InlineCode>{" "}
            check). Without it, a manager (who has{" "}
            <InlineCode>manage_members</InlineCode> but not{" "}
            <InlineCode>manage_scans</InlineCode>) could promote someone to
            admin and hand out a capability the manager itself lacks, or evict a
            higher-privileged admin. The owner holds every permission, so the
            owner can act on any role; the owner&apos;s own role can never be
            changed or removed through the member routes.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="invitations" title="Invitations">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          <InlineCode>POST /api/v3/teams/members</InlineCode> with{" "}
          <InlineCode>{`{ teamId, email, role }`}</InlineCode> sends an invite.{" "}
          <InlineCode>role</InlineCode> defaults to{" "}
          <InlineCode>viewer</InlineCode> and may be any role except owner. The
          caller needs <InlineCode>manage_members</InlineCode>, the role ceiling
          applies, and the request is rate-limited per user to stop invite spam
          from a compromised account.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            The invite is rejected if the address is already a member, if an
            unexpired invite is already pending for it, or if adding a seat
            would exceed the owner&apos;s plan cap.
          </li>
          <li>
            A 32-byte random token is generated. Only its SHA-256 hash is
            stored; the plaintext token appears only in the invite link,{" "}
            <InlineCode>/teams/join?token=...</InlineCode>, and in the one-time
            copy field shown in the UI right after sending (the only delivery
            path on a self-host with no SMTP).
          </li>
          <li>
            Delivery is by email, and if the invited address already belongs to
            an account, an in-app bell notification is created too. Invites
            expire after <InlineCode>TEAM_INVITE_EXPIRY_DAYS</InlineCode> (7 by
            default).
          </li>
          <li>
            <strong className="text-foreground">Manage members:</strong>{" "}
            <InlineCode>PATCH /api/v3/teams/members</InlineCode> changes a role
            (you cannot change your own),{" "}
            <InlineCode>DELETE /api/v3/teams/members</InlineCode> removes a
            member (by <InlineCode>userId</InlineCode>) or cancels a pending
            invite (by <InlineCode>inviteId</InlineCode>). A non-owner removing
            their own <InlineCode>userId</InlineCode> leaves the team; the owner
            cannot leave and must transfer or delete instead.
          </li>
        </ul>

        <DocsSubSection id="accepting" title="Accepting an invite">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Both accept paths go through{" "}
            <InlineCode>POST /api/v3/teams/accept-invite</InlineCode> and both
            require a signed-in session:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Emailed link:</strong> the{" "}
              <InlineCode>/teams/join</InlineCode> page reads the plaintext{" "}
              <InlineCode>token</InlineCode> from the URL and posts{" "}
              <InlineCode>{`{ token }`}</InlineCode>. If the visitor is not
              logged in, it sends them to sign in and back.
            </li>
            <li>
              <strong className="text-foreground">In-app:</strong> the
              notification bell and the invitations panel on{" "}
              <InlineCode>/teams</InlineCode> post{" "}
              <InlineCode>{`{ inviteId }`}</InlineCode> instead, since the
              plaintext token is never persisted.
            </li>
          </ul>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Either way, the accept enforces that the signed-in account&apos;s
            email matches the invite&apos;s email (a 403 otherwise, so a guessed{" "}
            <InlineCode>inviteId</InlineCode> is useless), that the invite has
            not expired (400), and that you are not already a member (400). List
            your own pending invites with{" "}
            <InlineCode>GET /api/v3/teams/invitations</InlineCode>, and decline
            one with <InlineCode>DELETE /api/v3/teams/invitations</InlineCode>{" "}
            (scoped to your own email).
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="sharing" title="Sharing Scans">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          A scan is personal by default: its <InlineCode>team_id</InlineCode> is
          null and only its owner can see it, even between teammates. To share
          it, the owner assigns it to a team with{" "}
          <InlineCode>PATCH /api/v3/history/{`{id}`}</InlineCode> and a{" "}
          <InlineCode>teamId</InlineCode> in the body. Only the scan&apos;s own
          owner may change that assignment, and only to a team where they hold{" "}
          <InlineCode>manage_scans</InlineCode>.
        </p>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Once a scan carries a <InlineCode>team_id</InlineCode>, access follows
          one shared rule (<InlineCode>getTeamResourceAccess</InlineCode>):
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            Any co-member with <InlineCode>view_reports</InlineCode> (all six
            roles) can read it.
          </li>
          <li>
            Co-members with <InlineCode>manage_scans</InlineCode> (owner, admin,
            operator, member) can also edit its notes and visibility. Managers
            and viewers are read-only on shared scans.
          </li>
          <li>
            Personal scans (<InlineCode>team_id</InlineCode> null) stay
            owner-only regardless of shared team membership.
          </li>
          <li>
            <strong className="text-foreground">Super-admin exception:</strong>{" "}
            if a shared resource&apos;s owner is a super-admin, team roles grant
            read but never write, so team sharing can never become a side
            channel for editing a super-admin&apos;s own data.
          </li>
        </ul>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          <InlineCode>
            GET /api/v3/teams/member-scans?teamId=&amp;userId=
          </InlineCode>{" "}
          returns a member&apos;s scans assigned to{" "}
          <strong className="text-foreground">that team only</strong> (most
          recent 50), never their personal scans. Both the requester and the
          target must be members of the team.{" "}
          <InlineCode>GET /api/v3/teams/teammates</InlineCode> returns everyone
          you share any team with, deduped across your teams, and is what
          populates the assignee picker when you hand a remediation item to a
          teammate.
        </p>
      </DocsSection>

      <DocsSection id="team-resources" title="Webhooks and Domains">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Scans are not the only thing a team shares. Webhooks and verified
          domains can each carry a <InlineCode>team_id</InlineCode> too, and
          they use the same <InlineCode>getTeamResourceAccess</InlineCode> rule:
          a team-scoped webhook or domain is visible to every co-member and
          writable by those with <InlineCode>manage_scans</InlineCode>. The list
          endpoints for both (<InlineCode>GET /api/v3/webhooks</InlineCode> and{" "}
          <InlineCode>GET /api/v3/domains</InlineCode>) union your own rows with
          any row whose team you belong to, so shared and personal resources
          come back together.
        </p>
      </DocsSection>

      <DocsSection id="endpoints" title="API Endpoints">
        <p className="text-sm text-muted-foreground">
          Every team route is session-authenticated. Bearer API keys are not
          accepted: you must be a logged-in user, the same rule the webhooks API
          uses.
        </p>
        <EndpointTable
          caption="Team API endpoints"
          endpoints={[
            {
              method: "GET",
              endpoint: "/api/v3/teams",
              description:
                "List your teams, with your plan's team and seat caps.",
            },
            {
              method: "POST",
              endpoint: "/api/v3/teams",
              description: "Create a team. You become its owner.",
            },
            {
              method: "PATCH",
              endpoint: "/api/v3/teams",
              description: "Rename a team (needs manage_team).",
            },
            {
              method: "DELETE",
              endpoint: "/api/v3/teams",
              description: "Delete a team (owner only).",
            },
            {
              method: "GET",
              endpoint: "/api/v3/teams/members?teamId=",
              description: "Members, pending invites, and your own role.",
            },
            {
              method: "POST",
              endpoint: "/api/v3/teams/members",
              description: "Invite a member by email (needs manage_members).",
            },
            {
              method: "PATCH",
              endpoint: "/api/v3/teams/members",
              description: "Change a member's role (needs manage_members).",
            },
            {
              method: "DELETE",
              endpoint: "/api/v3/teams/members",
              description:
                "Remove a member, cancel an invite, or leave the team.",
            },
            {
              method: "GET",
              endpoint: "/api/v3/teams/invitations",
              description: "Your own pending invitations.",
            },
            {
              method: "DELETE",
              endpoint: "/api/v3/teams/invitations",
              description: "Decline one of your pending invitations.",
            },
            {
              method: "POST",
              endpoint: "/api/v3/teams/accept-invite",
              description: "Accept an invite by token or by inviteId.",
            },
            {
              method: "GET",
              endpoint: "/api/v3/teams/teammates",
              description: "Everyone you share a team with, deduped.",
            },
            {
              method: "GET",
              endpoint: "/api/v3/teams/member-scans?teamId=&userId=",
              description: "A member's scans assigned to that team.",
            },
          ]}
        />
      </DocsSection>
    </div>
  );
}
