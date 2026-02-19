"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw, CheckCircle2, AlertTriangle, Sparkles, HelpCircle } from "lucide-react"

type VersionStatus = "up-to-date" | "behind" | "ahead" | "unknown"

interface VersionInfo {
  current: string
  engine: string
  latest: string | null
  status: VersionStatus
  message: string
  release_url: string
}

export function VersionCheck() {
  const [info, setInfo] = useState<VersionInfo | null>(null)
  const [loading, setLoading] = useState(false)

  async function check() {
    setLoading(true)
    try {
      const res = await fetch("/api/version")
      const data = await res.json()
      setInfo(data)
    } catch {
      setInfo(null)
    }
    setLoading(false)
  }

  const statusConfig: Record<VersionStatus, { icon: typeof CheckCircle2; color: string; bg: string; border: string }> = {
    "up-to-date": { icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    behind: { icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    ahead: { icon: Sparkles, color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
    unknown: { icon: HelpCircle, color: "text-muted-foreground", bg: "bg-muted", border: "border-border" },
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <RefreshCw className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Version Check</span>
      </div>

      <div className="p-4">
        {!info && !loading && (
          <div className="flex flex-col items-center gap-3 py-4">
            <p className="text-xs text-muted-foreground text-center">
              Check if your VulnRadar instance is up to date.
            </p>
            <Button variant="outline" size="sm" onClick={check}>
              Check for Updates
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-6">
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Checking...</span>
          </div>
        )}

        {info && !loading && (() => {
          const cfg = statusConfig[info.status]
          const Icon = cfg.icon
          return (
            <div className="flex flex-col gap-3">
              {/* Status badge */}
              <div className={`flex items-start gap-2.5 p-3 rounded-lg border ${cfg.bg} ${cfg.border}`}>
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.color}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${cfg.color}`}>
                    {info.status === "up-to-date" && "Up to Date"}
                    {info.status === "behind" && "Update Available"}
                    {info.status === "ahead" && "Ahead of Release"}
                    {info.status === "unknown" && "Unable to Check"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{info.message}</p>
                </div>
              </div>

              {/* Version details */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-muted/30 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Installed</p>
                  <p className="text-sm font-mono font-medium text-foreground">v{info.current}</p>
                </div>
                <div className="rounded-lg bg-muted/30 px-3 py-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Latest</p>
                  <p className="text-sm font-mono font-medium text-foreground">
                    {info.latest ? `v${info.latest}` : "N/A"}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/30 px-3 py-2 col-span-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Detection Engine</p>
                  <p className="text-sm font-mono font-medium text-foreground">v{info.engine}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={check} className="text-xs">
                  <RefreshCw className="h-3 w-3 mr-1.5" />
                  Re-check
                </Button>
                {info.status === "behind" && info.latest && info.release_url && (
                  <a
                    href={info.release_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm" className="text-xs">
                      View Release Notes
                    </Button>
                  </a>
                )}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
