"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Loader2, Image as ImageIcon, User } from "lucide-react";
import { cn } from "@/lib/ui/utils";

const AUTH_UPDATE_ENDPOINT = "/api/v3/auth/update";

export function DiscordProfileModal() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const discordConnected = searchParams.get("discord_connected") === "true";
  const discordUsername = searchParams.get("discord_username");
  const discordAvatar = searchParams.get("discord_avatar");

  const [open, setOpen] = useState(discordConnected && !!discordUsername);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Selection state for each field
  const [syncAvatar, setSyncAvatar] = useState(true);
  const [syncName, setSyncName] = useState(true);

  const hasAnySelection = syncAvatar || syncName;

  const handleClose = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("discord_connected");
    url.searchParams.delete("discord_username");
    url.searchParams.delete("discord_avatar");
    router.replace(url.pathname + url.search);
  };

  const handleSync = async () => {
    if (!hasAnySelection) {
      handleClose();
      return;
    }

    setLoading(true);
    setError("");

    try {
      const updateData: Record<string, string | undefined> = {};

      if (syncAvatar && discordAvatar) {
        updateData.avatarUrl = discordAvatar;
      }
      if (syncName && discordUsername) {
        updateData.name = discordUsername;
      }

      const res = await fetch(AUTH_UPDATE_ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update profile");
        return;
      }

      handleClose();
      router.refresh();
      window.location.reload();
    } catch {
      setError("Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  if (!discordConnected || !discordUsername) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      {/* The three-band shell, so the actions stay in a pinned footer: with
          the header, the 80px avatar and the sync rows, a short viewport used
          to push "Sync selected" / "Skip for now" past the height cap. */}
      <DialogContent variant="shell" size="sm">
        {/* The house card header. This was a full-bleed brand panel with three
            absolutely positioned decorative white circles: nothing else in the
            product has a gradient header or a decorative blob, and the
            illustration doctrine is "the actual mechanism, rendered as itself".
            The brand colour stays on the glyph plate, one element.

            The title and the line under it are the Radix primitives, not a
            bare h2 and p: a DialogContent with no DialogTitle has no
            accessible name at all, which Radix logs as an error and a screen
            reader announces as an unnamed dialog. */}
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#5865F2]">
              <svg
                className="h-5 w-5 text-white"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </div>
            <div className="min-w-0">
              <DialogTitle>Discord connected</DialogTitle>
              <DialogDescription>Your account is now linked</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="overscroll-contain">
          <div className="flex justify-center">
            <div className="relative">
              <Avatar className="h-20 w-20 ring-2 ring-border">
                <AvatarImage
                  src={discordAvatar || undefined}
                  alt={discordUsername}
                />
                <AvatarFallback className="bg-[#5865F2] text-white text-xl font-semibold">
                  {discordUsername?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-[hsl(var(--success))] flex items-center justify-center ring-2 ring-background">
                <Check
                  className="h-3.5 w-3.5 text-[hsl(var(--success-foreground))]"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>

          <div className="text-center mt-4 mb-5">
            <p className="text-lg font-semibold text-foreground">
              {discordUsername}
            </p>
            <p className="text-sm text-muted-foreground">
              Select what to sync from Discord
            </p>
          </div>

          {/* Sync options */}
          <div className="space-y-2">
            {/* Avatar option */}
            {discordAvatar && (
              <label
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                  syncAvatar
                    ? "border-[#5865F2] bg-[#5865F2]/5"
                    : "border-border hover:border-muted-foreground/30 hover:bg-muted/30",
                )}
              >
                <Checkbox
                  checked={syncAvatar}
                  onCheckedChange={(checked) => setSyncAvatar(checked === true)}
                  aria-label="Sync profile picture from Discord"
                  className="data-[state=checked]:bg-[#5865F2] data-[state=checked]:border-[#5865F2]"
                />
                <ImageIcon
                  className="h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Profile Picture
                  </p>
                  {/* Our own caption, so it wraps rather than clips: this row
                      already spends its width on a checkbox, an icon and an
                      avatar. */}
                  <p className="text-xs text-muted-foreground">
                    Use Discord avatar
                  </p>
                </div>
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={discordAvatar} alt="" />
                </Avatar>
              </label>
            )}

            {/* Name option */}
            <label
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                syncName
                  ? "border-[#5865F2] bg-[#5865F2]/5"
                  : "border-border hover:border-muted-foreground/30 hover:bg-muted/30",
              )}
            >
              <Checkbox
                checked={syncName}
                onCheckedChange={(checked) => setSyncName(checked === true)}
                aria-label="Sync display name from Discord"
                className="data-[state=checked]:bg-[#5865F2] data-[state=checked]:border-[#5865F2]"
              />
              <User
                className="h-4 w-4 text-muted-foreground shrink-0"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Display Name
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {discordUsername}
                </p>
              </div>
            </label>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 mt-4"
            >
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </DialogBody>

        {/* The spinner and the tick were `absolute left-4` inside a full-width
            button. The footer band sizes its buttons to their content, so an
            absolutely positioned mark would sit on top of the label: they are
            inline now. */}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground"
          >
            Skip for now
          </Button>
          <Button
            onClick={handleSync}
            disabled={loading}
            className="gap-2 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Syncing...
              </>
            ) : hasAnySelection ? (
              <>
                <Check className="h-4 w-4" aria-hidden="true" />
                Sync selected
              </>
            ) : (
              "Skip"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
