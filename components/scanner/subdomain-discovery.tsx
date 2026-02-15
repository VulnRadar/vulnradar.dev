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
  sources: string[]
}

interface DiscoveryResult {
  domain: string
  total: number
  reachable: number
  subdomains: DiscoveredSubdomain[]
  sources?: Record<string, number>
}

interface SubdomainDiscoveryProps {
  url: string
  onScanSubdomain?: (url: string) => void
}

const SOURCE_COLORS: Record<string, string> = {
  "crt.sh": "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  hackertarget: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  "subdomain.center": "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
  rapiddns: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  "brute-force": "bg-muted text-muted-foreground border-border",
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
                Find related subdomains using CT logs, DNS datasets, and brute-force
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
              Querying crt.sh, HackerTarget, RapidDNS, subdomain.center, and 150+ common prefixes
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 bg-muted/30 border-b border-border">
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

          {/* Source breakdown */}
          {result.sources && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Sources:
              </span>
              {Object.entries(result.sources).map(([source, count]) => (
                <span
                  key={source}
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border",
                    SOURCE_COLORS[source] || "bg-muted text-muted-foreground border-border",
                  )}
                >
                  {source}
                  <span className="opacity-60">{count}</span>
                </span>
              ))}
            </div>
          )}

          {/* Reachable subdomains */}
          {reachable.length > 0 && (
            <div className="px-4 py-3 border-b border-border">
              <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">
                Reachable
              </p>
              <div className="flex flex-col gap-1">
                {reachable.map((sub) => (
                  <SubdomainRow key={sub.subdomain} sub={sub} onScanSubdomain={onScanSubdomain} />
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

function SubdomainRow({
  sub,
  onScanSubdomain,
}: {
  sub: DiscoveredSubdomain
  onScanSubdomain?: (url: string) => void
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors group">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
      <span className="text-xs font-mono text-foreground truncate">
        {sub.subdomain}
      </span>
      {/* Source tags */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {sub.sources?.map((source) => (
          <span
            key={source}
            className={cn(
              "hidden sm:inline-flex px-1 py-px rounded text-[9px] font-medium border",
              SOURCE_COLORS[source] || "bg-muted text-muted-foreground border-border",
            )}
          >
            {source}
          </span>
        ))}
      </div>
      <span className="flex-1" />
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
        <div className="flex flex-col gap-1 mt-2">
          {subdomains.map((sub) => (
            <div
              key={sub.subdomain}
              className="flex items-center gap-2 px-2 py-1 rounded-md"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
              <span className="text-[11px] font-mono text-muted-foreground truncate">
                {sub.subdomain}
              </span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {sub.sources?.map((source) => (
                  <span
                    key={source}
                    className={cn(
                      "hidden sm:inline-flex px-1 py-px rounded text-[9px] font-medium border opacity-60",
                      SOURCE_COLORS[source] || "bg-muted text-muted-foreground border-border",
                    )}
                  >
                    {source}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
