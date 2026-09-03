"use client";

import { Plus, Search, Users, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import {
  ListSearchInput,
  worthFiltering,
} from "@/components/shared/list-filter-bar";
import { plural, pluralize } from "@/lib/ui/plural";
import { cn } from "@/lib/ui/utils";
import { RolePill } from "./role-pill";
import { TeamAvatar } from "./team-avatar";
import { type Team } from "./teams-types";

/** The four-track layout the column header band and every row key off:
 *  the team's 36px picture, its name, your role, the disclosure chevron. */
const GRID = "sm:grid-cols-[2.25rem_minmax(0,1fr)_7rem_1rem]";

interface TeamsListProps {
  teams: Team[];
  searchQuery: string;
  /** Seats per team from the plan, or null when billing is off. -1 means no
   *  cap. Used only to say how many teams the account may still create. */
  teamLimit: number | null;
  /** Pending invitations addressed to the signed-in user. Rendered here,
   *  under the page title, rather than above it: as a sibling above this
   *  component its h2 came before the page's only h1, so the document
   *  started at heading level 2 and the page title was pushed down the
   *  screen whenever an invitation was waiting. */
  invitations?: React.ReactNode;
  onSearchChange: (q: string) => void;
  onOpenTeam: (team: Team) => void;
  onShowCreate: () => void;
}

export function TeamsList({
  teams,
  searchQuery,
  teamLimit,
  invitations,
  onSearchChange,
  onOpenTeam,
  onShowCreate,
}: TeamsListProps) {
  const filtered = teams.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // -1 is the plan catalog's "unlimited" sentinel and null means billing is
  // off, so neither is a number worth printing at someone.
  const showsQuota = teamLimit !== null && teamLimit >= 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
            Teams
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A team shares its scans. Everyone in one can open every report run
            under it, and the role you give someone decides whether they can
            also start scans or invite people.
          </p>
        </div>
        <Button className="shrink-0 gap-1.5" onClick={onShowCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New team
        </Button>
      </div>

      {invitations}

      {/* The search box used to render even with zero teams, so a new account
          was offered a way to filter an empty list. It appears once there is
          enough here to be worth filtering, and that threshold is now the one
          every list in the account uses.
          No dropdown cluster beside it, unlike /history, /repos and /shares: a
          team list has no severity, no verdict and no date, the plan caps it
          at a handful of rows, and the only categorical axis (your role) is
          already a labelled column two lines below. flex-none because this
          sits in a COLUMN, where the search field's default flex-1 would
          stretch it to fill the page. */}
      {worthFiltering(teams.length) && (
        <ListSearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search teams..."
          label="Search teams by name"
          className="flex-none"
        />
      )}

      {filtered.length === 0 && !searchQuery ? (
        <EmptyState
          icon={Users}
          title="No teams yet"
          description="Create one to put your scans somewhere your colleagues can read them. You name it, invite people by email, and pick what each of them is allowed to do."
          action={
            <Button size="sm" onClick={onShowCreate} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Create your first team
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          size="sm"
          title={`No teams match "${searchQuery}"`}
          description="Search matches on the team name only."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSearchChange("")}
              className="bg-transparent"
            >
              Clear search
            </Button>
          }
        />
      ) : (
        /* Still a list of identities rather than a four-column table: the
           member count reads as a sentence in the row ("4 members, yours"),
           not as a bare digit under a MEMBERS header, which is the column that
           was rightly deleted here once. What came back is the header band the
           rest of the account's lists carry, over only the two columns that
           genuinely are columns. Your role is the one that needed it: a pill
           reading "viewer" sat at the end of every row with nothing saying
           whose role it was. */
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div
            className={cn(
              "hidden gap-3 border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:px-5",
              GRID,
            )}
          >
            <span aria-hidden />
            <span>Team</span>
            <span>Your role</span>
            <span aria-hidden />
          </div>
          <ul className="divide-y divide-border">
            {filtered.map((team) => (
              <li key={team.id}>
                <button
                  type="button"
                  onClick={() => onOpenTeam(team)}
                  className={cn(
                    "group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid sm:items-center sm:px-5",
                    GRID,
                  )}
                >
                  {/* The team's own picture when it has one, otherwise the
                      owner's face, otherwise the team's initial. The row used
                      to show the owner unconditionally, which was the only
                      identity available before teams could have a picture of
                      their own; keeping it as the second rung means no row
                      lost its face when this went in. */}
                  <TeamAvatar
                    name={team.name}
                    avatarUrl={team.avatar_url}
                    fallbackSrc={team.owner_avatar_url}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {team.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {/* pluralize() coerces before comparing. member_count is
                          typed number here but arrives as the string "1":
                          GET /api/v3/teams reads it from a COUNT(*), which
                          node-postgres returns as a bigint string, so the old
                          `!== 1` test was true on a one-person team and every
                          row read "1 members". */}
                      {pluralize(team.member_count, "member")}
                      {team.role === "owner"
                        ? ", yours"
                        : `, owned by ${team.owner_name || team.owner_email}`}
                    </p>
                  </div>
                  <RolePill role={team.role} />
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showsQuota && (
        <p className="text-xs text-muted-foreground">
          {teams.length} of {teamLimit} {plural(teamLimit, "team")} on your
          plan.
        </p>
      )}
    </div>
  );
}
