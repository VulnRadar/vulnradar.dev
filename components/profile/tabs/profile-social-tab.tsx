"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  ExternalLink,
  RefreshCw,
  Unlink,
  Users,
  Sparkles,
  Zap,
  Shield,
} from "lucide-react";
import type { ProfileTabProps } from "../types";

export function ProfileSocialTab({
  user,
  loading: _loading,
  error: _error,
  success: _success,
  setError,
  setSuccess,
}: ProfileTabProps) {
  const [reconnecting, setReconnecting] = useState(false);

  const handleDisconnectDiscord = async () => {
    try {
      const res = await fetch("/api/v3/account/discord", { method: "DELETE" });
      if (res.ok) {
        setSuccess("Discord account disconnected");
        const authRes = await fetch("/api/v3/auth/me");
        await authRes.json();
        // Trigger parent re-fetch of user data
        window.location.reload();
      } else {
        setError("Failed to disconnect Discord account");
      }
    } catch {
      setError("Failed to disconnect Discord account");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Discord Integration — redesigned to look like Discord's own
       * marketing surface rather than a generic form. Dark card with
       * Discord blurple (#5865F2) gradient, avatar tile, feature
       * pills, and a clear "connected" vs "connect" CTA. */}
      <section>
        <Card className="overflow-hidden border-border/50 bg-card/50">
          {/* Discord-themed header with gradient + mascot icon */}
          <div className="relative bg-gradient-to-br from-[#5865F2] via-[#4752C4] to-[#3C45A5] px-6 py-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
                  <svg
                    className="h-6 w-6 text-white"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Discord
                  </h2>
                  <p className="text-xs text-white/70">
                    One account, sign-in &amp; community
                  </p>
                </div>
              </div>
              {user?.discordId ? (
                <Badge className="bg-white/20 text-white border-white/30 backdrop-blur-sm">
                  <Check className="h-3 w-3 mr-1" /> Connected
                </Badge>
              ) : null}
            </div>
          </div>

          <CardContent className="p-6 space-y-5">
            {user?.discordId ? (
              <>
                {/* Connected account card */}
                <div className="rounded-xl border border-border/60 bg-secondary/30 p-4 flex items-center gap-4">
                  {user.discordAvatar ? (
                    <Image
                      src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.discordAvatar}.png?size=128`}
                      alt="Discord avatar"
                      width={56}
                      height={56}
                      unoptimized
                      className="h-14 w-14 rounded-full ring-2 ring-[#5865F2]/40"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-full bg-[#5865F2] flex items-center justify-center text-white text-lg font-semibold ring-2 ring-[#5865F2]/40">
                      {user.discordUsername?.[0]?.toUpperCase() || "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">
                      {user.discordUsername || "Unknown User"}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      ID: {user.discordId}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleDisconnectDiscord}
                    aria-label="Disconnect Discord"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Unlink className="h-4 w-4" />
                  </Button>
                </div>

                {/* Feature badges */}
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      Discord sign-in
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#5865F2]/10 border border-[#5865F2]/20">
                    <Users className="h-3.5 w-3.5 text-[#5865F2]" />
                    <span className="text-xs font-medium text-[#5865F2]">
                      Community
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20">
                    <Zap className="h-3.5 w-3.5 text-violet-500" />
                    <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
                      Profile sync
                    </span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setReconnecting(true);
                    window.location.href =
                      "/api/v3/auth/discord?action=connect";
                  }}
                  disabled={reconnecting}
                >
                  <RefreshCw
                    className={`mr-2 h-4 w-4 ${reconnecting ? "animate-spin" : ""}`}
                  />
                  {reconnecting ? "Reconnecting…" : "Reconnect account"}
                </Button>
              </>
            ) : (
              <>
                {/* Not connected state */}
                <div className="rounded-xl border border-border/60 bg-gradient-to-br from-secondary/40 to-secondary/10 p-6 text-center space-y-5">
                  <div className="flex justify-center">
                    <div className="relative">
                      <div className="absolute inset-0 bg-[#5865F2]/20 blur-xl rounded-full" />
                      <div className="relative h-20 w-20 rounded-full bg-[#5865F2]/15 border-2 border-[#5865F2]/40 flex items-center justify-center">
                        <svg
                          className="h-10 w-10 text-[#5865F2]"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      Link your Discord account
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                      One-click sign-in, automatic server join, and a synced
                      profile picture. Takes about 10 seconds.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-md mx-auto pt-2">
                    <div className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-background/50 border border-border/40">
                      <Shield className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs font-medium text-foreground">
                        One-click sign-in
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-background/50 border border-border/40">
                      <Sparkles className="h-4 w-4 text-[#5865F2]" />
                      <span className="text-xs font-medium text-foreground">
                        Auto server join
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-background/50 border border-border/40">
                      <Zap className="h-4 w-4 text-violet-500" />
                      <span className="text-xs font-medium text-foreground">
                        Profile sync
                      </span>
                    </div>
                  </div>
                </div>

                <Button
                  className="w-full bg-[#5865F2] hover:bg-[#4752C4] text-white shadow-lg shadow-[#5865F2]/20"
                  size="lg"
                  onClick={() => {
                    window.location.href =
                      "/api/v3/auth/discord?action=connect";
                  }}
                >
                  <svg
                    className="mr-2 h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                  </svg>
                  Continue with Discord
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Community Links — Discord server invite */}
      <section>
        <Card className="border-border/60 bg-card/50">
          <CardContent className="p-0">
            <a
              href="https://discord.gg/Y7R6hdGbNe"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 p-5 hover:bg-secondary/20 transition-colors"
            >
              <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-[#5865F2] shrink-0">
                <svg
                  className="h-6 w-6 text-white"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground">
                  Join our Discord server
                </p>
                <p className="text-sm text-muted-foreground">
                  Updates, support, and the community — open in a new tab.
                </p>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
            </a>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
