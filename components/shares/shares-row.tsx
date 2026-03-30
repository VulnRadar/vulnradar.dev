"use client"

import { useState } from "react"
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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/ui/utils"
import type { Share } from "./shares-types"
import { getSeverityInfo, formatRelativeTime, getShareUrl } from "./shares-types"

interface SharesRowProps {
  share: Share
  revoking: boolean
  onRevoke: (id: number) => void
  onOpenShareModal: (share: Share) => void
}

export function SharesRow({ share, revoking, onRevoke, onOpenShareModal }: SharesRowProps) {
  const [copied, setCopied] = useState(false)
  const severity = getSeverityInfo(share)
  const SeverityIcon = severity.icon

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(getShareUrl(share.token))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="group flex flex-col sm:grid sm:grid-cols-[1fr,100px,100px,130px,80px] gap-2 sm:gap-4 p-4 sm:px-5 sm:py-4 hover:bg-muted/20 transition-colors">
      {/* URL */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn("flex items-center justify-center w-8 h-8 rounded-lg shrink-0", severity.bg)}>
          <Link2 className={cn("h-4 w-4", severity.color)} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{share.url}</p>
          <p className="text-xs text-muted-foreground font-mono truncate sm:hidden">
            {share.token.slice(0, 14)}...
          </p>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <SeverityIcon className={cn("h-3.5 w-3.5", severity.color)} />
        <span className={cn("text-sm font-medium", severity.color)}>{severity.label}</span>
      </div>

      {/* Issues */}
      <div className="flex items-center">
        <span className="text-sm tabular-nums text-muted-foreground">
          {share.findingsCount} issue{share.findingsCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Shared */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Clock className="h-3.5 w-3.5 hidden sm:block" />
        <span className="text-sm">{formatRelativeTime(new Date(share.scannedAt))}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopy} title="Copy link">
          {copied ? (
            <Check className="h-4 w-4 text-emerald-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onOpenShareModal(share)}>
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`/shared/${share.token}`} target="_blank" rel="noopener noreferrer">
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
  )
}
