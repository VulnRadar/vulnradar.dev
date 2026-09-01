"use client";

import { useState } from "react";
import {
  ExternalLink,
  Trash2,
  Loader2,
  Share2,
  Clock,
  Copy,
  Check,
  MoreHorizontal,
  Bug,
  Globe,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/ui/utils";
import { copyToClipboard } from "@/lib/ui/clipboard";
import type { Share } from "./shares-types";
import {
  getSeverityInfo,
  formatRelativeTime,
  formatExpiry,
  getShareUrl,
} from "./shares-types";

interface SharesRowProps {
  share: Share;
  revoking: boolean;
  togglingPubliclyListed: boolean;
  onRevoke: (id: number) => void;
  onOpenShareModal: (share: Share) => void;
  onTogglePubliclyListed: (share: Share) => void;
}

export function SharesRow({
  share,
  revoking,
  togglingPubliclyListed,
  onRevoke,
  onOpenShareModal,
  onTogglePubliclyListed,
}: SharesRowProps) {
  const [copied, setCopied] = useState(false);
  const severity = getSeverityInfo(share);

  async function handleCopy() {
    if (await copyToClipboard(getShareUrl(share.token))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="group relative flex flex-col gap-2 border-l-2 border-transparent py-3 pl-4 pr-4 transition-colors hover:bg-muted/30 sm:grid sm:grid-cols-[1fr_110px_100px_110px_80px] sm:items-center sm:gap-4 sm:py-3.5">
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          severity.bg.replace("/10", ""),
        )}
      />
      {/* URL */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium text-foreground">
            {share.url}
          </p>
          <p className="flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
            <span className="sm:hidden">{share.token.slice(0, 14)}...</span>
            {share.publiclyListed && (
              <span
                className="inline-flex items-center gap-1 font-sans normal-case text-[10px] text-primary"
                title="Listed in the public /public-scans directory"
              >
                <Globe aria-hidden className="h-2.5 w-2.5" />
                Public
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <span className={cn("text-sm font-medium", severity.color)}>
          {severity.label}
        </span>
      </div>

      {/* Findings */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Bug aria-hidden className="h-3.5 w-3.5" />
        <span className="text-sm tabular-nums text-muted-foreground">
          {share.findingsCount}{" "}
          {share.findingsCount === 1 ? "finding" : "findings"}
        </span>
      </div>

      {/* Shared */}
      <div className="flex flex-col gap-0.5 text-muted-foreground">
        <span className="flex items-center gap-1.5 text-sm">
          <Clock aria-hidden className="hidden h-3.5 w-3.5 sm:block" />
          {formatRelativeTime(new Date(share.scannedAt))}
        </span>
        <span className="text-xs">{formatExpiry(share.expiresAt)}</span>
      </div>

      {/* Actions */}
      {/* 32px buttons 4px apart are under the touch minimum and too close to
          hit reliably, and the overflow menu is the only route to Revoke
          Access. Both get a 44px target and more separation below sm. */}
      <div className="flex items-center justify-end gap-2 sm:gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 sm:h-8 sm:w-8"
          onClick={handleCopy}
          title="Copy link"
          aria-label="Copy share link"
          aria-pressed={copied}
        >
          {copied ? (
            <Check className="h-4 w-4 text-[hsl(var(--success))]" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 sm:h-8 sm:w-8"
              aria-label="Open share actions menu"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onOpenShareModal(share)}>
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a
                href={`/shared/${share.token}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Report
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onTogglePubliclyListed(share)}
              disabled={togglingPubliclyListed}
            >
              {togglingPubliclyListed ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : share.publiclyListed ? (
                <EyeOff className="h-4 w-4 mr-2" />
              ) : (
                <Globe className="h-4 w-4 mr-2" />
              )}
              {share.publiclyListed ? "Unlist" : "List publicly"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onRevoke(share.id)}
              disabled={revoking}
            >
              {revoking ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Revoke Access
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
