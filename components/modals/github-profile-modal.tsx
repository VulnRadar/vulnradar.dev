"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
      <DialogContent className="sm:max-w-[440px] p-0 overflow-hidden border-0 gap-0">
        {/* Header with GitHub branding */}
        <div className="relative bg-linear-to-br from-[#24292e] via-[#1b1f23] to-[#0d1117] px-6 pt-8 pb-14">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-4 left-8 w-16 h-16 rounded-full bg-white/20" />
            <div className="absolute top-12 right-12 w-8 h-8 rounded-full bg-white/20" />
            <div className="absolute bottom-8 left-1/4 w-6 h-6 rounded-full bg-white/20" />
          </div>

          <div className="relative flex items-center gap-3">
            <FaGithub className="h-8 w-8 text-white" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-bold text-white">
                GitHub Connected!
              </h2>
              <p className="text-white/80 text-sm">
                Your account is now linked
              </p>
            </div>
          </div>
        </div>

        {/* Avatar overlapping header */}
        <div className="relative -mt-10 flex justify-center">
          <div className="relative">
            <Avatar className="h-20 w-20 border-4 border-background ring-4 ring-[#24292e]/20">
              <AvatarImage
                src={githubAvatar || undefined}
                alt={githubUsername}
              />
              <AvatarFallback className="bg-[#24292e] text-white text-2xl font-bold">
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

        {/* Content */}
        <div className="px-6 pt-4 pb-6">
          <div className="text-center mb-5">
            <p className="text-lg font-semibold text-foreground">
              {githubUsername}
            </p>
            <p className="text-sm text-muted-foreground">
              Select what to sync from GitHub
            </p>
          </div>

          {/* Sync options */}
          <div className="space-y-2 mb-5">
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
                  <p className="text-xs text-muted-foreground truncate">
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
              className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 mb-4"
            >
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleSync}
              disabled={loading}
              className="relative w-full h-11 bg-[#24292e] hover:bg-[#2b3137] text-white font-medium"
            >
              {loading ? (
                <>
                  <Loader2
                    className="absolute left-4 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Syncing...
                </>
              ) : hasAnySelection ? (
                <>
                  <Check
                    className="absolute left-4 h-4 w-4"
                    aria-hidden="true"
                  />
                  Sync selected
                </>
              ) : (
                "Skip"
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={loading}
              className="w-full h-11 text-muted-foreground hover:text-foreground"
            >
              Skip for now
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
