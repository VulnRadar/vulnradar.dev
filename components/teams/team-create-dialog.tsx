"use client";

import { useState } from "react";
import { Plus, X, Loader2, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INVITABLE_ROLES,
  ROLE_ABILITIES,
  type InvitableRole,
} from "./teams-types";

export interface NewTeamInvite {
  email: string;
  role: InvitableRole;
}

interface TeamCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many people can be invited up front, derived from the owner's plan
   *  seat cap (teamMembers minus the owner's own seat). 0 hides the invite
   *  section entirely. */
  maxInvites: number;
  creating: boolean;
  onCreate: (name: string, invites: NewTeamInvite[]) => void;
}

const DEFAULT_ROLE: InvitableRole = "viewer";

export function TeamCreateDialog({
  open,
  onOpenChange,
  maxInvites,
  creating,
  onCreate,
}: TeamCreateDialogProps) {
  const [name, setName] = useState("");
  const [invites, setInvites] = useState<NewTeamInvite[]>([]);
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset the form each time the dialog transitions to open, so a cancelled
  // attempt doesn't leak into the next one. This is React's "adjust state
  // during render on a prop change" pattern (no effect, no cascading render):
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName("");
      setInvites(maxInvites > 0 ? [{ email: "", role: DEFAULT_ROLE }] : []);
    }
  }

  const canAddMore = invites.length < maxInvites;
  const nameValid = name.trim().length >= 2;

  function updateInvite(i: number, patch: Partial<NewTeamInvite>) {
    setInvites((prev) =>
      prev.map((inv, idx) => (idx === i ? { ...inv, ...patch } : inv)),
    );
  }

  function addInvite() {
    if (canAddMore)
      setInvites((prev) => [...prev, { email: "", role: DEFAULT_ROLE }]);
  }

  function removeInvite(i: number) {
    setInvites((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSubmit() {
    if (!nameValid || creating) return;
    const filled = invites
      .map((inv) => ({ ...inv, email: inv.email.trim() }))
      .filter((inv) => inv.email.length > 0);
    onCreate(name.trim(), filled);
  }

  return (
    <Dialog open={open} onOpenChange={creating ? undefined : onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Create a team</DialogTitle>
          <DialogDescription>
            Name your team, then invite people to it. You can always invite more
            later.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-team-name">Team name</Label>
            <Input
              id="new-team-name"
              placeholder="e.g. Platform Security"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={50}
            />
          </div>

          {maxInvites > 0 && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label>Invite people (optional)</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  up to {maxInvites}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {invites.map((inv, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Input
                      type="email"
                      autoComplete="off"
                      placeholder="teammate@example.com"
                      aria-label={`Invite ${i + 1} email`}
                      value={inv.email}
                      onChange={(e) =>
                        updateInvite(i, { email: e.target.value })
                      }
                      className="flex-1 min-w-0"
                    />
                    <select
                      aria-label={`Invite ${i + 1} role`}
                      value={inv.role}
                      onChange={(e) =>
                        updateInvite(i, {
                          role: e.target.value as InvitableRole,
                        })
                      }
                      className="h-10 shrink-0 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      title={ROLE_ABILITIES[inv.role]}
                    >
                      {INVITABLE_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role.charAt(0).toUpperCase() + role.slice(1)}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove invite ${i + 1}`}
                      onClick={() => removeInvite(i)}
                      className="h-10 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>

              {canAddMore && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addInvite}
                  className="w-fit gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add another
                </Button>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!nameValid || creating}
            className="gap-2"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            )}
            Create team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
