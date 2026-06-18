"use client"

import { useState } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Check,
  ExternalLink,
  RefreshCw,
  Unlink,
  Users,
} from "lucide-react"
import type { ProfileTabProps } from "../types"

export function ProfileSocialTab({
  user,
  loading: _loading,
  error: _error,
  success: _success,
  setError,
  setSuccess,
}: ProfileTabProps) {
  const [reconnecting, setReconnecting] = useState(false)

  const handleDisconnectDiscord = async () => {
    try {
      const res = await fetch("/api/v2/account/discord", { method: "DELETE" })
      if (res.ok) {
        setSuccess("Discord account disconnected")
        const authRes = await fetch("/api/v2/auth/me")
        await authRes.json()
        // Trigger parent re-fetch of user data
        window.location.reload()
      } else {
        setError("Failed to disconnect Discord account")
      }
    } catch {
      setError("Failed to disconnect Discord account")
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Discord Integration */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#5865F2]/10">
              <svg
                className="h-4 w-4 text-[#5865F2]"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Discord Integration
              </h2>
              <p className="text-sm text-muted-foreground">
                Connect for sign-in and community features
              </p>
            </div>
          </div>
          {user?.discordId && (
            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
              Connected
            </Badge>
          )}
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 space-y-4">
            {user?.discordId ? (
              <>
                {/* Connected Account Card */}
                <div className="rounded-xl border border-[#5865F2]/20 bg-[#5865F2]/5 overflow-hidden">
                  {/* Header with Discord branding */}
                  <div className="bg-[#5865F2] px-4 py-3">
                    <p className="text-sm font-medium text-white">
                      Connected Account
                    </p>
                  </div>

                  {/* Account details */}
                  <div className="p-4 space-y-4">
                    {/* User info row */}
                    <div className="flex items-center gap-4">
                      {user.discordAvatar ? (
                        <Image
                          src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.discordAvatar}.png?size=128`}
                          alt="Discord avatar"
                          width={56}
                          height={56}
                          unoptimized
                          className="h-14 w-14 rounded-full ring-2 ring-[#5865F2]/30 ring-offset-2 ring-offset-background"
                        />
                      ) : (
                        <div className="h-14 w-14 rounded-full bg-[#5865F2] flex items-center justify-center ring-2 ring-[#5865F2]/30 ring-offset-2 ring-offset-background">
                          <span className="text-white text-lg font-semibold">
                            {user.discordUsername?.[0]?.toUpperCase() ||
                              "?"}
                          </span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground truncate">
                          {user.discordUsername || "Unknown User"}
                        </p>
                        <p className="text-sm text-muted-foreground font-mono">
                          ID: {user.discordId}
                        </p>
                      </div>
                    </div>

                    {/* Feature badges */}
                    <div className="flex flex-wrap gap-2">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          Discord Sign-in Enabled
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#5865F2]/10 border border-[#5865F2]/20">
                        <Users className="h-3.5 w-3.5 text-[#5865F2]" />
                        <span className="text-xs font-medium text-[#5865F2]">
                          Community Access
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setReconnecting(true)
                      window.location.href =
                        "/api/v2/auth/discord?action=connect"
                    }}
                    disabled={reconnecting}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {reconnecting ? "Reconnecting..." : "Reconnect Account"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 text-destructive dark:text-red-400 border-destructive/30 hover:bg-destructive/10"
                    onClick={handleDisconnectDiscord}
                  >
                    <Unlink className="mr-2 h-4 w-4" />
                    Disconnect
                  </Button>
                </div>

                {/* Info note */}
                <p className="text-xs text-muted-foreground">
                  Disconnecting will disable Discord sign-in. You can
                  reconnect at any time.
                </p>
              </>
            ) : (
              <>
                {/* Not connected state */}
                <div className="rounded-xl border border-border bg-secondary/30 p-6 text-center space-y-4">
                  <div className="flex justify-center">
                    <div className="h-16 w-16 rounded-full bg-[#5865F2]/10 border-2 border-dashed border-[#5865F2]/30 flex items-center justify-center">
                      <svg
                        className="h-8 w-8 text-[#5865F2]/60"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                      </svg>
                    </div>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      No Discord account connected
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Link your Discord for faster sign-in and community
                      features
                    </p>
                  </div>

                  {/* Benefits list */}
                  <div className="flex flex-col gap-2 text-left max-w-xs mx-auto">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span>Sign in with one click</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span>Auto-join our Discord server</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span>Sync your profile picture</span>
                    </div>
                  </div>
                </div>

                <Button
                  className="w-full bg-[#5865F2] hover:bg-[#4752C4] text-white"
                  onClick={() => {
                    window.location.href = "/api/v2/auth/discord?action=connect"
                  }}
                >
                  <svg
                    className="mr-2 h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                  </svg>
                  Connect Discord Account
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Community Links */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10">
            <Users className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Community
            </h2>
            <p className="text-sm text-muted-foreground">
              Join our community and stay connected
            </p>
          </div>
        </div>
        <Card className="border-border/60">
          <CardContent className="pt-6">
            <a
              href="https://discord.gg/Y7R6hdGbNe"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 p-4 rounded-xl border border-[#5865F2]/20 bg-[#5865F2]/5 hover:bg-[#5865F2]/10 transition-colors"
            >
              <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-[#5865F2]">
                <svg
                  className="h-6 w-6 text-white"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">Discord Server</p>
                <p className="text-sm text-muted-foreground">
                  Join our community for updates and support
                </p>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </a>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
