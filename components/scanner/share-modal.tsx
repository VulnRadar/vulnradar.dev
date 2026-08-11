"use client";

import { useState } from "react";
import {
  Link2,
  Check,
  Copy,
  Mail,
  MessageCircle,
  Globe,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { APP_NAME } from "@/lib/config/constants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/ui/utils";

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
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy fallback
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
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
}: ShareModalProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const success = await copyText(shareUrl);
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
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden bg-card border-border">
        <DialogHeader className="border-b border-border/50 p-5 pb-4">
          <div className="flex items-center gap-2.5">
            <Share2 aria-hidden className="h-4 w-4 shrink-0 text-primary" />
            <DialogTitle className="text-base font-semibold">
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            Anyone with this link can view the report. No account needed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 p-5">
          {publiclyListed !== undefined && onPubliclyListedChange && (
            <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/30 p-3">
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
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Link2
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                readOnly
                value={shareUrl}
                aria-label="Share link"
                className="w-full truncate rounded-md border border-border bg-muted/30 py-2.5 pl-9 pr-3 font-mono text-base sm:text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>
            <Button
              onClick={handleCopy}
              className={cn(
                "min-w-[92px] gap-2 font-medium transition-colors",
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

          {/* Platform shortcuts. Brand marks, not decorative icons, so they keep their own colours. */}
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
                    className="group flex flex-1 basis-16 flex-col items-center gap-1.5 rounded-md border border-border py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
