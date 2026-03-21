"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Button } from "@/components/ui/button"
import { Copy, Check, Code2, Loader2, ImageIcon, ShieldCheck, AlertTriangle, Search, ExternalLink, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { getSafetyRating } from "@/lib/scanner/safety-rating"
import type { Vulnerability } from "@/lib/scanner/types"
import { API } from "@/lib/constants"

interface ScanEntry {
  id: number
  url: string
  share_token: string | null
  findings: Vulnerability[]
  findings_count: number
  scanned_at: string
  summary?: { critical?: number; high?: number; medium?: number; low?: number; info?: number; total?: number }
}

export default function BadgePage() {
  const [scans, setScans] = useState<ScanEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ScanEntry | null>(null)
  const [generating, setGenerating] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    const fetchBadgeScans = async () => {
      try {
        const res = await fetch(API.BADGE_SCANS)
        if (!res.ok) {
          setScans([])
          setLoading(false)
          return
        }
        const data = await res.json()
        setScans(Array.isArray(data) ? data : [])
      } catch {
        setScans([])
      } finally {
        setLoading(false)
      }
    }
    fetchBadgeScans()
  }, [])

  async function handleSelect(scan: ScanEntry) {
    if (scan.share_token) {
      setSelected(scan)
      return
    }

    setGenerating(true)
    setSelected(scan)
    try {
      const res = await fetch(`${API.HISTORY}/${scan.id}/share`, { method: "POST" })
      const data = await res.json()
      if (res.ok && data.token) {
        const updated = { ...scan, share_token: data.token }
        setSelected(updated)
        setScans((prev) => prev.map((s) => (s.id === scan.id ? updated : s)))
      }
    } catch {
      // keep selected but no token
    } finally {
      setGenerating(false)
    }
  }

  function copyToClipboard(text: string, field: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
    } else {
      fallbackCopy(text)
    }
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  function fallbackCopy(text: string) {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand("copy")
    document.body.removeChild(textarea)
  }

  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const token = selected?.share_token
  const badgeUrl = token ? `${origin}${API.BADGE}/${token}` : ""
  const shareUrl = token ? `${origin}/shared/${token}` : ""
  const htmlSnippet = token
    ? `<a href="${shareUrl}" target="_blank" rel="noopener noreferrer">\n  <img src="${badgeUrl}" alt="Secured by VulnRadar" />\n</a>`
    : ""
  const markdownSnippet = token
    ? `[![Secured by VulnRadar](${badgeUrl})](${shareUrl})`
    : ""

  const filteredScans = scans.filter((s) => {
    if (!searchQuery) return true
    try {
      return new URL(s.url).hostname.toLowerCase().includes(searchQuery.toLowerCase())
    } catch {
      return s.url.toLowerCase().includes(searchQuery.toLowerCase())
    }
  })

  function getSeverityColor(scan: ScanEntry) {
    const rating = getSafetyRating(scan.findings || [])
    if (rating === "unsafe") return "text-red-500"
    if (rating === "caution") return "text-amber-500"
    return "text-emerald-500"
  }

  function getSeverityBg(scan: ScanEntry) {
    const rating = getSafetyRating(scan.findings || [])
    if (rating === "unsafe") return "bg-red-500/10"
    if (rating === "caution") return "bg-amber-500/10"
    return "bg-emerald-500/10"
  }

  function getSeverityLabel(scan: ScanEntry) {
    const rating = getSafetyRating(scan.findings || [])
    if (rating === "unsafe") return "Unsafe"
    if (rating === "caution") return "Caution"
    return "Safe"
  }

  function getRelativeTime(dateStr: string) {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          {/* Page header */}
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Security Badge</h1>
            <p className="text-sm text-muted-foreground">
              Generate embeddable badges to showcase your security status on your website.
            </p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading scans...</p>
            </div>
          ) : scans.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted">
                  <ShieldCheck className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">No scans available</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Run a scan first, then come back here to generate your badge.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left column - Scan selection */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-foreground">Select a scan</h2>
                  <span className="text-xs text-muted-foreground">{scans.length} scans</span>
                </div>

                {/* Search */}
                {scans.length > 5 && (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search by domain..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                    />
                  </div>
                )}

                {/* Scan list */}
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
                    {filteredScans.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No scans match your search.</p>
                    ) : (
                      filteredScans.map((scan) => {
                        const hostname = (() => { try { return new URL(scan.url).hostname } catch { return scan.url } })()
                        const isSelected = selected?.id === scan.id
                        return (
                          <button
                            key={scan.id}
                            type="button"
                            onClick={() => handleSelect(scan)}
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 text-left transition-colors w-full group",
                              isSelected
                                ? "bg-primary/5"
                                : "hover:bg-muted/50",
                            )}
                          >
                            <div className={cn("flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0", getSeverityBg(scan))}>
                              {scan.findings_count === 0 ? (
                                <ShieldCheck className={cn("h-4 w-4", getSeverityColor(scan))} />
                              ) : (
                                <AlertTriangle className={cn("h-4 w-4", getSeverityColor(scan))} />
                              )}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="text-sm font-medium text-foreground truncate">{hostname}</span>
                              <span className="text-xs text-muted-foreground">{getRelativeTime(scan.scanned_at)}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={cn(
                                "text-xs font-medium px-2 py-0.5 rounded-full",
                                getSeverityBg(scan),
                                getSeverityColor(scan)
                              )}>
                                {getSeverityLabel(scan)}
                              </span>
                              <ChevronRight className={cn(
                                "h-4 w-4 text-muted-foreground transition-transform",
                                isSelected && "text-primary rotate-90"
                              )} />
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Right column - Badge preview & snippets */}
              <div className="flex flex-col gap-4">
                <h2 className="text-sm font-medium text-foreground">Badge preview</h2>

                {!selected && (
                  <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground text-center">
                      Select a scan to preview your badge
                    </p>
                  </div>
                )}

                {generating && (
                  <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Generating share link...</p>
                  </div>
                )}

                {selected && token && !generating && (
                  <div className="flex flex-col gap-4">
                    {/* Badge preview */}
                    <div className="rounded-xl border border-border bg-card p-8 flex items-center justify-center">
                      <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="transition-transform hover:scale-105">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={badgeUrl} alt="Secured by VulnRadar" />
                      </a>
                    </div>

                    {/* Preview link */}
                    <a 
                      href={shareUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View full scan results
                    </a>

                    {/* Snippets */}
                    <div className="flex flex-col gap-3 pt-2">
                      <SnippetBlock
                        label="HTML"
                        icon={Code2}
                        code={htmlSnippet}
                        copied={copiedField === "html"}
                        onCopy={() => copyToClipboard(htmlSnippet, "html")}
                      />

                      <SnippetBlock
                        label="Markdown"
                        icon={Code2}
                        code={markdownSnippet}
                        copied={copiedField === "md"}
                        onCopy={() => copyToClipboard(markdownSnippet, "md")}
                      />

                      <SnippetBlock
                        label="Image URL"
                        icon={ImageIcon}
                        code={badgeUrl}
                        copied={copiedField === "url"}
                        onCopy={() => copyToClipboard(badgeUrl, "url")}
                      />
                    </div>
                  </div>
                )}

                {selected && !token && !generating && (
                  <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-red-500/10">
                      <AlertTriangle className="h-6 w-6 text-red-500" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">Failed to generate link</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Try selecting the scan again.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}

function SnippetBlock({
  label,
  icon: Icon,
  code,
  copied,
  onCopy,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  code: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3 w-3" />
          {label}
        </span>
        <Button variant="ghost" size="sm" onClick={onCopy} className="h-6 px-2 gap-1 text-xs">
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-500" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className="p-3 overflow-x-auto">
        <code className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all">{code}</code>
      </pre>
    </div>
  )
}
