"use client";

import { useState } from "react";
import { X, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditDialog } from "@/components/shared/edit-dialog";
import { canAssignTeamRole } from "@/lib/config/client-constants";
import {
  INVITABLE_ROLES,
  ROLE_ABILITIES,
  type InvitableRole,
} from "./teams-types";

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * The roles this viewer may hand out, least privileged first. The team roles
 * are a partial order, so this is the same subset test the invite API makes
 * (canAssignTeamRole), not a rank: the inline form this replaced offered every
 * non-owner role, so a manager picked admin and got a 403 on send.
 */
export function assignableInviteRoles(currentRole: string): InvitableRole[] {
  return INVITABLE_ROLES.filter((r) => canAssignTeamRole(currentRole, r));
}

/** The role a fresh invite starts on: the least privileged one on offer. */
export function defaultInviteRole(
  roles: readonly InvitableRole[],
): InvitableRole {
  return roles[0] ?? "viewer";
}

/** The body POST /api/v3/teams/members takes for an invite. */
export function inviteRequestBody(
  teamId: number,
  email: string,
  role: InvitableRole,
) {
  return { teamId, email: email.trim(), role };
}

export function TeamInviteDialog({
  currentRole,
  onInvite,
  onClose,
}: {
  currentRole: string;
  /** Resolves once the invite went out and throws an Error carrying the reason
   *  when it did not: the dialog shows that message and keeps what was typed. */
  onInvite: (email: string, role: InvitableRole) => Promise<void>;
  onClose: () => void;
}) {
  const roles = assignableInviteRoles(currentRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>(() =>
    defaultInviteRole(roles),
  );
  const canSave = email.trim() !== "" && roles.includes(role);

  return (
    <EditDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Invite someone"
      description="We email them a link. You can also copy it and send it yourself."
      size="sm"
      dirty={email !== "" || role !== defaultInviteRole(roles)}
      canSave={canSave}
      saveLabel="Send invite"
      savingLabel="Sending..."
      onSave={() => onInvite(email.trim(), role)}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">Email address</Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="email"
            placeholder="email@example.com"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Join as</Label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as InvitableRole)}
            aria-describedby="invite-role-hint"
            className="h-10 rounded-md border border-input bg-background px-3 text-base sm:text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <p id="invite-role-hint" className="text-xs text-muted-foreground">
            {ROLE_ABILITIES[role]}
          </p>
        </div>
      </div>
    </EditDialog>
  );
}

/**
 * The copy-once link an invite just produced. It is the only delivery path on a
 * self-host with no mail server, so it outlives the dialog that made it and
 * stays until it is dismissed.
 */
export function TeamInviteLinkCard({
  token,
  email,
  copied,
  onCopy,
  onClose,
}: {
  token: string;
  email: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/teams/join?token=${token}`;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Invite sent to {email}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            This link works once. Copy it if you would rather send it yourself.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss the invite link"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-9"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-muted/50 border border-border/50 rounded-md px-3 py-2 font-mono break-all select-all min-w-0">
          {inviteUrl}
        </code>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 h-9 gap-1.5"
          onClick={onCopy}
        >
          {copied ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
