"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  Plus,
  Power,
  Loader2,
  X,
  Timer,
  Globe,
  WifiOff,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { cn } from "@/lib/ui/utils";
import { API, APP_NAME } from "@/lib/config/constants";
import type { NetworkRequest } from "@/lib/browserbase/client";

interface BrowserSession {
  id: string;
  status: string;
  url: string;
  liveViewerUrl?: string;
  connectUrl?: string;
  expiresAt?: string;
  region?: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

const AUTO_CLOSE_SECONDS = 5;
const LOGS_POLL_MS = 10_000;

function formatMmSs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function truncateUrl(url: string, max = 52): string {
  try {
    const u = new URL(url);
    const display = u.hostname + (u.pathname !== "/" ? u.pathname : "");
    return display.length > max ? display.slice(0, max) + "..." : display;
  } catch {
    return url.length > max ? url.slice(0, max) + "..." : url;
  }
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-emerald-500";
    case "POST":
      return "text-blue-500";
    case "PUT":
    case "PATCH":
      return "text-amber-500";
    case "DELETE":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function statusColor(status: number | undefined, failed?: boolean): string {
  if (failed || status === 0) return "text-destructive";
  if (!status) return "text-muted-foreground/40";
  if (status < 300) return "text-emerald-500";
  if (status < 400) return "text-blue-500";
  if (status < 500) return "text-amber-500";
  return "text-destructive";
}

function statusLabel(status: number | undefined, failed?: boolean): string {
  if (failed || status === 0) return "ERR";
  if (!status) return "...";
  return String(status);
}

export default function BrowserViewerPage({ params }: PageProps) {
  const { id: sessionId } = use(params);
  const searchParams = useSearchParams();
  const targetUrl = searchParams.get("url") || null;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [session, setSession] = useState<BrowserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [ending, setEnding] = useState(false);
  const [ended, setEnded] = useState(false);
  const [autoCloseCountdown, setAutoCloseCountdown] = useState<number | null>(
    null,
  );
  const endedRef = useRef(false);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [virtualExpiresAt, setVirtualExpiresAt] = useState<number | null>(null);
  const virtualInitialized = useRef(false);
  const [minutesAllocated, setMinutesAllocated] = useState(1);
  const MAX_MINUTES = 5;

  // Network logs sidebar
  const [showLogs, setShowLogs] = useState(false);
  const [networkRequests, setNetworkRequests] = useState<NetworkRequest[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const logsPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `${API.BROWSER_SESSIONS}?id=${encodeURIComponent(sessionId)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Could not load session.");
        setSession(null);
        return;
      }
      setSession((data?.session as BrowserSession) || null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load session.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const endSession = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setEnding(true);
    try {
      await fetch(
        `${API.BROWSER_SESSIONS}?id=${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
      );
    } catch {
      /* best-effort */
    } finally {
      setEnding(false);
      setEnded(true);
      setAutoCloseCountdown(AUTO_CLOSE_SECONDS);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Start the virtual 1-minute countdown the first time a live session loads.
  useEffect(() => {
    if (session && !virtualInitialized.current) {
      virtualInitialized.current = true;
      setVirtualExpiresAt(Date.now() + 60_000);
    }
  }, [session]);

  useEffect(() => {
    if (ended) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ended]);

  // End when the virtual (user-controlled) timer fires.
  useEffect(() => {
    if (ended || virtualExpiresAt === null) return;
    if (now >= virtualExpiresAt) void endSession();
  }, [now, virtualExpiresAt, ended, endSession]);

  // Hard backstop: Browserbase kills the session at its own expiry regardless.
  useEffect(() => {
    if (ended || !session?.expiresAt) return;
    const expiresMs = new Date(session.expiresAt).getTime();
    if (now >= expiresMs) void endSession();
  }, [now, session?.expiresAt, ended, endSession]);

  useEffect(() => {
    if (autoCloseCountdown === null) return;
    if (autoCloseCountdown <= 0) {
      try {
        window.close();
      } catch {
        /* ignore */
      }
      return;
    }
    autoCloseTimerRef.current = setTimeout(
      () => setAutoCloseCountdown((s) => (s === null ? null : s - 1)),
      1000,
    );
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
    };
  }, [autoCloseCountdown]);

  // Release the session when the popup is closed without clicking End.
  useEffect(() => {
    const handler = () => {
      if (endedRef.current) return;
      endedRef.current = true;
      try {
        fetch(`${API.BROWSER_SESSIONS}?id=${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
          keepalive: true,
        });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("beforeunload", handler);
    window.addEventListener("unload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("unload", handler);
    };
  }, [sessionId]);

  const remaining =
    virtualExpiresAt !== null && !ended
      ? Math.max(0, Math.floor((virtualExpiresAt - now) / 1000))
      : 0;
  const expiresSoon = !ended && virtualExpiresAt !== null && remaining <= 60;
  const expiresCritical = !ended && virtualExpiresAt !== null && remaining <= 20;

  const viewerUrl = useMemo(() => {
    if (!session) return null;
    const url = session.liveViewerUrl ?? null;
    if (!url) return null;
    return /^https?:\/\//i.test(url) ? url : null;
  }, [session]);

  const displayUrl = targetUrl || session?.url || null;
  // Treat any non-null session as live — status field isn't always reliable mid-session.
  const isLive = !ended && !loading && !!session;

  const canExtend = isLive && minutesAllocated < MAX_MINUTES;

  function handleExtend() {
    if (!canExtend || virtualExpiresAt === null) return;
    setMinutesAllocated((m) => m + 1);
    setVirtualExpiresAt((t) => (t ?? Date.now()) + 60_000);
  }

  // Poll network logs while the sidebar is open and session is live.
  useEffect(() => {
    if (!showLogs || !isLive) {
      if (logsPollingRef.current) {
        clearInterval(logsPollingRef.current);
        logsPollingRef.current = null;
      }
      return;
    }

    async function fetchLogs() {
      try {
        const res = await fetch(
          `${API.BROWSER_SESSION_LOGS}?id=${encodeURIComponent(sessionId)}`,
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          // 429 = rate limited by Browserbase — back off silently, don't show an error.
          if (res.status === 429) return;
          const msg = (data as { error?: string } | null)?.error || `HTTP ${res.status}`;
          console.error("[network-panel] logs fetch failed:", msg);
          setLogsError(msg);
          return;
        }
        setLogsError(null);
        const requests = (data as { requests?: NetworkRequest[] } | null)?.requests || [];
        if (requests.length > 0) setNetworkRequests(requests);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Fetch error";
        console.error("[network-panel] logs fetch error:", msg);
        setLogsError(msg);
      }
    }

    void fetchLogs();
    logsPollingRef.current = setInterval(fetchLogs, LOGS_POLL_MS);
    return () => {
      if (logsPollingRef.current) {
        clearInterval(logsPollingRef.current);
        logsPollingRef.current = null;
      }
    };
  }, [showLogs, isLive, sessionId]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 h-14 border-b border-border/60 bg-card/70 backdrop-blur-md flex items-center px-3 sm:px-4 gap-2 sm:gap-3 z-20">
        {/* Brand mark */}
        <div className="flex items-center gap-2 shrink-0">
          <ThemedLogo
            width={20}
            height={20}
            className="h-5 w-5 shrink-0"
            alt={APP_NAME}
          />
          <span className="text-sm font-semibold text-foreground tracking-tight hidden md:inline">
            {APP_NAME}
          </span>
          <span className="hidden md:inline text-border/60">·</span>
          <span className="text-[13px] text-muted-foreground hidden md:inline font-medium">
            Live Browser
          </span>
        </div>

        <div className="hidden sm:block w-px h-5 bg-border/70 shrink-0" />

        {/* URL pill */}
        {displayUrl ? (
          <a
            href={displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={displayUrl}
            className="flex-1 min-w-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/50 border border-border/60 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors group"
          >
            <Globe className="h-3 w-3 shrink-0 text-primary/60" />
            <span className="truncate font-mono">{truncateUrl(displayUrl)}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-50 transition-opacity ml-auto" />
          </a>
        ) : (
          <div className="flex-1" />
        )}

        {/* Live pulse */}
        {isLive && (
          <div
            className="shrink-0 hidden sm:flex items-center gap-1.5 text-emerald-500"
            title="Session active"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-[11px] font-medium">Live</span>
          </div>
        )}

        {/* Timer + extend */}
        {autoCloseCountdown !== null ? (
          <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono tabular-nums bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Timer className="h-3 w-3" />
            Closing in {autoCloseCountdown}s
          </div>
        ) : virtualExpiresAt !== null && !ended ? (
          <div className="shrink-0 flex items-center gap-1">
            <div
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono tabular-nums border transition-colors",
                expiresCritical
                  ? "bg-destructive/10 text-destructive border-destructive/20 animate-pulse"
                  : expiresSoon
                    ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                    : "bg-muted/40 text-muted-foreground border-border/60",
              )}
              aria-live="polite"
              title={`Session time remaining: ${formatMmSs(remaining)}`}
            >
              <Timer className="h-3 w-3" />
              {formatMmSs(remaining)}
            </div>
            <button
              onClick={handleExtend}
              disabled={!canExtend}
              title={
                canExtend
                  ? `Add 1 minute (${minutesAllocated}/${MAX_MINUTES} min used)`
                  : "Maximum session time reached (5 min total)"
              }
              className={cn(
                "flex items-center justify-center h-6 w-6 rounded border transition-colors",
                canExtend
                  ? "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  : "border-border/30 bg-muted/20 text-muted-foreground/30 cursor-not-allowed",
              )}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        {/* Network logs toggle */}
        {isLive && (
          <button
            onClick={() => setShowLogs((v) => !v)}
            title={showLogs ? "Hide network logs" : "Show network logs"}
            className={cn(
              "shrink-0 flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-[11px] font-medium transition-colors",
              showLogs
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Activity className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Network</span>
            {networkRequests.length > 0 && (
              <span
                className={cn(
                  "hidden sm:inline px-1 py-0.5 rounded text-[10px] font-mono tabular-nums",
                  showLogs
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {networkRequests.length}
              </span>
            )}
          </button>
        )}

        {/* End session */}
        <Button
          variant="outline"
          size="sm"
          onClick={endSession}
          disabled={ending || ended}
          className={cn(
            "shrink-0 h-8 text-xs gap-1.5 transition-colors",
            !ended && !ending
              ? "border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50 hover:text-destructive"
              : "opacity-40",
          )}
        >
          {ending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Power className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">End</span>
        </Button>
      </header>

      {/* Safety notice — always visible, no close button */}
      {!ended && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/15 text-amber-600 dark:text-amber-400 text-[11px] leading-snug">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>
            <span className="font-semibold">Remote session:</span> this browser
            runs on a secure cloud server, not your device. Do not enter real
            passwords. Your session is deleted when closed.
          </span>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 flex min-h-0">
        {/* Left: browser content */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {ended ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center bg-background">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500/70" />
              </div>
              <div className="space-y-2">
                <p className="text-base font-semibold text-foreground">
                  Session ended
                </p>
                {displayUrl && (
                  <p className="text-xs text-muted-foreground font-mono px-3 py-1.5 rounded-md bg-muted/50 border border-border/60 max-w-[260px] mx-auto truncate">
                    {truncateUrl(displayUrl, 36)}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Closing in{" "}
                  <span className="font-mono font-semibold tabular-nums text-foreground">
                    {autoCloseCountdown ?? AUTO_CLOSE_SECONDS}s
                  </span>
                </p>
              </div>
              <p className="text-xs text-muted-foreground/50 max-w-xs">
                Your session was not recorded or stored by {APP_NAME}.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.close()}
                className="h-8 text-xs gap-1.5"
              >
                <X className="h-3 w-3" />
                Close now
              </Button>
            </div>
          ) : loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center bg-background">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-primary/5 border border-primary/20 flex items-center justify-center shadow-sm">
                  <Globe className="h-7 w-7 text-primary/60" />
                </div>
                <span className="absolute -bottom-1.5 -right-1.5 h-6 w-6 rounded-full bg-background border border-border flex items-center justify-center shadow-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                </span>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">
                  Connecting to browser session
                </p>
                {displayUrl && (
                  <p className="text-xs text-muted-foreground font-mono px-3 py-1.5 rounded-md bg-muted/50 border border-border/60 max-w-[260px] mx-auto truncate">
                    {truncateUrl(displayUrl, 36)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Booting a secure cloud instance...
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center bg-background">
              <div className="w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
                <WifiOff className="h-7 w-7 text-destructive/70" />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-foreground">
                  Session unavailable
                </p>
                <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                  {error}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={load}
                className="h-8 text-xs"
              >
                Try again
              </Button>
            </div>
          ) : viewerUrl ? (
            <iframe
              ref={iframeRef}
              src={viewerUrl}
              title="Live interactive browser"
              className="flex-1 min-h-0 w-full border-0 bg-white"
              sandbox="allow-same-origin allow-scripts allow-forms"
              allow="clipboard-read; clipboard-write"
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center bg-background">
              <div className="w-16 h-16 rounded-2xl bg-muted border border-border flex items-center justify-center">
                <AlertTriangle className="h-7 w-7 text-muted-foreground/60" />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-foreground">
                  Viewer not available
                </p>
                <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                  The live viewer could not be loaded. Try refreshing in a
                  moment.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={load}
                className="h-8 text-xs"
              >
                Refresh
              </Button>
            </div>
          )}
        </div>

        {/* Right: network logs sidebar */}
        {showLogs && isLive && (
          <div className="w-[380px] shrink-0 border-l border-border flex flex-col bg-card/50 overflow-hidden">
            {/* Sidebar header */}
            <div className="h-9 border-b border-border/60 flex items-center px-3 gap-2 shrink-0 bg-card/80">
              <Activity className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">
                Network
              </span>
              {networkRequests.length > 0 && (
                <span className="text-[10px] text-muted-foreground font-mono ml-1">
                  {networkRequests.length} requests
                </span>
              )}
              <button
                onClick={() => setShowLogs(false)}
                className="ml-auto p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                title="Close panel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {logsError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
                <AlertTriangle className="h-4 w-4 text-destructive/60" />
                <p className="text-[11px] font-semibold text-foreground">
                  Could not load logs
                </p>
                <p className="text-[10px] text-muted-foreground font-mono break-all">
                  {logsError}
                </p>
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div className="grid grid-cols-[52px_40px_1fr] border-b border-border/40 bg-muted/30 shrink-0">
                  {["Method", "Status", "Path"].map((h) => (
                    <div
                      key={h}
                      className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide"
                    >
                      {h}
                    </div>
                  ))}
                </div>

                {/* Request list */}
                <div className="flex-1 overflow-y-auto">
                  {networkRequests.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-24 gap-2 text-center px-4">
                      <Activity className="h-4 w-4 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground/60">
                        Waiting for network activity...
                      </p>
                    </div>
                  ) : (
                    networkRequests.map((req) => (
                      <div
                        key={req.requestId}
                        className="grid grid-cols-[52px_40px_1fr] border-b border-border/20 hover:bg-muted/20 transition-colors"
                        title={req.url}
                      >
                        <div className="px-2 py-1.5">
                          <span
                            className={cn(
                              "text-[10px] font-mono font-semibold",
                              methodColor(req.method),
                            )}
                          >
                            {req.method.length > 4
                              ? req.method.slice(0, 3)
                              : req.method}
                          </span>
                        </div>
                        <div className="px-2 py-1.5">
                          <span
                            className={cn(
                              "text-[10px] font-mono font-medium tabular-nums",
                              statusColor(req.status, req.failed),
                            )}
                          >
                            {statusLabel(req.status, req.failed)}
                          </span>
                        </div>
                        <div className="px-2 py-1.5 min-w-0">
                          <p className="text-[10px] font-mono text-muted-foreground truncate">
                            <span className="text-foreground/80">{req.host}</span>
                            <span className="opacity-60">{req.path}</span>
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {/* Sidebar footer */}
            <div className="shrink-0 h-7 border-t border-border/40 bg-card/60 flex items-center px-3">
              <p className="text-[10px] text-muted-foreground/50">
                Refreshes every {LOGS_POLL_MS / 1000}s
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="shrink-0 h-7 border-t border-border/40 bg-card/40 flex items-center justify-center px-4">
        <p className="text-[10px] text-muted-foreground/50 text-center">
          Powered by{" "}
          <a
            href="https://browserbase.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground/70 hover:text-foreground underline-offset-2 hover:underline transition-colors"
          >
            Browserbase
          </a>
          <span className="mx-1.5 opacity-40">·</span>
          Sessions are ephemeral and not stored by {APP_NAME}
        </p>
      </footer>
    </div>
  );
}
