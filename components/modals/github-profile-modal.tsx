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
import { FaGithub } from "react-icons/fa";
import { Check, Loader2, Image as ImageIcon, User } from "lucide-react";
import { cn } from "@/lib/ui/utils";

const AUTH_UPDATE_ENDPOINT = "/api/v3/auth/update";

/**
 * GitHub's counterpart to DiscordProfileModal -- same shape (sync avatar +
 * display name after connecting), no email option: app/api/v3/auth/oauth/
 * [provider]/callback/route.ts deliberately never puts an email address in
 * a redirect URL (browser history, server logs, Referer headers), same
 * reasoning Discord's connect flow already follows.
 */
export function GithubProfileModal() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const githubConnected = searchParams.get("github_connected") === "true";
  const githubUsername = searchParams.get("github_username");
  const githubAvatar = searchParams.get("github_avatar");

  const [open, setOpen] = useState(githubConnected && !!githubUsername);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [syncAvatar, setSyncAvatar] = useState(true);
  const [syncName, setSyncName] = useState(true);

  const hasAnySelection = syncAvatar || syncName;

  const handleClose = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("github_connected");
    url.searchParams.delete("github_username");
    url.searchParams.delete("github_avatar");
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

      if (syncAvatar && githubAvatar) {
        updateData.avatarUrl = githubAvatar;
      }
      if (syncName && githubUsername) {
        updateData.name = githubUsername;
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

  if (!githubConnected || !githubUsername) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      {/* The three-band shell, so the actions stay in a pinned footer: with
          the header, the 80px avatar and the sync rows, a short viewport used
          to push "Sync selected" / "Skip for now" past the height cap. */}
      <DialogContent variant="shell" size="sm">
        {/* The house card header. This was a full-bleed brand gradient with
            three absolutely positioned decorative white circles: nothing else
            in the product has a gradient header or a decorative blob, and the
            illustration doctrine is "the actual mechanism, rendered as itself".
            The brand colour stays on the glyph plate, one element.

            The title and the line under it are the Radix primitives, not a
            bare h2 and p: a DialogContent with no DialogTitle has no
            accessible name at all, which Radix logs as an error and a screen
            reader announces as an unnamed dialog. */}
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#181717]">
              <FaGithub className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <DialogTitle>GitHub connected</DialogTitle>
              <DialogDescription>Your account is now linked</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="overscroll-contain">
          <div className="flex justify-center">
            <div className="relative">
              <Avatar className="h-20 w-20 ring-2 ring-border">
                <AvatarImage
                  src={githubAvatar || undefined}
                  alt={githubUsername}
                />
                <AvatarFallback className="bg-[#181717] text-white text-xl font-semibold">
                  {githubUsername?.charAt(0).toUpperCase()}
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
              {githubUsername}
            </p>
            <p className="text-sm text-muted-foreground">
              Select what to sync from GitHub
            </p>
          </div>

          {/* Sync options */}
          <div className="space-y-2">
            {/* Avatar option */}
            {githubAvatar && (
              <label
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                  syncAvatar
                    ? "border-[#24292e] bg-[#24292e]/5"
                    : "border-border hover:border-muted-foreground/30 hover:bg-muted/30",
                )}
              >
                <Checkbox
                  checked={syncAvatar}
                  onCheckedChange={(checked) => setSyncAvatar(checked === true)}
                  aria-label="Sync profile picture from GitHub"
                  className="data-[state=checked]:bg-[#24292e] data-[state=checked]:border-[#24292e]"
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
                    Use GitHub avatar
                  </p>
                </div>
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={githubAvatar} alt="" />
                </Avatar>
              </label>
            )}

            {/* Name option */}
            <label
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                syncName
                  ? "border-[#24292e] bg-[#24292e]/5"
                  : "border-border hover:border-muted-foreground/30 hover:bg-muted/30",
              )}
            >
              <Checkbox
                checked={syncName}
                onCheckedChange={(checked) => setSyncName(checked === true)}
                aria-label="Sync display name from GitHub"
                className="data-[state=checked]:bg-[#24292e] data-[state=checked]:border-[#24292e]"
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
                  {githubUsername}
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
            className="gap-2 bg-[#24292e] hover:bg-[#2b3137] text-white font-medium"
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
