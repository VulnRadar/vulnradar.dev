"use client";

import { useId, useState, type ReactNode } from "react";
import { Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  EditDialog,
  type EditSaveOutcome,
} from "@/components/shared/edit-dialog";
import { cn } from "@/lib/ui/utils";
import type { TeamOption } from "@/lib/hooks/use-assignable-teams";

interface TeamAssignSelectProps {
  /** Teams the caller may assign to. See useAssignableTeams: this is the
   *  client-side mirror of getAssignableTeamIds, so every option here is one
   *  the PATCH will accept. */
  teams: TeamOption[];
  /** The team the resource sits on now, or null when it is personal. */
  value: number | null;
  /** Runs when Save is pressed, not when the select moves. Resolve to nothing
   *  (or null) when it worked and the dialog closes; return the server's
   *  message and the dialog stays open with it. */
  onChange: (
    teamId: number | null,
  ) => EditSaveOutcome | Promise<EditSaveOutcome>;
  /** The control's accessible name. There is one of these per row, so it has
   *  to name the row too: "Team for Discord Alerts", not "Team". */
  label: string;
  /** The assigned team's name when it is not one of `teams` (the caller was
   *  demoted, or only ever had read access to it). Without it the select would
   *  fall back to its first option and report a shared resource as personal. */
  currentTeamName?: string | null;
  /** One sentence on what sharing this kind of thing lets a teammate do. */
  description?: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}

/** What the trigger shows for the team a resource sits on now. */
export function teamTriggerText(
  teams: TeamOption[],
  value: number | null,
  currentTeamName?: string | null,
): string {
  if (value === null) return "Not shared";
  return (
    teams.find((team) => team.id === value)?.name ??
    currentTeamName ??
    "Its current team"
  );
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
 * Sharing is not a switch that flips straight back: it changes what other
 * people can do, so it is chosen in a dialog and applied on Save, with the
 * description saying what the teammates get.
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
  description,
  busy = false,
  disabled = false,
  className,
}: TeamAssignSelectProps) {
  // Above the early return: the teams arrive after the first render, and a
  // hook declared below it would change the hook order when they do.
  const [open, setOpen] = useState(false);
  if (teams.length === 0 && value === null) return null;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Button
        type="button"
        variant="outline"
        className="h-11 sm:h-8 max-w-[11rem] gap-1.5 px-2 font-normal"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">{label}: </span>
        <span className="min-w-0 truncate">
          {teamTriggerText(teams, value, currentTeamName)}
        </span>
      </Button>
      {busy && (
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      )}
      {open && (
        <TeamAssignDialog
          teams={teams}
          value={value}
          label={label}
          currentTeamName={currentTeamName}
          description={description}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

export function TeamAssignDialog({
  teams,
  value,
  label,
  currentTeamName,
  description,
  onChange,
  onClose,
}: Pick<
  TeamAssignSelectProps,
  "teams" | "value" | "label" | "currentTeamName" | "description" | "onChange"
> & { onClose: () => void }) {
  const [draft, setDraft] = useState<number | null>(value);
  const selectId = useId();
  const currentIsAssignable =
    value !== null && teams.some((team) => team.id === value);

  return (
    <EditDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Share with a team"
      description={description}
      size="sm"
      saveLabel="Save"
      dirty={draft !== value}
      canSave={draft !== value}
      onSave={() => onChange(draft)}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={selectId}>Team</Label>
        <select
          id={selectId}
          aria-label={label}
          autoFocus
          value={draft === null ? "" : String(draft)}
          onChange={(event) =>
            setDraft(
              event.target.value === "" ? null : Number(event.target.value),
            )
          }
          className="h-11 sm:h-9 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">Not assigned to a team</option>
          {/* Still listed when the caller can no longer assign to it, so the
              dialog tells the truth about where the resource actually is.
              Picking it again is the no-op it looks like; moving away from it
              is allowed, since unassigning skips the assignable check
              server-side. */}
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
      </div>
    </EditDialog>
  );
}
