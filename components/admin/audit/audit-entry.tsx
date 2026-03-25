"use client"

import { ChevronDown, ChevronUp, Globe } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { UserAvatar } from "../shared/user-avatar"
import { ActionBadge } from "../shared/action-badge"
import { getActionSentence, formatRelativeTime } from "../utils"
import type { AuditEntry as AuditEntryType } from "../types"

interface AuditEntryProps {
  entry: AuditEntryType
  className?: string
}

export function AuditEntry({ entry: log, className }: AuditEntryProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cn(
      "group relative",
      className
    )}>
      {/* Timeline line */}
      <div className="absolute left-4 top-10 bottom-0 w-px bg-border group-last:hidden" />
      
      {/* Entry card */}
      <div className="relative flex gap-3 p-4 rounded-lg hover:bg-muted/30 transition-colors">
        {/* Avatar */}
        <div className="relative z-10">
          <UserAvatar
            name={log.admin_name}
            email={log.admin_email}
            size="sm"
            avatarUrl={log.admin_avatar_url}
          />
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground leading-relaxed">
                {getActionSentence(log)}
              </p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <ActionBadge action={log.action} />
                <span className="text-[10px] text-muted-foreground">
                  {formatRelativeTime(new Date(log.created_at))}
                </span>
              </div>
            </div>
            
            {/* Expand button */}
            {(log.details || log.ip_address) && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground shrink-0"
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            )}
          </div>
          
          {/* Target user */}
          {log.target_email && (
            <div className="flex items-center gap-2 mt-2 p-2 rounded-md bg-muted/30 border border-border">
              <UserAvatar
                name={log.target_name}
                email={log.target_email}
                size="xs"
                avatarUrl={log.target_avatar_url}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">
                  {log.target_name || log.target_email.split("@")[0]}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">{log.target_email}</p>
              </div>
            </div>
          )}
          
          {/* Expanded details */}
          {expanded && (
            <div className="mt-3 p-3 rounded-md bg-muted/30 border border-border text-xs space-y-2 animate-in slide-in-from-top-1">
              {log.details && (
                <div>
                  <p className="text-muted-foreground font-medium mb-1">Details</p>
                  <p className="text-foreground whitespace-pre-wrap">{log.details}</p>
                </div>
              )}
              {log.ip_address && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Globe className="h-3 w-3" />
                  <span>{log.ip_address}</span>
                </div>
              )}
              <div className="text-muted-foreground">
                {new Date(log.created_at).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
