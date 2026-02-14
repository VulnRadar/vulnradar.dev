"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Button } from "@/components/ui/button"
import { Copy, Check, Code2, Loader2, ExternalLink, Image as ImageIcon, ShieldCheck, AlertTriangle, Search } from "lucide-react"
import { cn } from "@/lib/utils"

interface ScanEntry {
  id: number
  url: string
  share_token: string | null
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
    fetch("/api/badge/scans")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setScans(data)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleSelect(scan: ScanEntry) {
    if (scan.share_token) {
      setSelected(scan)
      return
    }

    // Generate a share token on the fly
    setGenerating(true)
    setSelected(scan)
    try {
      const res = await fetch(`/api/history/${scan.id}/share`, { method: "POST" })
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
  const badgeUrl = token ? `${origin}/api/badge/${token}` : ""
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
    const s = scan.summary
    if (!s) return scan.findings_count === 0 ? "text-emerald-500" : "text-amber-500"
    if ((s.critical ?? 0) > 0 || (s.high ?? 0) > 0) return "text-red-500"
    if ((s.medium ?? 0) > 0) return "text-amber-500"
    return "text-emerald-500"
  }

  function getSeverityLabel(scan: ScanEntry) {
    const s = scan.summary
    if (!s) return scan.findings_count === 0 ? "Clean" : `${scan.findings_count} issues`
    if ((s.critical ?? 0) > 0) return `${s.critical} critical`
    if ((s.high ?? 0) > 0) return `${s.high} high`
    if ((s.medium ?? 0) > 0) return `${s.medium} medium`
    if (scan.findings_count === 0) return "Clean"
    return `${scan.findings_count} issues`
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          {/* Page header */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
                <ImageIcon className="h-4 w-4 text-primary" />
              </div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                Embed Security Badge
              </h1>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Pick any scan to generate a &ldquo;Secured by VulnRadar&rdquo; badge you can embed on your site.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : scans.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No scans found. Run a scan first, then come back here to generate your badge.
              </p>
            </div>
          ) : (
            <>
              {/* Search */}
              {scans.length > 5 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search by domain..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  />
                </div>
              )}

              {/* Scan list */}
              <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-2">
                {filteredScans.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No scans match your search.</p>
                ) : (
                  filteredScans.map((scan) => {
                    const hostname = (() => { try { return new URL(scan.url).hostname } catch { return scan.url } })()
                    const isSelected = selected?.id === scan.id
                    const date = new Date(scan.scanned_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    return (
                      <button
                        key={scan.id}
                        type="button"
                        onClick={() => handleSelect(scan)}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors w-full",
                          isSelected
                            ? "bg-primary/10 ring-1 ring-primary/30"
                            : "hover:bg-muted/50",
                        )}
                      >
                        <div className={cn("flex-shrink-0", getSeverityColor(scan))}>
                          {scan.findings_count === 0 ? (
                            <ShieldCheck className="h-4 w-4" />
                          ) : (
                            <AlertTriangle className="h-4 w-4" />
                          )}
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-sm font-medium text-foreground truncate">{hostname}</span>
                          <span className="text-[11px] text-muted-foreground">{date}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={cn("text-xs font-medium", getSeverityColor(scan))}>
                            {getSeverityLabel(scan)}
                          </span>
                          {scan.share_token ? (
                            <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">shared</span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">not shared</span>
                          )}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>

              {/* Generating state */}
              {generating && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Generating share link for badge...</span>
                </div>
              )}

              {/* Badge preview + snippets */}
              {selected && token && !generating && (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground">Preview</label>
                    <div className="rounded-xl border border-border bg-card p-6 flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                        <img src={badgeUrl} alt="Secured by VulnRadar" />
                      </a>
                    </div>
                  </div>

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
                    label="Badge Image URL"
                    icon={ImageIcon}
                    code={badgeUrl}
                    copied={copiedField === "url"}
                    onCopy={() => copyToClipboard(badgeUrl, "url")}
                  />
                </>
              )}

              {/* Selected but no token yet and not generating */}
              {selected && !token && !generating && (
                <div className="rounded-xl border border-border bg-card p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Failed to generate a share link. Try selecting the scan again.
                  </p>
                </div>
              )}
            </>
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3 w-3" />
          {label}
        </label>
        <Button variant="ghost" size="sm" onClick={onCopy} className="h-7 gap-1.5 text-xs">
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
      <pre className="rounded-lg border border-border bg-muted/50 p-3 overflow-x-auto">
        <code className="text-xs font-mono text-foreground whitespace-pre-wrap break-all">{code}</code>
      </pre>
    </div>
  )
}
