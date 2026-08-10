"use client";

import { useState } from "react";
import {
  ExternalLink,
  Trash2,
  Loader2,
  Share2,
  Link2,
  Clock,
  Copy,
  Check,
  MoreHorizontal,
  Bug,
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
  onRevoke: (id: number) => void;
  onOpenShareModal: (share: Share) => void;
}

export function SharesRow({
  share,
  revoking,
  onRevoke,
  onOpenShareModal,
}: SharesRowProps) {
  const [copied, setCopied] = useState(false);
  const severity = getSeverityInfo(share);
  const SeverityIcon = severity.icon;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(getShareUrl(share.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div className="group relative flex flex-col gap-2 border-l-2 border-transparent py-3 pl-4 pr-4 transition-colors hover:bg-muted/30 sm:grid sm:grid-cols-[1fr,110px,100px,110px,80px] sm:items-center sm:gap-4 sm:py-3.5">
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          severity.bg.replace("/10", ""),
        )}
      />
      {/* URL */}
      <div className="flex min-w-0 items-center gap-3">
        <Link2 aria-hidden className={cn("h-4 w-4 shrink-0", severity.color)} />
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium text-foreground">
            {share.url}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground sm:hidden">
            {share.token.slice(0, 14)}...
          </p>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <SeverityIcon
          aria-hidden
          className={cn("h-3.5 w-3.5", severity.color)}
        />
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
      <div className="flex items-center justify-end gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
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
              className="h-8 w-8"
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
