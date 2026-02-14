"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Server, ShieldCheck, ShieldX } from "lucide-react"
import { cn } from "@/lib/utils"

interface ResponseHeadersProps {
  headers: Record<string, string>
}

const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "cross-origin-embedder-policy",
  "x-xss-protection",
  "x-dns-prefetch-control",
]

export function ResponseHeaders({ headers }: ResponseHeadersProps) {
  const [expanded, setExpanded] = useState(false)

  const entries = Object.entries(headers)
  if (entries.length === 0) return null

  const securityPresent = SECURITY_HEADERS.filter((h) =>
    entries.some(([k]) => k.toLowerCase() === h)
  )
  const securityMissing = SECURITY_HEADERS.filter(
    (h) => !entries.some(([k]) => k.toLowerCase() === h)
  )

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <Server className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground flex-1">
          Response Headers
        </span>
        <span className="text-xs text-muted-foreground">
          {securityPresent.length}/{SECURITY_HEADERS.length} security headers present
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Security headers summary */}
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground mb-2">Security Headers</p>
            <div className="flex flex-wrap gap-1.5">
              {securityPresent.map((h) => (
                <span
                  key={h}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                >
                  <ShieldCheck className="h-2.5 w-2.5" />
                  {h}
                </span>
              ))}
              {securityMissing.map((h) => (
                <span
                  key={h}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
                >
                  <ShieldX className="h-2.5 w-2.5" />
                  {h}
                </span>
              ))}
            </div>
          </div>

          {/* All headers */}
          <div className="max-h-80 overflow-y-auto">
            {entries.map(([key, value]) => {
              const isSecurity = SECURITY_HEADERS.includes(key.toLowerCase())
              return (
                <div
                  key={key}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-3 px-4 py-2 border-b border-border/50 last:border-b-0",
                    isSecurity && "bg-emerald-500/5",
                  )}
                >
                  <span className="text-xs font-mono font-semibold text-foreground shrink-0 sm:w-56 sm:text-right break-all">
                    {key}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground break-all flex-1">
                    {value}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
