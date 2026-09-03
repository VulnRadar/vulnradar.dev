"use client";

import { Loader2, Check, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type TeamInvitation } from "./teams-types";
import { RolePill } from "./role-pill";

interface TeamInvitationsProps {
  invitations: TeamInvitation[];
  busyId: number | null;
  onAccept: (id: number) => void;
  onDecline: (id: number) => void;
}

/**
 * Invitations addressed to the current user, shown at the top of the teams
 * list so they can accept or decline without hunting for the email or the
 * bell. Renders nothing when there are none.
 */
export function TeamInvitations({
  invitations,
  busyId,
  onAccept,
  onDecline,
}: TeamInvitationsProps) {
  if (invitations.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-tight">
          Invitations
          <span className="ml-1.5 text-muted-foreground tabular-nums">
            {invitations.length}
          </span>
        </h2>
      </div>

      <div className="overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.03] divide-y divide-border/60">
        {invitations.map((inv) => {
          const busy = busyId === inv.id;
          return (
            <div
              key={inv.id}
              className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {inv.team_name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {inv.invited_by_name
                    ? `${inv.invited_by_name} invited you`
                    : "You were invited"}{" "}
                  to join as <RolePill role={inv.role} size="sm" />
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  onClick={() => onAccept(inv.id)}
                  disabled={busy}
                  className="h-8 gap-1.5"
                >
                  {busy ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDecline(inv.id)}
                  disabled={busy}
                  className="h-8"
                >
                  Decline
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
