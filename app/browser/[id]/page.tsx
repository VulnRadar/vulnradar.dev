"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ExternalLink,
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
    return display.length > max ? display.slice(0, max) + "…" : display;
  } catch {
    return url.length > max ? url.slice(0, max) + "…" : url;
  }
}

function log(stage: string, payload: Record<string, unknown>): void {
  try {
    console.log(`[browser-viewer] ${stage} ${JSON.stringify(payload)}`);
  } catch {
    /* ignore */
  }
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
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const endedRef = useRef(false);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (ended) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ended]);

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
  // sendBeacon always sends POST (which would create a new session!),
  // so we use fetch + keepalive to send DELETE instead.
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

  const expiresAtMs = session?.expiresAt
    ? new Date(session.expiresAt).getTime()
    : null;
  const remaining =
    expiresAtMs && !ended
      ? Math.max(0, Math.floor((expiresAtMs - now) / 1000))
      : 0;
  const expiresSoon = !ended && expiresAtMs !== null && remaining <= 60;
  const expiresCritical = !ended && expiresAtMs !== null && remaining <= 20;

  const viewerUrl = useMemo(() => {
    if (!session) return null;
    const url = session.liveViewerUrl ?? null;
    if (!url) return null;
    return /^https?:\/\//i.test(url) ? url : null;
  }, [session]);

  const displayUrl = targetUrl || session?.url || null;
  const isLive = !ended && !loading && session?.status === "RUNNING";

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
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
          <span className="hidden md:inline text-border">·</span>
          <span className="text-[13px] text-muted-foreground hidden md:inline font-medium">
            Live Browser
          </span>
        </div>

        {/* Vertical divider */}
        <div className="hidden sm:block w-px h-5 bg-border/70 shrink-0" />

        {/* URL pill — takes remaining space, truncates cleanly */}
        {displayUrl ? (
          <a
            href={displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={displayUrl}
            className="flex-1 min-w-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/50 border border-border/60 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors group"
          >
            <Globe className="h-3 w-3 shrink-0 text-primary/60" />
            <span className="truncate font-mono">
              {truncateUrl(displayUrl)}
            </span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-50 transition-opacity ml-auto" />
          </a>
        ) : (
          <div className="flex-1" />
        )}

        {/* Live pulse indicator */}
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

        {/* Session timer */}
        {autoCloseCountdown !== null ? (
          <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono tabular-nums bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Timer className="h-3 w-3" />
            Closing in {autoCloseCountdown}s…
          </div>
        ) : expiresAtMs !== null && !ended ? (
          <div
            className={cn(
              "shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono tabular-nums border transition-colors",
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
        ) : null}

        {/* End session button */}
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

        {/* Close window */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.close()}
          className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Close window"
          title="Close window"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* ── Safety notice (slim, dismissible) ────────────────────────────── */}
      {!noticeDismissed && !ended && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/15 text-amber-600 dark:text-amber-400 text-[11px] leading-snug">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>
            <span className="font-semibold">Remote session</span> — this browser
            runs on a secure cloud server, not your device. Do not enter real
            passwords. Your session is automatically deleted when closed.
          </span>
          <button
            onClick={() => setNoticeDismissed(true)}
            className="ml-auto shrink-0 p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-h-0">
        {ended ? (
          /* ── Session ended ── */
          <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center bg-background">
            <div className="w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center shadow-sm">
              <CheckCircle2 className="h-7 w-7 text-muted-foreground/60" />
            </div>
            <div className="space-y-1.5">
              <p className="text-base font-semibold text-foreground">
                Session ended
              </p>
              <p className="text-sm text-muted-foreground">
                This window will close automatically in{" "}
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {autoCloseCountdown ?? AUTO_CLOSE_SECONDS}s
                </span>
              </p>
            </div>
            <p className="text-xs text-muted-foreground/50 max-w-xs">
              No browsing history was recorded. Nothing was saved to your
              account.
            </p>
          </div>
        ) : loading ? (
          /* ── Loading ── */
          <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center bg-background">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center shadow-sm">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-foreground">
                Starting your browser session
              </p>
              <p className="text-xs text-muted-foreground">
                Connecting to a secure cloud instance…
              </p>
            </div>
          </div>
        ) : error ? (
          /* ── Error ── */
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
          /* ── Live iframe ── */
          <iframe
            ref={iframeRef}
            src={viewerUrl}
            title="Live interactive browser"
            className="flex-1 min-h-0 w-full border-0 bg-white"
            sandbox="allow-same-origin allow-scripts allow-forms"
            allow="clipboard-read; clipboard-write"
            onLoad={() => log("iframe:load", { ok: true })}
            onError={() => log("iframe:error", { note: "viewer load failed" })}
          />
        ) : (
          /* ── No viewer URL ── */
          <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center bg-background">
            <div className="w-16 h-16 rounded-2xl bg-muted border border-border flex items-center justify-center">
              <AlertTriangle className="h-7 w-7 text-muted-foreground/60" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-foreground">
                Viewer not available
              </p>
              <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                The live viewer could not be retrieved for this session. The
                session may still be starting — try refreshing.
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
      </main>

      {/* ── Footer credit ────────────────────────────────────────────────── */}
      <footer className="shrink-0 h-7 border-t border-border/40 bg-card/40 flex items-center justify-center px-4">
        <p className="text-[10px] text-muted-foreground/50 text-center">
          Live browser powered by{" "}
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
