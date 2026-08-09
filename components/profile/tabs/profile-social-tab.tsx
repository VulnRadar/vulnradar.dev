"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { FcGoogle } from "react-icons/fc";
import { FaGithub } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Check,
  ExternalLink,
  RefreshCw,
  Unlink,
  Users,
  Loader2,
} from "lucide-react";
import { API, DISCORD_INVITE_URL } from "@/lib/config/constants";
import { useOAuthProviders } from "@/lib/hooks/use-oauth-providers";
import { getQueryParam, setQueryParams } from "@/lib/ui/url-state";
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

/** Shared identity for the Connections list's account-linking rows below --
 *  everything comes straight off the /api/v3/auth/me payload (no extra
 *  fetch needed, unlike Discord's discord_connections join). */
type OAuthIdentity = {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

/**
 * A Google or GitHub connection card: same connect/disconnect/reconnect
 * shape as the Discord card above, generalized because Google and GitHub
 * behave identically here (one row on `users`, no tokens, no extra
 * per-provider quirks like Discord's guild-join). Kept as its own
 * component rather than two more near-copies of the Discord JSX.
 */
function OAuthIdentityCard({
  provider,
  label,
  icon,
  headerClassName,
  titleClassName,
  subtitleClassName,
  connectButtonClassName,
  description,
  identity,
  setError,
  setSuccess,
}: {
  provider: "google" | "github";
  label: string;
  icon: React.ReactNode;
  headerClassName: string;
  titleClassName: string;
  subtitleClassName: string;
  connectButtonClassName: string;
  description: string;
  identity: OAuthIdentity | null;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
}) {
  const [reconnecting, setReconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const connected = Boolean(identity);
  const displayName = identity?.name || identity?.email || "Connected";

  const startLink = () => {
    window.location.href = `${API.AUTH.OAUTH_START(provider)}?action=link`;
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/v3/account/oauth/${provider}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccess(`${label} account disconnected.`);
        window.location.reload();
      } else {
        setError(
          data.error || `We could not disconnect your ${label} account.`,
        );
        setDisconnecting(false);
        setShowDisconnectConfirm(false);
      }
    } catch {
      setError(
        "We could not reach the server. Check your connection and try again.",
      );
      setDisconnecting(false);
      setShowDisconnectConfirm(false);
    }
  };

  return (
    <section>
      <Card className="overflow-hidden border-border/50 bg-card/50">
        <div className={headerClassName}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center ring-1 ring-black/10 shrink-0">
                {icon}
              </div>
              <div className="min-w-0">
                <h2 className={`text-base font-semibold ${titleClassName}`}>
                  {label}
                </h2>
                <p className={`text-xs truncate ${subtitleClassName}`}>
                  {connected ? displayName : "Sign in without a password"}
                </p>
              </div>
            </div>
            {connected && (
              <Badge className="bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)] shrink-0">
                <Check className="h-3 w-3 mr-1" /> Connected
              </Badge>
            )}
          </div>
        </div>

        <CardContent className="p-6 space-y-4">
          {identity ? (
            <>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 flex items-center gap-4">
                {identity.avatarUrl ? (
                  <Image
                    src={identity.avatarUrl}
                    alt={`${label} avatar`}
                    width={52}
                    height={52}
                    unoptimized
                    className="h-13 w-13 rounded-full ring-2 ring-primary/30 shrink-0"
                  />
                ) : (
                  <div className="h-13 w-13 rounded-full bg-primary/20 flex items-center justify-center text-primary text-lg font-semibold ring-2 ring-primary/30 shrink-0">
                    {displayName[0]?.toUpperCase() || "?"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {identity.name || "Unknown"}
                  </p>
                  {identity.email && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {identity.email}
                    </p>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setShowDisconnectConfirm(true)}
                  aria-label={`Disconnect ${label}`}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Unlink className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setReconnecting(true);
                  startLink();
                }}
                disabled={reconnecting}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${reconnecting ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {reconnecting ? "Reconnecting..." : "Reconnect account"}
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Link your {label} account
                </h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  {description}
                </p>
              </div>
              <Button className={connectButtonClassName} onClick={startLink}>
                {icon}
                <span className="ml-2">Continue with {label}</span>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={showDisconnectConfirm}
        onOpenChange={(open) => {
          if (!open && !disconnecting) setShowDisconnectConfirm(false);
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {label}?</AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              {displayName} will no longer sign you in. You can reconnect the
              same or a different account any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setShowDisconnectConfirm(false)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="gap-2"
            >
              {disconnecting && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export function ProfileSocialTab({
  user,
  loading: _loading,
  error: _error,
  success: _success,
  setError,
  setSuccess,
}: ProfileTabProps) {
  const providers = useOAuthProviders();

  const [reconnecting, setReconnecting] = useState(false);
  const [discordData, setDiscordData] = useState<DiscordConnection | null>(
    null,
  );
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

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

  // Google linking lands back here as a full page redirect
  // (app/api/v3/auth/oauth/[provider]/callback/route.ts's handleOAuthLink)
  // with either `google_connected=true` or `error`/`message` in the URL.
  // Surface it as the same toast every other profile action uses (see the
  // "Toast messages" block in app/profile/page.tsx), then strip the params
  // so a refresh doesn't re-show it. Reads window.location directly via
  // lib/ui/url-state.ts rather than next/navigation's useSearchParams,
  // matching the rest of this page (see useQueryParam in
  // app/profile/page.tsx) and sidestepping its Suspense-boundary
  // requirement, since this component isn't wrapped in one.
  //
  // GitHub is deliberately NOT handled here anymore: GithubProfileModal
  // (mounted globally in app/layout.tsx, matching DiscordProfileModal) now
  // owns github_connected/github_username/github_avatar entirely, showing
  // its own richer sync modal instead of a plain toast. Both this effect's
  // history.replaceState call and GithubProfileModal's next/navigation
  // router were racing to react to the same params on the same mount --
  // the modal would flash open and then immediately get torn down by a
  // refresh. Only one owner per param set, same as Discord already had.
  useEffect(() => {
    const googleConnected = getQueryParam("google_connected") === "true";
    const error = getQueryParam("error");
    const message = getQueryParam("message");

    if (!googleConnected && !error) return;

    if (googleConnected) setSuccess("Google account connected.");
    else if (error) {
      setError(message || "We could not complete that connection. Try again.");
    }

    setQueryParams(
      {
        google_connected: null,
        error: null,
        message: null,
      },
      { replace: true },
    );
    // Runs once on mount to consume the redirect's query params -- setError/
    // setSuccess are stable setters from the parent's useState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/v3/account/discord", { method: "DELETE" });
      if (res.ok) {
        setSuccess("Discord account disconnected.");
        window.location.reload();
      } else {
        setError("We could not disconnect your Discord account. Try again.");
        setDisconnecting(false);
        setShowDisconnectConfirm(false);
      }
    } catch {
      setError(
        "We could not reach the server. Check your connection and try again.",
      );
      setDisconnecting(false);
      setShowDisconnectConfirm(false);
    }
  };

  const connectedAt = discordData?.connectedAt
    ? new Date(discordData.connectedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const googleIdentity: OAuthIdentity | null = user?.googleId
    ? {
        name: user.googleName ?? null,
        email: user.googleEmail ?? null,
        avatarUrl: user.googleAvatarUrl ?? null,
      }
    : null;

  const githubIdentity: OAuthIdentity | null = user?.githubId
    ? {
        name: user.githubName ?? null,
        email: user.githubEmail ?? null,
        avatarUrl: user.githubAvatarUrl ?? null,
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Discord Integration */}
      <section>
        <Card className="overflow-hidden border-border/50 bg-card/50">
          {/* Discord-themed gradient header */}
          <div className="relative bg-gradient-to-br from-[#5865F2] via-[#4752C4] to-[#3C45A5] px-6 py-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20 shrink-0">
                  <DiscordIcon />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-white">
                    Discord
                  </h2>
                  <p className="text-xs text-white/70 truncate">
                    {user?.discordId
                      ? user.discordUsername || "Connected"
                      : "Sign in and community"}
                  </p>
                </div>
              </div>
              {user?.discordId && (
                <Badge className="bg-white/20 text-white border-white/30 backdrop-blur-sm shrink-0">
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
                            className={`text-xs flex items-center gap-1 ${discordData.guildJoined ? "text-[hsl(var(--success))]" : "text-muted-foreground"}`}
                          >
                            <Users className="h-3 w-3" aria-hidden="true" />
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
                    onClick={() => setShowDisconnectConfirm(true)}
                    aria-label="Disconnect Discord"
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Unlink className="h-4 w-4" aria-hidden="true" />
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
                    aria-hidden="true"
                  />
                  {reconnecting ? "Reconnecting..." : "Reconnect account"}
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

      {/* Google Integration -- only rendered once GOOGLE_CLIENT_ID/SECRET are
          set (see lib/auth/oauth-providers.ts, /api/v3/auth/oauth/info),
          same "invisible until configured" rule the login page's Google
          button already follows. Header is a neutral, theme-aware surface
          rather than a solid brand color: Google's own button guidelines
          call for a white/neutral background behind the multicolor "G",
          not a single "Google blue" the way Discord or GitHub have one
          recognizable brand color. */}
      {providers.google && (
        <OAuthIdentityCard
          provider="google"
          label="Google"
          icon={<FcGoogle className="h-5 w-5" aria-hidden="true" />}
          headerClassName="relative bg-gradient-to-br from-muted to-muted/60 px-6 py-5 border-b border-border/50"
          titleClassName="text-foreground"
          subtitleClassName="text-muted-foreground"
          connectButtonClassName="border border-border/60 bg-background hover:bg-muted text-foreground shadow-sm"
          description="Sign in with Google instead of typing a password. Your Google name and photo are only used if you connect."
          identity={googleIdentity}
          setError={setError}
          setSuccess={setSuccess}
        />
      )}

      {/* GitHub Integration -- separate from the "connect GitHub for repo
          scanning" feature in the Developer tab (app/api/v3/account/github/):
          this only links a sign-in identity, never requests repo access. */}
      {providers.github && (
        <OAuthIdentityCard
          provider="github"
          label="GitHub"
          icon={
            <FaGithub className="h-5 w-5 text-[#181717]" aria-hidden="true" />
          }
          headerClassName="relative bg-gradient-to-br from-[#24292e] via-[#1b1f23] to-[#0d1117] px-6 py-5"
          titleClassName="text-white"
          subtitleClassName="text-white/70"
          connectButtonClassName="bg-[#181717] hover:bg-[#2b3137] text-white shadow-sm"
          description="Sign in with GitHub instead of typing a password. This is separate from connecting a repo for code scanning in the Developer tab."
          identity={githubIdentity}
          setError={setError}
          setSuccess={setSuccess}
        />
      )}

      {/* Community link */}
      <section>
        <Card className="border-border/60 bg-card/50">
          <CardContent className="p-0">
            <a
              href={DISCORD_INVITE_URL}
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
              <ExternalLink
                className="h-4 w-4 text-muted-foreground shrink-0"
                aria-hidden="true"
              />
            </a>
          </CardContent>
        </Card>
      </section>

      {/* Disconnecting is reversible but changes how this account signs in,
          so it names the account before it acts. */}
      <AlertDialog
        open={showDisconnectConfirm}
        onOpenChange={(open) => {
          if (!open && !disconnecting) setShowDisconnectConfirm(false);
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Discord?</AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              {user?.discordUsername || "This Discord account"} will no longer
              sign you in or sync your avatar. You can reconnect the same or a
              different account any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setShowDisconnectConfirm(false)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="gap-2"
            >
              {disconnecting && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
