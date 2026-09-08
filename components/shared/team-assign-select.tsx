"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import type { TeamOption } from "@/lib/hooks/use-assignable-teams";

interface TeamAssignSelectProps {
  /** Teams the caller may assign to. See useAssignableTeams: this is the
   *  client-side mirror of getAssignableTeamIds, so every option here is one
   *  the PATCH will accept. */
  teams: TeamOption[];
  /** The team the resource sits on now, or null when it is personal. */
  value: number | null;
  onChange: (teamId: number | null) => void;
  /** The control's accessible name. There is one of these per row, so it has
   *  to name the row too: "Team for Discord Alerts", not "Team". */
  label: string;
  /** The assigned team's name when it is not one of `teams` (the caller was
   *  demoted, or only ever had read access to it). Without it the select would
   *  fall back to its first option and report a shared resource as personal. */
  currentTeamName?: string | null;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Which team a webhook, schedule or verified domain is shared with.
 *
 * One control for all three because all three enforce the same two rules:
 * only the resource's creator may change the team, and the team has to be one
 * the caller's role can manage. The empty option is not a placeholder, it is
 * the unassign action: every one of the three PATCH routes takes teamId null
 * to move a resource back to personal.
 *
 * Renders nothing when there is neither a team to offer nor an assignment to
 * clear, so an account with no teams gets no empty dropdown.
 */
export function TeamAssignSelect({
  teams,
  value,
  onChange,
  label,
  currentTeamName,
  busy = false,
  disabled = false,
  className,
}: TeamAssignSelectProps) {
  const currentIsAssignable =
    value !== null && teams.some((team) => team.id === value);
  if (teams.length === 0 && value === null) return null;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <select
        aria-label={label}
        value={value === null ? "" : String(value)}
        disabled={disabled || busy}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
        className="h-11 sm:h-8 max-w-[11rem] rounded-md border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">Not assigned to a team</option>
        {/* Still listed when the caller can no longer assign to it, so the row
            tells the truth about where the resource actually is. Picking it
            again is the no-op it looks like; moving away from it is allowed,
            since unassigning skips the assignable check server-side. */}
        {!currentIsAssignable && value !== null && (
          <option value={String(value)}>
            {currentTeamName ?? "Its current team"}
          </option>
        )}
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      {busy && (
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      )}
    </span>
  );
}
