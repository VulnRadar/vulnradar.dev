"use client";

import { useEffect, useState } from "react";
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
import { Check, Loader2, Unlink, RefreshCw, ShieldAlert, Lock } from "lucide-react";
import { API } from "@/lib/config/constants";

// lucide-react dropped brand/logo icons (Github, Twitter, etc.) from its
// icon set; every other brand mark in this app (Discord, Slack — see
// components/profile/tabs/profile-social-tab.tsx and
// components/profile/tabs/developer/webhooks-section.tsx) already uses an
// inline SVG for the same reason.
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.69.08-.69 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97.01 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.8 1.18 1.83 1.18 3.09 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .3.2.66.79.55A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

interface GithubConnectionStatus {
  connected: boolean;
  githubUsername?: string;
  scopes?: string;
  connectedAt?: string;
}

interface GithubRepo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  description: string | null;
}

interface GithubSectionProps {
  setError: (msg: string | null) => void;
  setSuccess: (msg: string | null) => void;
}

const GITHUB_ERROR_MESSAGES: Record<string, string> = {
  denied: "GitHub sign-in was cancelled.",
  invalid: "The GitHub callback was missing required parameters.",
  invalid_state: "That connection link expired or was already used. Try connecting again.",
  expired: "That connection link expired. Try connecting again.",
  session_expired: "Your session expired before GitHub redirected back. Log in and try again.",
  not_configured: "GitHub integration is not configured on this server.",
  failed: "Could not connect your GitHub account. Try again.",
};

/**
 * GitHub sub-section of the Developer tab. Self-contained: fetches its own
 * connection status and repo list rather than threading through the
 * shell's preloaded-data plumbing (which exists for API keys/webhooks/
 * schedules specifically), since this is an independent, newly added
 * capability.
 */
export function GithubSection({ setError, setSuccess }: GithubSectionProps) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<GithubConnectionStatus>({ connected: false });
  const [connecting, setConnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [scanningRepo, setScanningRepo] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<
    Record<string, { findingsCount: number; scanHistoryId: number | null }>
  >({});

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await fetch(API.ACCOUNT_GITHUB);
      const data = await res.json();
      setStatus(data);
    } catch {
      /* leave status at its previous value */
    }
    setLoading(false);
  }

  useEffect(() => {
    // Surface the redirect result from the OAuth callback once, then let
    // the fresh status fetch below take over as the source of truth. Read
    // directly from window.location instead of next/navigation's
    // useSearchParams so this component doesn't require a Suspense
    // boundary from whatever page happens to host it.
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("github_connected");
    const errorCode = params.get("github_error");
    if (connected === "true") {
      setSuccess("GitHub account connected.");
    } else if (errorCode) {
      setError(GITHUB_ERROR_MESSAGES[errorCode] ?? "Could not connect your GitHub account.");
    }
    // Runs once on mount only, reading window.location directly — setError
    // / setSuccess are stable setters from the parent and intentionally
    // excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadRepos() {
    setReposLoading(true);
    try {
      const res = await fetch(API.ACCOUNT_GITHUB_REPOS);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load repositories.");
        return;
      }
      setRepos(data.repos);
    } catch {
      setError("Failed to load repositories.");
    }
    setReposLoading(false);
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch(API.ACCOUNT_GITHUB, { method: "DELETE" });
      if (res.ok) {
        setSuccess("GitHub account disconnected.");
        setStatus({ connected: false });
        setRepos(null);
        setScanResults({});
      } else {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(data.error || "Could not disconnect your GitHub account.");
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    setDisconnecting(false);
    setShowDisconnectConfirm(false);
  }

  async function handleScan(repoFullName: string) {
    setScanningRepo(repoFullName);
    setError(null);
    try {
      const res = await fetch(API.SCAN_GITHUB, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to scan this repository.");
        return;
      }
      setScanResults((prev) => ({
        ...prev,
        [repoFullName]: {
          findingsCount: data.summary?.total ?? 0,
          scanHistoryId: data.scanHistoryId ?? null,
        },
      }));
      setSuccess(`Scan finished for ${repoFullName}: ${data.summary?.total ?? 0} finding(s).`);
    } catch {
      setError("Failed to scan this repository.");
    }
    setScanningRepo(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Scan your source, not just your URL
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect a GitHub repo and run pattern-based secret detection plus an AI code review
          against the actual source.
        </p>
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardContent className="pt-6 space-y-4">
          {status.connected ? (
            <>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 flex items-center gap-4">
                <div className="h-11 w-11 rounded-full bg-foreground flex items-center justify-center shrink-0">
                  <GithubIcon className="h-5 w-5 text-background" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground truncate">
                      {status.githubUsername}
                    </p>
                    <Badge variant="secondary" className="gap-1">
                      <Check className="h-3 w-3" aria-hidden="true" /> Connected
                    </Badge>
                  </div>
                  {status.scopes && (
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      scope: {status.scopes}
                    </p>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setShowDisconnectConfirm(true)}
                  aria-label="Disconnect GitHub"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Unlink className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>

              {repos === null ? (
                <Button variant="outline" onClick={loadRepos} disabled={reposLoading} className="gap-2">
                  {reposLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  )}
                  Load repositories
                </Button>
              ) : repos.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2 max-w-prose leading-relaxed">
                  No repositories found on this account.
                </p>
              ) : (
                <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
                  {repos.map((repo) => {
                    const scanResult = scanResults[repo.fullName];
                    return (
                      <div
                        key={repo.fullName}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                      >
                        {repo.private ? (
                          <Lock className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        ) : (
                          <GithubIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {repo.fullName}
                          </p>
                          {scanResult && (
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                              {scanResult.findingsCount} finding(s) last scan
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={scanningRepo === repo.fullName}
                          onClick={() => handleScan(repo.fullName)}
                          className="shrink-0"
                        >
                          {scanningRepo === repo.fullName ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            "Scan"
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Connect your GitHub account
                </h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  Grants read access to your repos so VulnRadar can scan source for hardcoded
                  secrets, injection risks, and other issues a live URL scan can&apos;t see.
                </p>
              </div>
              <Button
                onClick={() => {
                  setConnecting(true);
                  window.location.href = API.ACCOUNT_GITHUB_CONNECT;
                }}
                disabled={connecting}
                className="bg-foreground text-background hover:bg-foreground/90 gap-2"
              >
                <GithubIcon className="h-4 w-4" />
                {connecting ? "Redirecting..." : "Connect GitHub"}
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
            <AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              {status.githubUsername || "This GitHub account"} will no longer be available for
              repo scans. You can reconnect the same or a different account any time.
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
              {disconnecting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
