"use client";

import { useState } from "react";
import {
  Link2,
  Check,
  Clock,
  Copy,
  Loader2,
  Mail,
  MessageCircle,
  Globe,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { APP_NAME } from "@/lib/config/client-constants";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/ui/utils";
import { copyToClipboard } from "@/lib/ui/clipboard";
import { EXPIRY_PRESETS, activePreset, formatExpiry } from "./share-expiry";

interface ShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shareUrl: string;
  title?: string;
  /** Whether this share also appears in the public, unauthenticated
   *  /public-scans directory (findings and all) -- distinct from the link
   *  itself, which anyone with the URL can already view either way. */
  publiclyListed?: boolean;
  onPubliclyListedChange?: (next: boolean) => void;
  togglingPubliclyListed?: boolean;
  /** ISO timestamp the link stops working, or null when it never expires. */
  expiresAt?: string | null;
  /** Omitted for a viewer who cannot change the share (the control is hidden
   *  rather than shown disabled). `null` means "never expires". */
  onExpiryChange?: (days: number | null) => void;
  updatingExpiry?: boolean;
}

const SHARE_OPTIONS = [
  {
    id: "x",
    label: "X",
    icon: () => (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    color: "bg-foreground text-background hover:bg-foreground/90",
    getUrl: (url: string, title: string) =>
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: () => (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
    color: "bg-[#1877F2] text-white hover:bg-[#1877F2]/90",
    getUrl: (url: string) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: () => (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
    color: "bg-[#0A66C2] text-white hover:bg-[#0A66C2]/90",
    getUrl: (url: string) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    color: "bg-[#25D366] text-white hover:bg-[#25D366]/90",
    getUrl: (url: string, title: string) =>
      `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
  },
  {
    id: "email",
    label: "Email",
    icon: Mail,
    color: "bg-muted text-foreground hover:bg-muted/80",
    getUrl: (url: string, title: string) =>
      `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`Check out this ${APP_NAME} scan report:\n\n${url}`)}`,
  },
];

export function ShareModal({
  open,
  onOpenChange,
  shareUrl,
  title = `${APP_NAME} Scan Report`,
  publiclyListed,
  onPubliclyListedChange,
  togglingPubliclyListed = false,
  expiresAt = null,
  onExpiryChange,
  updatingExpiry = false,
}: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const selectedDays = activePreset(expiresAt);
  const expired = Boolean(expiresAt && new Date(expiresAt) <= new Date());

  async function handleCopy() {
    const success = await copyToClipboard(shareUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleShare(option: (typeof SHARE_OPTIONS)[number]) {
    const url = option.getUrl(shareUrl, title);
    window.open(url, "_blank", "noopener,noreferrer,width=600,height=400");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* variant="shell", so the header stays put and only the body scrolls.
          As a single padded box this modal lost everything past its max-height
          on a short viewport (a landscape phone, a small laptop) with no way to
          reach it. The surface, the padding, the divider and the max-height are
          the grammar's now, so nothing here restates them. */}
      <DialogContent variant="shell" size="sm">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <Share2 aria-hidden className="h-4 w-4 shrink-0 text-primary" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>
            Anyone with this link can view the report. No account needed.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-5">
          {publiclyListed !== undefined && onPubliclyListedChange && (
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
              <div className="min-w-0">
                <Label
                  htmlFor="share-publicly-listed"
                  className="text-sm font-medium text-foreground"
                >
                  List in Public Scans
                </Label>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {publiclyListed
                    ? "This scan's findings are also visible to anyone on the public Public Scans directory, not just people with this link."
                    : "Off: only someone with this exact link can view the report."}
                </p>
              </div>
              <Switch
                id="share-publicly-listed"
                checked={publiclyListed}
                disabled={togglingPubliclyListed}
                onCheckedChange={onPubliclyListedChange}
                className="mt-0.5 shrink-0"
              />
            </div>
          )}

          {/* URL input with copy */}
          {/* Stacked below sm. An <input> resists shrinking below its
              intrinsic size (roughly 180px, plus 48px of padding here) and the
              Copy button is pinned at min-w-[92px], so the pair had about
              330px of hard minimum inside a dialog a phone renders at ~290. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Link2
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                readOnly
                value={shareUrl}
                aria-label="Share link"
                className="w-full truncate rounded-md border border-input bg-muted/30 py-2.5 pl-9 pr-3 font-mono text-base sm:text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>
            <Button
              onClick={handleCopy}
              className={cn(
                "w-full gap-2 font-medium transition-colors sm:w-auto sm:min-w-[92px]",
                copied &&
                  "bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]",
              )}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy
                </>
              )}
            </Button>
          </div>

          {/* Link expiry. Presets rather than a date picker: the route only
              accepts 7, 30, 90 or never, so a free date field would mostly
              produce 400s. */}
          {onExpiryChange && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Clock
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                />
                <span
                  id="share-expiry-label"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Link expires
                </span>
                {updatingExpiry && (
                  <Loader2
                    aria-hidden
                    className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                  />
                )}
              </div>
              <div
                role="radiogroup"
                aria-labelledby="share-expiry-label"
                className="flex flex-wrap gap-1.5"
              >
                {EXPIRY_PRESETS.map((preset) => {
                  const active = selectedDays === preset.days;
                  // The guard here used to be `if (!active)`, which combined
                  // with activePreset's old always-pick-something behaviour to
                  // make the highlighted button inert on exactly the links that
                  // needed changing (see the docblock on activePreset). It is
                  // now narrowed to the one press that genuinely cannot change
                  // anything: Never on a link that already has no expiry.
                  // Pressing a timed preset ALWAYS re-issues it, so clicking
                  // "30 days" on a 30-day link with three days left restarts
                  // the window rather than doing nothing.
                  const isNoOp = preset.days === null && !expiresAt;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={updatingExpiry}
                      onClick={() => {
                        if (!isNoOp) onExpiryChange(preset.days);
                      }}
                      className={cn(
                        // a11y (SC 2.5.5): px-3 py-1.5 on text-xs was a 26px
                        // target, the smallest interactive element left in the
                        // product. Same h-11-down-to-a-denser-size-at-sm shape
                        // the rest of the app now uses.
                        "flex h-11 flex-1 basis-16 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors sm:h-9",
                        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {expiresAt
                  ? expired
                    ? `This link stopped working on ${formatExpiry(expiresAt)}. Pick a window to issue a fresh one.`
                    : `Stops working on ${formatExpiry(expiresAt)}. Picking a window restarts it from today, and Never keeps the link open until you revoke it.`
                  : "This link keeps working until you revoke it."}
              </p>
            </div>
          )}

          {/* Platform shortcuts. Brand marks, not decorative icons, so they
              keep their own colours. border-input, not border-border: these
              are controls, and --border is a divider tone that measures about
              1.2:1 against the card it sits on. */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Or send it directly
            </span>
            <div className="flex flex-wrap gap-1.5">
              {SHARE_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleShare(option)}
                    aria-label={`Share via ${option.label}`}
                    className="group flex flex-1 basis-16 flex-col items-center gap-1.5 rounded-md border border-input py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-md",
                        option.color,
                      )}
                    >
                      <Icon />
                    </span>
                    <span className="text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Web share API button (if available) */}
          {typeof navigator !== "undefined" && navigator.share && (
            <Button
              variant="outline"
              className="w-full gap-2 bg-transparent"
              onClick={() => {
                navigator
                  .share({
                    title,
                    url: shareUrl,
                  })
                  .catch(() => {});
              }}
            >
              <Globe className="h-4 w-4" />
              More sharing options
            </Button>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
