"use client";

import { X, Loader2, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ROLE_ABILITIES } from "./teams-types";
import { TEAM_ROLES } from "@/lib/config/constants";

type InvitableRole = "admin" | "manager" | "operator" | "member" | "viewer";

// Least to most privileged, matching the invite form's intended reading
// order. Derived from TEAM_ROLES (excluding the non-invitable owner) so a
// future role addition shows up here automatically, the same way
// app/api/v3/teams/members/route.ts's INVITABLE_TEAM_ROLES already does.
const INVITABLE_ROLES = Object.values(TEAM_ROLES)
  .filter((r) => r !== TEAM_ROLES.OWNER)
  .reverse() as InvitableRole[];

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

interface TeamInviteFormProps {
  inviteEmail: string;
  inviteRole: InvitableRole;
  inviting: boolean;
  inviteToken: string | null;
  copied: boolean;
  onEmailChange: (v: string) => void;
  onRoleChange: (v: InvitableRole) => void;
  onInvite: () => void;
  onCopy: () => void;
  onClose: () => void;
}

export function TeamInviteForm({
  inviteEmail,
  inviteRole,
  inviting,
  inviteToken,
  copied,
  onEmailChange,
  onRoleChange,
  onInvite,
  onCopy,
  onClose,
}: TeamInviteFormProps) {
  const inviteUrl = inviteToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/teams/join?token=${inviteToken}`
    : "";

  return (
    <Card className="bg-card border-border/50">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Invite someone</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              We email them a link. You can also copy it and send it yourself.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the invite form"
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="email"
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={(e) => onEmailChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onInvite()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Join as</Label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => onRoleChange(e.target.value as InvitableRole)}
              aria-describedby="invite-role-hint"
              className="h-10 rounded-md border border-input bg-background px-3 text-base sm:text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              {INVITABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={onInvite}
            disabled={inviting || !inviteEmail.trim()}
            className="h-10 shrink-0 gap-2"
          >
            {inviting && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {inviting ? "Sending..." : "Send invite"}
          </Button>
        </div>
        <p id="invite-role-hint" className="text-xs text-muted-foreground mt-2">
          {ROLE_ABILITIES[inviteRole]}
        </p>

        {inviteToken && (
          <div className="mt-4 p-4 rounded-lg bg-muted/50 border border-border/50">
            <p className="text-xs text-muted-foreground mb-2">
              Invite sent. This link works once, for the address above:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-background border border-border rounded px-3 py-2 font-mono break-all select-all min-w-0">
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
        )}
      </CardContent>
    </Card>
  );
}
