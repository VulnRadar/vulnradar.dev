"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Eye,
  ExternalLink,
  Loader2,
  Monitor,
  Smartphone,
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

function log(stage: string, payload: Record<string, unknown>): void {
  try {
    console.log(`[view-page] ${stage} ${JSON.stringify(payload)}`);
  } catch {
    /* ignore */
  }
}

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
  maxTtlSeconds = 300,
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

  const ttlMinutes = Math.round(maxTtlSeconds / 60);

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
    log("click", { url, ttl: maxTtlSeconds, hasUser: !!me });
    setOpening(true);
    try {
      const res = await fetch(API.BROWSER_SESSIONS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, ttlSeconds: maxTtlSeconds }),
      });
      log("response", { status: res.status, ok: res.ok });
      const data = await res.json();
      log("response:body", {
        hasSession: !!data?.session,
        id: data?.session?.id?.slice?.(0, 12),
        hasLiveViewerUrl: !!data?.session?.liveViewerUrl,
        liveViewerUrl: data?.session?.liveViewerUrl?.slice?.(0, 80),
        error: data?.error,
      });
      if (!res.ok) {
        const msg =
          data?.error ||
          `Could not start a browser session (HTTP ${res.status}). The server may not have BrowserBase configured.`;
        alert(
          `View Page failed (${res.status}): ${msg}\n\nOpen the browser console for the full request/response log.`,
        );
        return;
      }
      const id = data?.session?.id;
      const expiresIn = data?.expiresInSeconds;
      if (!id) {
        alert(
          "View Page failed: BrowserBase returned a session with no id.\n\nOpen the browser console for the full request/response log.",
        );
        return;
      }
      const qs = new URLSearchParams();
      if (expiresIn) qs.set("expiresIn", String(expiresIn));
      if (trimmed) qs.set("url", trimmed);
      const href = `${ROUTES.BROWSER(id)}?${qs.toString()}`;
      log("open:popup", { href, mobile: isMobile() });

      if (isMobile()) {
        // Mobile browsers block window.open popups — open in a new tab instead.
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
          // Popup blocked — fall back to new tab.
          log("popup:blocked:newtab", { href });
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
      log("outer:error", {
        message: err instanceof Error ? err.message : String(err),
      });
      alert(
        `View Page failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }\n\nOpen the browser console for the full request/response log.`,
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
        title="Open a 5-minute remote browser session to view this site"
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              Open in Live Browser
            </DialogTitle>
            <DialogDescription>
              A remote browser session will open and automatically navigate to
              your target URL.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 pt-1">
            {/* URL copy row */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Your target URL
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 rounded-md border border-border bg-muted px-3 py-2">
                  <p className="truncate text-sm font-mono text-foreground">
                    {trimmed}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 h-9 w-9"
                  onClick={handleCopy}
                  title={copied ? "Copied!" : "Copy URL"}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Steps */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                What to expect
              </p>
              <ol className="space-y-2">
                {[
                  <>
                    Click{" "}
                    <strong className="text-foreground font-medium">
                      Open Browser
                    </strong>{" "}
                    below — the session boots and navigates to your URL
                    automatically.
                  </>,
                  <>
                    If the page doesn&apos;t load, paste the URL above into the
                    address bar and press{" "}
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">
                      Enter
                    </kbd>
                    .
                  </>,
                ].map((step, i) => (
                  <li
                    key={i}
                    className="flex gap-3 text-sm text-muted-foreground"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted border border-border text-xs font-medium text-foreground">
                      {i + 1}
                    </span>
                    <span className="leading-5">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Platform / mobile note */}
            <div className="rounded-md border border-border bg-muted/50 px-3 py-2.5 space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Monitor className="h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong className="text-foreground">Desktop:</strong> Opens in
                  a popup window. Allow popups if your browser blocks them.
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Smartphone className="h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong className="text-foreground">Mobile:</strong> Opens in
                  a new tab. Best experienced on a larger screen.
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Eye className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Session expires after {ttlMinutes}{" "}
                  {ttlMinutes === 1 ? "minute" : "minutes"} and is not stored by
                  VulnRadar.
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
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
              {opening ? "Opening…" : "Open Browser"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
