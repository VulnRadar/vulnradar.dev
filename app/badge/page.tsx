"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Button } from "@/components/ui/button"
import { Copy, Check, Code2, Loader2, ExternalLink, Image as ImageIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface SharedScan {
  id: number
  url: string
  share_token: string
  findings_count: number
  scanned_at: string
}

export default function BadgePage() {
  const [scans, setScans] = useState<SharedScan[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<SharedScan | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/badge/scans")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setScans(data)
          if (data.length > 0) setSelected(data[0])
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

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
  const badgeUrl = selected ? `${origin}/api/badge/${selected.share_token}` : ""
  const shareUrl = selected ? `${origin}/shared/${selected.share_token}` : ""
  const htmlSnippet = selected
    ? `<a href="${shareUrl}" target="_blank" rel="noopener noreferrer">\n  <img src="${badgeUrl}" alt="Secured by VulnRadar" />\n</a>`
    : ""
  const markdownSnippet = selected
    ? `[![Secured by VulnRadar](${badgeUrl})](${shareUrl})`
    : ""

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          {/* Header */}
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
              Add a &ldquo;Secured by VulnRadar&rdquo; badge to your website. Visitors can click it to see your latest scan results.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : scans.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No shared scans yet. Run a scan and generate a share link first, then come back here to get your embed badge.
              </p>
            </div>
          ) : (
            <>
              {/* Scan picker */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-muted-foreground">Select a shared scan</label>
                <div className="flex flex-wrap gap-2">
                  {scans.map((scan) => {
                    const hostname = (() => { try { return new URL(scan.url).hostname } catch { return scan.url } })()
                    return (
                      <button
                        key={scan.id}
                        type="button"
                        onClick={() => setSelected(scan)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors",
                          selected?.id === scan.id
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "bg-card border-border text-muted-foreground hover:border-primary/20 hover:text-foreground",
                        )}
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span className="truncate max-w-48">{hostname}</span>
                        <span className="text-[10px] opacity-70">
                          {scan.findings_count === 0 ? "Clean" : `${scan.findings_count} issues`}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {selected && (
                <>
                  {/* Badge preview */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground">Preview</label>
                    <div className="rounded-xl border border-border bg-card p-6 flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                        <img src={badgeUrl} alt="Secured by VulnRadar" />
                      </a>
                    </div>
                  </div>

                  {/* HTML snippet */}
                  <SnippetBlock
                    label="HTML"
                    icon={Code2}
                    code={htmlSnippet}
                    copied={copiedField === "html"}
                    onCopy={() => copyToClipboard(htmlSnippet, "html")}
                  />

                  {/* Markdown snippet */}
                  <SnippetBlock
                    label="Markdown"
                    icon={Code2}
                    code={markdownSnippet}
                    copied={copiedField === "md"}
                    onCopy={() => copyToClipboard(markdownSnippet, "md")}
                  />

                  {/* Badge URL */}
                  <SnippetBlock
                    label="Badge Image URL"
                    icon={ImageIcon}
                    code={badgeUrl}
                    copied={copiedField === "url"}
                    onCopy={() => copyToClipboard(badgeUrl, "url")}
                  />
                </>
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
