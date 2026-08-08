"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Eye,
  ExternalLink,
  Globe,
  Loader2,
  Monitor,
  Shield,
  Smartphone,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { API, ROUTES } from "@/lib/config/constants";
import { useAuth } from "@/components/providers/auth-provider";

interface ViewPageButtonProps {
  url: string;
  /** Hard cap for the popup window — must match the server-side clamp. */
  maxTtlSeconds?: number;
}

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?::\d+)?(?:\/.*)?$/;

function isMobile(): boolean {
  return (
    typeof window !== "undefined" &&
    /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    )
  );
}

/**
 * "View Page" button. Opens a remote BrowserBase session in a popup
 * (desktop) or new tab (mobile). Shows an instructions modal first so
 * users know how to navigate to the target URL once the browser opens.
 */
export function ViewPageButton({
  url,
  maxTtlSeconds = 360,
}: ViewPageButtonProps) {
  const { me } = useAuth();
  const [showInstructions, setShowInstructions] = useState(false);
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;
  const trimmed = (url || "").trim();
  if (!trimmed) return null;
  const isHttp = /^https?:\/\//i.test(trimmed);
  const isIp = IPV4_REGEX.test(trimmed);
  if (!isHttp && !isIp) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore — clipboard API unavailable */
    }
  }

  async function openBrowser() {
    setError(null);
    setOpening(true);
    try {
      const res = await fetch(API.BROWSER_SESSIONS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, ttlSeconds: maxTtlSeconds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data?.error ||
            `Could not start a browser session (HTTP ${res.status}).`,
        );
        return;
      }
      const id = data?.session?.id;
      const expiresIn = data?.expiresInSeconds;
      if (!id) {
        setError("BrowserBase returned a session with no id.");
        return;
      }
      setShowInstructions(false);
      const qs = new URLSearchParams();
      if (expiresIn) qs.set("expiresIn", String(expiresIn));
      if (trimmed) qs.set("url", trimmed);
      const href = `${ROUTES.BROWSER(id)}?${qs.toString()}`;

      if (isMobile()) {
        const a = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        const popup = window.open(
          href,
          `vulnradar-browser-${id}`,
          "width=1920,height=1080",
        );
        if (popup) {
          try {
            popup.focus();
          } catch {
            /* some browsers refuse programmatic focus from a different origin */
          }
        } else {
          const a = document.createElement("a");
          a.href = href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      }
    } catch (err) {
      console.error("[view-page] failed to open browser session:", err);
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          setShowInstructions(true);
        }}
        disabled={opening}
        className="gap-2 bg-transparent"
        title="Open a remote browser session (1 min, extendable to 5 min)"
        aria-label={
          opening
            ? "Opening a live browser session"
            : "View page in a live browser session"
        }
      >
        {opening ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">
          {opening ? "Opening…" : "View page"}
        </span>
      </Button>

      <Dialog open={showInstructions} onOpenChange={setShowInstructions}>
        <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/60">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Globe aria-hidden className="h-4 w-4 shrink-0 text-primary" />
              Live browser session
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              A secure remote browser opens and navigates to your target
              automatically. Nothing is saved to your account.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-5 space-y-4">
            {/* Target URL */}
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-border bg-muted/40">
              <Globe
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
              />
              <p className="flex-1 min-w-0 truncate text-sm font-mono text-foreground">
                {trimmed}
              </p>
              <button
                type="button"
                onClick={handleCopy}
                aria-label={copied ? "Copied" : "Copy URL"}
                title={copied ? "Copied" : "Copy URL"}
                className="shrink-0 p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <Check
                    aria-hidden
                    className="h-3.5 w-3.5 text-[hsl(var(--success))]"
                  />
                ) : (
                  <Copy aria-hidden className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {/* Session facts, read as prose lines rather than a matched pair of icon cards */}
            <div className="rounded-md border border-border/60 divide-y divide-border/60">
              <div className="flex items-start gap-2.5 px-3 py-2.5 text-xs text-muted-foreground">
                <Timer
                  aria-hidden
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                />
                <span>
                  <strong className="text-foreground">Session time:</strong>{" "}
                  starts at 1 minute. Tap{" "}
                  <strong className="text-foreground font-semibold">+</strong>{" "}
                  in the viewer to add a minute at a time, up to 5 minutes
                  total.
                </span>
              </div>
              <div className="flex items-start gap-2.5 px-3 py-2.5 text-xs text-muted-foreground">
                <Shield
                  aria-hidden
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                />
                <span>
                  <strong className="text-foreground">
                    Private and secure:
                  </strong>{" "}
                  runs on a cloud server, not your device. Do not enter real
                  passwords.
                </span>
              </div>
              <div className="flex items-start gap-2.5 px-3 py-2.5 text-xs text-muted-foreground">
                <Monitor
                  aria-hidden
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                />
                <span>
                  <strong className="text-foreground">Desktop:</strong> opens in
                  a popup window. Allow popups if your browser blocks them.
                </span>
              </div>
              <div className="flex items-start gap-2.5 px-3 py-2.5 text-xs text-muted-foreground">
                <Smartphone
                  aria-hidden
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                />
                <span>
                  <strong className="text-foreground">Mobile:</strong> opens in
                  a new tab. Best experienced on a larger screen.
                </span>
              </div>
            </div>
          </div>

          {error && (
            <div className="mx-6 mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <span className="min-w-0">{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="px-6 pb-5 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setShowInstructions(false)}
              disabled={opening}
            >
              Cancel
            </Button>
            <Button onClick={openBrowser} disabled={opening} className="gap-2">
              {opening ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
              {opening ? "Opening..." : "Open browser"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
