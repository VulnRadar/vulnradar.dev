"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ExternalLink, RefreshCw, Unlink, Users } from "lucide-react";
import type { ProfileTabProps } from "../types";

const DiscordIcon = () => (
  <svg
    className="h-5 w-5 text-white"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

type DiscordConnection = {
  guildJoined: boolean;
  connectedAt: string | null;
};

export function ProfileSocialTab({
  user,
  loading: _loading,
  error: _error,
  success: _success,
  setError,
  setSuccess,
}: ProfileTabProps) {
  const [reconnecting, setReconnecting] = useState(false);
  const [discordData, setDiscordData] = useState<DiscordConnection | null>(
    null,
  );

  // Load extended Discord connection details when account is linked
  useEffect(() => {
    if (!user?.discordId) return;
    fetch("/api/v3/account/discord")
      .then((r) => r.json())
      .then((d) => {
        if (d.connected) {
          setDiscordData({
            guildJoined: !!d.guildJoined,
            connectedAt: d.updatedAt ?? null,
          });
        }
      })
      .catch(() => {});
  }, [user?.discordId]);

  const handleDisconnect = async () => {
    try {
      const res = await fetch("/api/v3/account/discord", { method: "DELETE" });
      if (res.ok) {
        setSuccess("Discord account disconnected.");
        window.location.reload();
      } else {
        setError("Failed to disconnect Discord account.");
      }
    } catch {
      setError("Failed to disconnect Discord account.");
    }
  };

  const connectedAt = discordData?.connectedAt
    ? new Date(discordData.connectedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Discord Integration */}
      <section>
        <Card className="overflow-hidden border-border/50 bg-card/50">
          {/* Discord-themed gradient header */}
          <div className="relative bg-gradient-to-br from-[#5865F2] via-[#4752C4] to-[#3C45A5] px-6 py-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
                  <DiscordIcon />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Discord
                  </h2>
                  <p className="text-xs text-white/70">
                    {user?.discordId
                      ? user.discordUsername || "Connected"
                      : "Sign in and community"}
                  </p>
                </div>
              </div>
              {user?.discordId && (
                <Badge className="bg-white/20 text-white border-white/30 backdrop-blur-sm">
                  <Check className="h-3 w-3 mr-1" /> Connected
                </Badge>
              )}
            </div>
          </div>

          <CardContent className="p-6 space-y-4">
            {user?.discordId ? (
              <>
                {/* Connected account card */}
                <div className="rounded-lg border border-border/60 bg-muted/30 p-4 flex items-center gap-4">
                  {user.discordAvatar ? (
                    <Image
                      src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.discordAvatar}.png?size=128`}
                      alt="Discord avatar"
                      width={52}
                      height={52}
                      unoptimized
                      className="h-13 w-13 rounded-full ring-2 ring-[#5865F2]/30 shrink-0"
                    />
                  ) : (
                    <div className="h-13 w-13 rounded-full bg-[#5865F2] flex items-center justify-center text-white text-lg font-semibold ring-2 ring-[#5865F2]/30 shrink-0">
                      {user.discordUsername?.[0]?.toUpperCase() || "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {user.discordUsername || "Unknown User"}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <p className="text-xs text-muted-foreground font-mono">
                        {user.discordId}
                      </p>
                      {discordData && (
                        <>
                          <span className="text-muted-foreground/40 text-xs">
                            ·
                          </span>
                          <span
                            className={`text-xs flex items-center gap-1 ${discordData.guildJoined ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                          >
                            <Users className="h-3 w-3" />
                            {discordData.guildJoined
                              ? "Server member"
                              : "Not in server"}
                          </span>
                        </>
                      )}
                    </div>
                    {connectedAt && (
                      <p className="text-xs text-muted-foreground/60 mt-0.5">
                        Connected {connectedAt}
                      </p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleDisconnect}
                    aria-label="Disconnect Discord"
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Unlink className="h-4 w-4" />
                  </Button>
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
                {/* Not connected — clean left-aligned layout, no icon grid */}
                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Link your Discord account
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      Sign in with Discord instead of typing a password. If you
                      join our server you get verified automatically. Your
                      Discord avatar can replace your profile picture.
                    </p>
                  </div>
                  <Button
                    className="bg-[#5865F2] hover:bg-[#4752C4] text-white shadow-sm"
                    onClick={() => {
                      window.location.href =
                        "/api/v3/auth/discord?action=connect";
                    }}
                  >
                    <DiscordIcon />
                    <span className="ml-2">Continue with Discord</span>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Community link */}
      <section>
        <Card className="border-border/60 bg-card/50">
          <CardContent className="p-0">
            <a
              href="https://discord.gg/Y7R6hdGbNe"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 p-5 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center justify-center h-11 w-11 rounded-xl bg-[#5865F2] shrink-0">
                <DiscordIcon />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm">
                  Join our Discord server
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Updates, support, and the community.
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
