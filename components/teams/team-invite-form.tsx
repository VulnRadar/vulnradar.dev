"use client";

import { X, Loader2, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

interface TeamInviteFormProps {
  inviteEmail: string;
  inviteRole: "admin" | "viewer";
  inviting: boolean;
  inviteToken: string | null;
  copied: boolean;
  onEmailChange: (v: string) => void;
  onRoleChange: (v: "admin" | "viewer") => void;
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-medium">Invite Team Member</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Send an invite link to add a new member
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="email@example.com"
            value={inviteEmail}
            onChange={(e) => onEmailChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onInvite()}
            className="flex-1"
          />
          <select
            value={inviteRole}
            onChange={(e) => onRoleChange(e.target.value as "admin" | "viewer")}
            className="h-10 rounded-md border border-border/40 bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <Button
            onClick={onInvite}
            disabled={inviting || !inviteEmail.trim()}
            className="h-10 shrink-0"
          >
            {inviting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Send Invite"
            )}
          </Button>
        </div>

        {inviteToken && (
          <div className="mt-4 p-4 rounded-lg bg-muted/50 border border-border/50">
            <p className="text-xs text-muted-foreground mb-2">
              Share this invite link (expires in 7 days):
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-background border border-border/40 rounded px-3 py-2 font-mono break-all select-all min-w-0">
                {inviteUrl}
              </code>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 h-9 w-9 p-0"
                onClick={onCopy}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
