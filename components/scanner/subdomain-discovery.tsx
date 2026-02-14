"use client"

import { useState } from "react"
import { Globe, Loader2, Search, ExternalLink, ChevronDown, ChevronRight, Radar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface DiscoveredSubdomain {
  subdomain: string
  url: string
  reachable: boolean
  statusCode?: number
}

interface DiscoveryResult {
  domain: string
  total: number
  reachable: number
  subdomains: DiscoveredSubdomain[]
}

interface SubdomainDiscoveryProps {
  url: string
  onScanSubdomain?: (url: string) => void
}

export function SubdomainDiscovery({ url, onScanSubdomain }: SubdomainDiscoveryProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DiscoveryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  async function handleDiscover() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/scan/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Discovery failed")
      } else {
        setResult(data)
        setExpanded(true)
      }
    } catch {
      setError("Failed to discover subdomains")
    } finally {
      setLoading(false)
    }
  }

  if (!result && !loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
              <Globe className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Subdomain Discovery</h3>
              <p className="text-xs text-muted-foreground">
                Find related subdomains and assets for a broader attack surface analysis
              </p>
            </div>
          </div>
          <Button
            onClick={handleDiscover}
            disabled={loading}
            size="sm"
            variant="outline"
            className="gap-2 bg-transparent shrink-0"
          >
            <Search className="h-3.5 w-3.5" />
            Discover Subdomains
          </Button>
        </div>
        {error && (
          <p className="text-sm text-destructive mt-3">{error}</p>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">Discovering subdomains...</p>
            <p className="text-xs text-muted-foreground mt-1">
              Checking certificate transparency logs and common prefixes
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!result) return null

  const reachable = result.subdomains.filter((s) => s.reachable)
  const unreachable = result.subdomains.filter((s) => !s.reachable)

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <Globe className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground flex-1">
          Subdomain Discovery
        </span>
        <span className="text-xs text-muted-foreground">
          {result.reachable} reachable / {result.total} found
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Stats bar */}
          <div className="flex items-center gap-4 px-4 py-2 bg-muted/30 border-b border-border">
            <span className="text-xs text-muted-foreground">
              Domain: <span className="font-medium text-foreground">{result.domain}</span>
            </span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              {result.reachable} reachable
            </span>
            <span className="text-xs text-muted-foreground">
              {result.total - result.reachable} unreachable
            </span>
          </div>

          {/* Reachable subdomains */}
          {reachable.length > 0 && (
            <div className="px-4 py-3 border-b border-border">
              <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">
                Reachable
              </p>
              <div className="flex flex-col gap-1">
                {reachable.map((sub) => (
                  <div
                    key={sub.subdomain}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors group"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-xs font-mono text-foreground flex-1 truncate">
                      {sub.subdomain}
                    </span>
                    {sub.statusCode && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {sub.statusCode}
                      </span>
                    )}
                    <a
                      href={sub.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {onScanSubdomain && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onScanSubdomain(sub.url)}
                        className="h-6 px-2 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity gap-1"
                      >
                        <Radar className="h-3 w-3" />
                        Scan
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unreachable subdomains (collapsed by default) */}
          {unreachable.length > 0 && (
            <UnreachableSection subdomains={unreachable} />
          )}
        </div>
      )}
    </div>
  )
}

function UnreachableSection({ subdomains }: { subdomains: DiscoveredSubdomain[] }) {
  const [show, setShow] = useState(false)

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors flex items-center gap-1"
      >
        {show ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {subdomains.length} unreachable
      </button>
      {show && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {subdomains.map((sub) => (
            <span
              key={sub.subdomain}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono",
                "bg-muted/50 text-muted-foreground border border-border/50",
              )}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
              {sub.subdomain}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
