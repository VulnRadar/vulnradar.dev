"use client"

import { useState } from "react"
import { Loader2, ImageIcon, AlertTriangle, ExternalLink, Code2, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { API } from "@/lib/config/constants"
import type { ScanEntry } from "./badge-types"
import { parseUrl } from "./badge-types"

interface BadgePreviewProps {
  selected: ScanEntry | null
  token: string | null
  generating: boolean
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

export function BadgePreview({ selected, token, generating }: BadgePreviewProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const badgeUrl = token ? `${origin}${API.BADGE}/${token}` : ""
  const shareUrl = token ? `${origin}/shared/${token}` : ""
  const htmlSnippet = token
    ? `<a href="${shareUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block;"><img src="${badgeUrl}" alt="Secured by VulnRadar" style="border: 0;"/></a>`
    : ""
  const markdownSnippet = token ? `[![Secured by VulnRadar](${badgeUrl})](${shareUrl})` : ""

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

  if (!selected) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">Badge preview</h2>
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted">
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground text-center">Select a scan to preview your badge</p>
        </div>
      </div>
    )
  }

  if (generating) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">Badge preview</h2>
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Generating share link...</p>
        </div>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">Badge preview</h2>
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-red-500/10">
            <AlertTriangle className="h-6 w-6 text-red-500" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">Failed to generate link</p>
            <p className="text-sm text-muted-foreground mt-1">Try selecting the scan again.</p>
          </div>
        </div>
      </div>
    )
  }

  const { subdomain, host, path } = parseUrl(selected.url)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Badge preview</h2>
        <div className="flex items-baseline gap-0 font-mono text-xs min-w-0 max-w-[60%]">
          {subdomain && <span className="text-muted-foreground truncate max-w-[50px] shrink-0">{subdomain}.</span>}
          <span className="text-foreground font-medium truncate shrink min-w-0">{host}</span>
          {path && <span className="text-muted-foreground truncate max-w-[100px] shrink-0">{path}</span>}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-8 flex items-center justify-center">
        <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="transition-transform hover:scale-105">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={badgeUrl} alt="Secured by VulnRadar" />
        </a>
      </div>

      <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 text-xs text-primary hover:underline">
        <ExternalLink className="h-3 w-3" />
        View full scan results
      </a>

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
  )
}
