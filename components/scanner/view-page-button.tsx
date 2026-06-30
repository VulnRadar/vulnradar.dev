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
    setShowInstructions(false);
    setOpening(true);
    try {
      const res = await fetch(API.BROWSER_SESSIONS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, ttlSeconds: maxTtlSeconds }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          data?.error ||
          `Could not start a browser session (HTTP ${res.status}).`;
        alert(`View Page failed (${res.status}): ${msg}`);
        return;
      }
      const id = data?.session?.id;
      const expiresIn = data?.expiresInSeconds;
      if (!id) {
        alert("View Page failed: BrowserBase returned a session with no id.");
        return;
      }
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
      alert(
        `View Page failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowInstructions(true)}
        disabled={opening}
        className="bg-transparent"
        title="Open a remote browser session (1 min, extendable to 5 min)"
      >
        {opening ? (
          <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
        ) : (
          <Eye className="h-4 w-4 sm:mr-2" />
        )}
        <span className="hidden sm:inline">
          {opening ? "Opening…" : "View Page"}
        </span>
      </Button>

      <Dialog open={showInstructions} onOpenChange={setShowInstructions}>
        <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/60">
            <DialogTitle className="flex items-center gap-2.5 text-base">
              <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Globe className="h-4 w-4 text-primary" />
              </div>
              Live Browser Session
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              A secure remote browser opens and navigates to your target
              automatically. Nothing is saved to your account.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-5 space-y-4">
            {/* Target URL */}
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-muted/40">
              <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              <p className="flex-1 min-w-0 truncate text-sm font-mono text-foreground">
                {trimmed}
              </p>
              <button
                onClick={handleCopy}
                title={copied ? "Copied!" : "Copy URL"}
                className="shrink-0 p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            {/* Info cards */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Timer className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">
                    Session Time
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Starts at 1 minute. Tap{" "}
                  <strong className="text-foreground font-semibold">+</strong>{" "}
                  in the viewer to add 1 minute at a time, up to 5 minutes
                  total.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">
                    Private and Secure
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Runs on a cloud server, not your device. Do not enter real
                  passwords.
                </p>
              </div>
            </div>

            {/* Platform notes */}
            <div className="rounded-lg border border-border/60 divide-y divide-border/60">
              <div className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-muted-foreground">
                <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <span>
                  <strong className="text-foreground">Desktop:</strong> Opens in
                  a popup window. Allow popups if your browser blocks them.
                </span>
              </div>
              <div className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-muted-foreground">
                <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <span>
                  <strong className="text-foreground">Mobile:</strong> Opens in
                  a new tab. Best experienced on a larger screen.
                </span>
              </div>
            </div>
          </div>

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
              {opening ? "Opening..." : "Open Browser"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
