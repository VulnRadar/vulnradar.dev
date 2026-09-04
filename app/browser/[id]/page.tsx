"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  Power,
  Loader2,
  X,
  Lock,
  WifiOff,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { cn } from "@/lib/ui/utils";
import {
  API,
  APP_NAME,
  BROWSERBASE_VIEWPORT,
} from "@/lib/config/client-constants";
import { useClientConfig } from "@/lib/hooks/use-client-config";
import type { NetworkRequest } from "@/lib/browserbase/client";
import {
  fitEmbed,
  readViewerFlag,
  writeViewerFlag,
  VIEWER_STORAGE_KEYS,
  type Size,
} from "@/lib/browserbase/viewer-layout";

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

// The resolution POST /api/v3/browser/sessions creates the remote browser at.
// Not a guess about what Browserbase is showing: it is the same constant the
// route sends as browserSettings.viewport.
const REMOTE_VIEWPORT: Size = {
  width: BROWSERBASE_VIEWPORT.WIDTH,
  height: BROWSERBASE_VIEWPORT.HEIGHT,
};

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
      return "text-[hsl(var(--success))]";
    case "POST":
      return "text-primary";
    case "PUT":
    case "PATCH":
      return "text-[hsl(var(--warning))]";
    case "DELETE":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function statusColor(status: number | undefined, failed?: boolean): string {
  if (failed || status === 0) return "text-destructive";
  if (!status) return "text-muted-foreground/40";
  if (status < 300) return "text-[hsl(var(--success))]";
  if (status < 400) return "text-primary";
  if (status < 500) return "text-[hsl(var(--warning))]";
  return "text-destructive";
}

function statusLabel(status: number | undefined, failed?: boolean): string {
  if (failed || status === 0) return "ERR";
  if (!status) return "...";
  return String(status);
}

/** Short devtools-style resource label from a CDP mimeType. */
function resourceType(mimeType: string | undefined): string {
  if (!mimeType) return "";
  const m = mimeType.toLowerCase();
  if (m.includes("html")) return "doc";
  if (m.includes("javascript") || m.includes("ecmascript")) return "js";
  if (m.includes("css")) return "css";
  if (m.includes("json")) return "json";
  if (m.startsWith("image/")) return "img";
  if (m.includes("font")) return "font";
  if (m.startsWith("video/") || m.startsWith("audio/")) return "media";
  if (m.includes("xml")) return "xml";
  return m.split("/")[1]?.slice(0, 4) ?? "";
}

export default function BrowserViewerPage({ params }: PageProps) {
  const { id: sessionId } = use(params);
  const { browserbaseLogsPollIntervalMs: LOGS_POLL_MS } = useClientConfig();
  const searchParams = useSearchParams();
  const rawTargetUrl = searchParams.get("url") || "";
  const targetUrl = /^https?:\/\//i.test(rawTargetUrl) ? rawTargetUrl : null;

  const [session, setSession] = useState<BrowserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
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

  // Network logs dock. Remembered across sessions (VIEWER_STORAGE_KEYS), since
  // reclaiming its width is the difference between a 1440px-wide live view and
  // a 1690px one and re-closing it on every session got old. The initial state
  // is false so the client's first render matches the server's; a mount effect
  // below reads the stored preference, defaulting to open on a wide screen and
  // closed on a phone, where the dock is a sheet over the browser view and
  // opening it on load would bury the thing the user came to watch.
  const [showLogs, setShowLogs] = useState(false);
  const [networkRequests, setNetworkRequests] = useState<NetworkRequest[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const logsPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The remote-session safety notice. Dismissible and remembered: it used to
  // hold a permanent full-width row above the fold on every session, which on a
  // 1080px screen is height the live view could have had.
  const [showNotice, setShowNotice] = useState(false);

  // Measured content box of the stage, and the frame size derived from it. The
  // frame keeps the remote screen's aspect ratio, so Browserbase's viewer has
  // nothing left to letterbox.
  // A callback ref, not a useRef: the stage only mounts once the session has
  // loaded, so a ref object would still be null when a mount-time effect ran
  // and nothing would ever be observed.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
  const embed = useMemo(
    () => fitEmbed(stageSize, REMOTE_VIEWPORT),
    [stageSize],
  );

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
      // Never render the raw runtime message: a stale-deploy HTML response
      // surfaced `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` to
      // the user. The detail belongs in the console, not on screen.
      console.error("[browser-viewer] session fetch failed:", e);
      setError(
        "Could not reach the server to load this session. Try again in a moment.",
      );
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: load()'s setState calls only fire after its async requests resolve, not synchronously in this effect
    void load();
  }, [load]);

  // Restore both remembered toggles. Kept out of the useState initializers so
  // the client's first render matches the server's, then corrected here.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const wide = window.matchMedia?.("(min-width: 640px)").matches ?? true;
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot restore of remembered UI state, runs once on mount */
    setShowLogs(
      readViewerFlag(
        window.localStorage,
        VIEWER_STORAGE_KEYS.networkDock,
        wide,
      ),
    );
    setShowNotice(
      readViewerFlag(
        window.localStorage,
        VIEWER_STORAGE_KEYS.safetyNotice,
        true,
      ),
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const toggleLogs = useCallback(() => {
    setShowLogs((open) => {
      const next = !open;
      writeViewerFlag(
        typeof window === "undefined" ? null : window.localStorage,
        VIEWER_STORAGE_KEYS.networkDock,
        next,
      );
      return next;
    });
  }, []);

  const setNotice = useCallback((visible: boolean) => {
    setShowNotice(visible);
    writeViewerFlag(
      typeof window === "undefined" ? null : window.localStorage,
      VIEWER_STORAGE_KEYS.safetyNotice,
      visible,
    );
  }, []);

  // Track the stage's content box so the frame can be sized from it. The
  // observed element carries no padding of its own, so contentRect is exactly
  // the space the frame may occupy, and its size does not depend on the frame:
  // no feedback loop.
  useEffect(() => {
    if (!stageEl) return;
    const apply = (width: number, height: number) => {
      setStageSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    };

    // No ResizeObserver means no measurement, and no measurement means the
    // frame never mounts at all, so fall back to measuring on window resize
    // rather than showing an empty stage.
    if (typeof ResizeObserver === "undefined") {
      const measure = () => {
        const rect = stageEl.getBoundingClientRect();
        apply(rect.width, rect.height);
      };
      measure();
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      apply(rect.width, rect.height);
    });
    observer.observe(stageEl);
    return () => observer.disconnect();
  }, [stageEl]);

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
  const expiresCritical =
    !ended && virtualExpiresAt !== null && remaining <= 20;

  const viewerUrl = useMemo(() => {
    if (!session) return null;
    const url = session.liveViewerUrl ?? null;
    if (!url) return null;
    return /^https?:\/\//i.test(url) ? url : null;
  }, [session]);

  const displayUrl = targetUrl || session?.url || null;
  // Treat any non-null session as live: the status field isn't always reliable mid-session.
  const isLive = !ended && !loading && !!session;

  const canExtend = isLive && minutesAllocated < MAX_MINUTES;

  function handleExtend() {
    if (!canExtend || virtualExpiresAt === null) return;
    setMinutesAllocated((m) => m + 1);
    setVirtualExpiresAt((t) => (t ?? Date.now()) + 60_000);
  }

  // Poll network logs while the dock is open and session is live.
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
          // 429 = rate limited by Browserbase, back off silently, don't show an error.
          if (res.status === 429) return;
          // The API's own error copy is written for people; a bare
          // `HTTP 502` is not, so it stays in the console and the panel gets a
          // sentence instead.
          const apiError = (data as { error?: string } | null)?.error;
          console.error(
            "[network-panel] logs fetch failed:",
            apiError || `HTTP ${res.status}`,
          );
          setLogsError(
            apiError ||
              "The network log for this session is not available right now.",
          );
          return;
        }
        setLogsError(null);
        const requests =
          (data as { requests?: NetworkRequest[] } | null)?.requests || [];
        if (requests.length > 0) setNetworkRequests(requests);
      } catch (err) {
        console.error("[network-panel] logs fetch error:", err);
        setLogsError(
          "Could not reach the server for this session's network log.",
        );
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
  }, [showLogs, isLive, sessionId, LOGS_POLL_MS]);

  return (
    <div
      // 100dvh, not h-screen. This is the one page in the app that pins
      // itself to exactly the viewport height and clips the overflow, and
      // 100vh on iOS Safari means the LARGE viewport: the bottom ~113px sat
      // under the URL bar with overflow-hidden making it unreachable, which
      // on a phone cut off the bottom of the live browser frame and the
      // network sheet docked to that same edge.
      className="h-[100dvh] flex flex-col bg-background text-foreground overflow-hidden"
    >
      {/* a11y (SC 1.3.1 / 2.4.6): this was the one page in the app with no
          heading of any level, so a screen-reader user landing on it had
          nothing to orient from and no heading to jump to. The visible chrome
          is a brand mark and the target's address, neither of which is a
          heading, so the h1 is sr-only rather than inventing visible copy. */}
      <h1 className="sr-only">Live browser session</h1>

      {/* Top bar. This is the ONLY chrome above the live view now. The frame
          below used to carry a second, fake browser window (traffic-light
          dots and an address bar) inside the real browser's own chrome, which
          read as a mockup and cost a whole row for a URL that is shown here
          instead. */}
      <header className="shrink-0 h-14 border-b border-border/60 bg-card/70 backdrop-blur-md flex items-center px-3 sm:px-4 gap-2 sm:gap-3 z-20">
        <div className="flex items-center gap-2 shrink-0">
          <ThemedLogo
            width={20}
            height={20}
            className="h-5 w-5 shrink-0"
            alt={APP_NAME}
          />
          <span className="text-sm font-semibold text-foreground tracking-tight hidden lg:inline">
            {APP_NAME}
          </span>
        </div>

        {/* The address, as a link out rather than a fake address bar. It is
            the one piece the old browser-chrome row carried that was worth
            keeping, so it moved up here where the row already exists.
            max-w-sm on purpose: a full-width version of this reads as the
            address bar it is replacing. */}
        {displayUrl && (
          <a
            href={displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={displayUrl}
            className="group flex min-w-0 flex-1 max-w-sm items-center gap-1.5 h-8 px-2.5 rounded-md border border-border/50 bg-muted/40 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            <Lock
              className="h-3 w-3 shrink-0 text-[hsl(var(--success))]"
              aria-hidden="true"
            />
            <span className="truncate font-mono">
              {truncateUrl(displayUrl)}
            </span>
            {/* A hover affordance, so it is dead weight on a touch screen
                where the chip is already fighting for width. */}
            <ExternalLink
              className="hidden sm:block h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity ml-auto"
              aria-hidden="true"
            />
          </a>
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Timer + extend, as one control group. The separate LIVE pill that
            used to sit beside it said the same thing the running clock and its
            pulsing dot already say. */}
          {autoCloseCountdown !== null ? (
            <div className="shrink-0 flex items-center h-9 sm:h-8 px-2.5 rounded-md text-xs font-medium tabular-nums bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border border-[hsl(var(--warning))]/20">
              Closing in {autoCloseCountdown}s
            </div>
          ) : virtualExpiresAt !== null && !ended ? (
            <div
              className={cn(
                "shrink-0 flex items-stretch h-9 sm:h-8 rounded-md border overflow-hidden transition-colors",
                expiresCritical
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : expiresSoon
                    ? "border-[hsl(var(--warning))]/25 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]"
                    : "border-border/60 bg-muted/40 text-muted-foreground",
              )}
            >
              <div
                className="flex items-center gap-1.5 px-2.5 text-xs font-medium tabular-nums"
                aria-live="polite"
                title={`Session time remaining: ${formatMmSs(remaining)}`}
              >
                <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                  <span
                    className={cn(
                      "animate-ping absolute inline-flex h-full w-full rounded-full opacity-60",
                      expiresCritical
                        ? "bg-destructive"
                        : expiresSoon
                          ? "bg-[hsl(var(--warning))]"
                          : "bg-[hsl(var(--success))]",
                    )}
                  />
                  <span
                    className={cn(
                      "relative inline-flex rounded-full h-1.5 w-1.5",
                      expiresCritical
                        ? "bg-destructive"
                        : expiresSoon
                          ? "bg-[hsl(var(--warning))]"
                          : "bg-[hsl(var(--success))]",
                    )}
                  />
                </span>
                {formatMmSs(remaining)}
              </div>
              <button
                onClick={handleExtend}
                disabled={!canExtend}
                // a11y (SC 4.1.2): the visible "+1m" is an abbreviation, so the
                // accessible name spells the action out. title stays as the
                // sighted-user tooltip, which is unreachable on touch.
                aria-label="Extend session by 1 minute"
                title={
                  canExtend
                    ? `Add 1 minute (${minutesAllocated}/${MAX_MINUTES} min used)`
                    : "Maximum session time reached (5 min total)"
                }
                className={cn(
                  "flex items-center px-2 border-l text-[11px] font-medium tabular-nums transition-colors",
                  expiresCritical
                    ? "border-destructive/30"
                    : expiresSoon
                      ? "border-[hsl(var(--warning))]/25"
                      : "border-border/60",
                  canExtend
                    ? "hover:bg-foreground/5 hover:text-foreground cursor-pointer"
                    : "opacity-40 cursor-not-allowed",
                )}
              >
                +1m
              </button>
            </div>
          ) : null}

          {/* Re-opens the safety notice once it has been dismissed, so the
            warning is one click away rather than gone for good. */}
          {!ended && !showNotice && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNotice(true)}
              title="Show the remote session notice"
              aria-label="Show the remote session notice"
              className="shrink-0 h-9 w-9 sm:h-8 sm:w-8 p-0 text-[hsl(var(--warning))]/70 hover:text-[hsl(var(--warning))]"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </Button>
          )}

          {isLive && (
            <Button
              variant={showLogs ? "secondary" : "outline"}
              size="sm"
              onClick={toggleLogs}
              title={showLogs ? "Hide network panel" : "Show network panel"}
              aria-pressed={showLogs}
              className={cn(
                "shrink-0 h-9 sm:h-8 gap-1.5 text-xs px-2.5",
                showLogs &&
                  "bg-primary/10 border-primary/30 text-primary hover:bg-primary/15",
              )}
            >
              <Activity className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Network</span>
              {networkRequests.length > 0 && (
                <span
                  className={cn(
                    "rounded-md px-1 py-0.5 text-[10px] tabular-nums",
                    showLogs
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {networkRequests.length}
                </span>
              )}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={endSession}
            disabled={ending || ended}
            className={cn(
              "shrink-0 h-9 sm:h-8 text-xs gap-1.5 px-2.5 transition-colors",
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
            <span className="hidden md:inline">End</span>
          </Button>
        </div>
      </header>

      {/* Safety notice. One compact line, dismissible, and remembered, with
          the header button above bringing it back. */}
      {!ended && showNotice && (
        <div className="shrink-0 flex items-start gap-2 px-3 sm:px-4 py-1.5 bg-[hsl(var(--warning))]/10 border-b border-[hsl(var(--warning))]/15 text-[hsl(var(--warning))] text-[11px] leading-snug">
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0 mt-px"
            aria-hidden="true"
          />
          <p className="min-w-0">
            This browser runs on a cloud server, not on your device. Do not type
            real passwords into it. The session is deleted when you close it.
          </p>
          <button
            onClick={() => setNotice(false)}
            title="Dismiss"
            aria-label="Dismiss the remote session notice"
            // The after: overlay lifts the tap area to 44px without growing a
            // box that has to fit inside a 24px line of text.
            className="relative ml-auto shrink-0 rounded-sm opacity-60 hover:opacity-100 transition-opacity after:absolute after:-inset-3 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[hsl(var(--warning))]/50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main content */}
      <main id="main-content" tabIndex={-1} className="flex-1 flex min-h-0">
        {/* Left: the remote page, given everything that is left */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {ended ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center bg-background">
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 text-[hsl(var(--success))]">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <p className="text-base font-semibold">Session ended</p>
                </div>
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
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center bg-background">
              <div className="flex items-center gap-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                <p className="text-sm font-semibold text-foreground">
                  Connecting to browser session
                </p>
              </div>
              {displayUrl && (
                <p className="text-xs text-muted-foreground font-mono px-3 py-1.5 rounded-md bg-muted/50 border border-border/60 max-w-[260px] truncate">
                  {truncateUrl(displayUrl, 36)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Booting a secure cloud instance...
              </p>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center bg-background">
              <div className="space-y-1.5">
                <div className="flex items-center justify-center gap-2">
                  <WifiOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">
                    Session unavailable
                  </p>
                </div>
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
            // Stage. The padding lives here; the measured child carries none,
            // so its content box is exactly the room the frame may take.
            <div className="flex-1 min-h-0 bg-muted/30 p-2 sm:p-3">
              <div
                ref={setStageEl}
                className="h-full w-full flex items-center justify-center"
              >
                <div
                  // Sized from the remote viewport's real dimensions, scaled to
                  // fit and centred. The frame therefore has the same shape as
                  // the remote screen, so Browserbase's viewer fills it edge to
                  // edge instead of painting black bands to make up the
                  // difference. Whatever is left over is stage, in the app's
                  // own surface colour.
                  style={{ width: embed.width, height: embed.height }}
                  className="relative rounded-lg border border-border/70 bg-background overflow-hidden shadow-[0_10px_40px_-16px_rgba(0,0,0,0.4)]"
                >
                  {embed.width > 0 && (
                    <iframe
                      src={viewerUrl}
                      title="Live interactive browser"
                      className="absolute inset-0 h-full w-full border-0"
                      sandbox="allow-same-origin allow-scripts allow-forms"
                      allow="clipboard-read; clipboard-write"
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center bg-background">
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

        {/* Right: live network dock. From sm up it docks as a right rail that
            narrows on smaller laptops, because every pixel it takes is a pixel
            the live view scales down by. Below that it's a bottom sheet (max
            65vh, rounded top) over the lower half of the screen, leaving the
            live browser visible above it. */}
        {showLogs && isLive && (
          <div className="fixed inset-x-0 bottom-0 top-auto z-30 max-h-[65vh] rounded-t-xl border-t border-border/70 shadow-2xl flex flex-col overflow-hidden bg-card sm:static sm:inset-auto sm:z-auto sm:max-h-none sm:rounded-none sm:shadow-none sm:border-t-0 sm:w-[280px] md:w-[320px] xl:w-[360px] sm:shrink-0 sm:border-l">
            {/* Grab handle -- mobile bottom-sheet affordance, hidden on desktop */}
            <div className="sm:hidden flex justify-center pt-2 pb-1 shrink-0">
              <span className="h-1 w-9 rounded-full bg-border" />
            </div>
            {/* Dock header. Carries the count too, which is why the footer that
                used to repeat it below the list is gone. */}
            <div className="h-10 sm:h-9 border-b border-border/60 flex items-center px-3 gap-2 shrink-0 bg-muted/30">
              <Activity
                className="h-3.5 w-3.5 text-primary shrink-0"
                aria-hidden="true"
              />
              <span className="text-xs font-semibold text-foreground">
                Network
              </span>
              <span
                className="flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--success))]"
                title={`Streaming, refreshes every ${LOGS_POLL_MS / 1000}s`}
              >
                <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--success))] opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[hsl(var(--success))]" />
                </span>
                live
              </span>
              <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
                {networkRequests.length}
              </span>
              <button
                onClick={toggleLogs}
                // The after: overlay lifts the tap area from 32px to 44px
                // without growing the box, which shares a dense panel header
                // with the live indicator.
                className="relative -mr-1 rounded-sm p-2 text-muted-foreground opacity-60 transition-opacity after:absolute after:-inset-1.5 hover:opacity-100 hover:text-foreground sm:p-1 sm:after:hidden focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50"
                title="Hide network panel"
                aria-label="Hide network panel"
              >
                <X className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              </button>
            </div>

            {logsError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
                <AlertTriangle className="h-4 w-4 text-destructive/60" />
                <p className="text-[11px] font-semibold text-foreground">
                  Could not load logs
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {logsError}
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {networkRequests.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full min-h-32 gap-2.5 text-center px-6">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-50" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary/70" />
                    </span>
                    <p className="text-xs font-medium text-muted-foreground/80">
                      Listening for requests
                    </p>
                    <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
                      Requests the remote browser makes appear here as they
                      happen. Interact with the page to see traffic.
                    </p>
                  </div>
                ) : (
                  // Two lines per request rather than four fixed columns. The
                  // path had roughly 170px of a four-column grid and every URL
                  // clipped to a stub; here it gets the dock's full width on
                  // its own line, with the host and resource type below it.
                  networkRequests.map((req) => {
                    const type = resourceType(req.mimeType);
                    return (
                      <div
                        key={req.requestId}
                        className="border-b border-border/20 px-2.5 py-1.5 hover:bg-muted/25 transition-colors"
                        title={req.url}
                      >
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span
                            className={cn(
                              "w-8 shrink-0 text-[10px] font-mono font-semibold",
                              methodColor(req.method),
                            )}
                          >
                            {req.method.length > 4
                              ? req.method.slice(0, 3)
                              : req.method}
                          </span>
                          <span
                            className={cn(
                              "w-7 shrink-0 text-[10px] font-mono font-medium tabular-nums",
                              statusColor(req.status, req.failed),
                            )}
                          >
                            {statusLabel(req.status, req.failed)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px] font-mono text-foreground/85">
                            {req.path}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 min-w-0">
                          <span className="min-w-0 flex-1 truncate text-[10px] font-mono text-muted-foreground/70">
                            {req.host}
                          </span>
                          {type && (
                            <span className="shrink-0 rounded-md bg-muted px-1 text-[9px] font-mono text-muted-foreground/70">
                              {type}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="shrink-0 h-6 border-t border-border/40 bg-card/40 flex items-center justify-center px-4">
        <p className="text-[10px] text-muted-foreground/50 text-center truncate">
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
