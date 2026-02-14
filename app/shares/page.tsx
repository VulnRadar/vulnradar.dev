"use client"

import { useEffect, useState } from "react"
import { Copy, ExternalLink, Trash2, Loader2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import Link from "next/link"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { getSafetyRating } from "@/lib/scanner/safety-rating"
import type { Vulnerability } from "@/lib/scanner/types"

interface Share {
  id: number
  url: string
  scannedAt: string
  token: string
  summary: { critical: number; high: number; medium: number; low: number; info: number }
  findings: Vulnerability[]
  findingsCount: number
}

export default function SharesPage() {
  const [shares, setShares] = useState<Share[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<number | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    fetchShares()
  }, [])

  async function fetchShares() {
    setLoading(true)
    try {
      const res = await fetch("/api/shares")
      if (res.ok) {
        const data = await res.json()
        setShares(data.shares || [])
      }
    } catch (err) {
      console.error("Failed to fetch shares:", err)
    } finally {
      setLoading(false)
    }
  }

  async function revokeShare(scanId: number) {
    if (!confirm("Are you sure you want to revoke access to this shared scan?")) return

    setRevoking(scanId)
    try {
      const res = await fetch(`/api/history/${scanId}/share`, { method: "DELETE" })
      if (res.ok) {
        setShares((prev) => prev.filter((s) => s.id !== scanId))
      }
    } catch (err) {
      console.error("Failed to revoke share:", err)
    } finally {
      setRevoking(null)
    }
  }

  async function copyShareLink(token: string) {
    const url = `${window.location.origin}/shared/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(token)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Fallback
      const textarea = document.createElement("textarea")
      textarea.value = url
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
      setCopied(token)
      setTimeout(() => setCopied(null), 2000)
    }
  }

  const getSeverityColor = (share: Share) => {
    const rating = getSafetyRating(share.findings)
    if (rating === "unsafe") return "text-red-500"
    if (rating === "caution") return "text-yellow-500"
    return "text-emerald-500"
  }

  const getSeverityLabel = (share: Share) => {
    const rating = getSafetyRating(share.findings)
    if (rating === "unsafe") return "Unsafe"
    if (rating === "caution") return "Caution"
    return "Safe"
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Shared Scans</h1>
          <p className="text-muted-foreground">Manage your active shared scan results. Revoke access anytime.</p>
        </div>

        {shares.length === 0 ? (
          <Card className="p-12 text-center border-dashed">
            <p className="text-muted-foreground mb-4">No active shared scans</p>
            <p className="text-sm text-muted-foreground mb-6">Start sharing scan results from your history to make them available to others.</p>
            <Link href="/history">
              <Button variant="outline">View History</Button>
            </Link>
          </Card>
        ) : (
          <div className="space-y-4">
            {shares.map((share) => (
              <Card key={share.id} className="p-6 border border-border/50 hover:border-border transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold text-foreground truncate">{share.url}</h3>
                      <span className={`text-sm font-medium ${getSeverityColor(share)}`}>
                        {getSeverityLabel(share)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                      <span>Scanned {new Date(share.scannedAt).toLocaleDateString()}</span>
                      <span>•</span>
                      <span>{share.findingsCount} finding{share.findingsCount !== 1 ? "s" : ""}</span>
                      <span>•</span>
                      <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{share.token.slice(0, 12)}...</span>
                    </div>
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyShareLink(share.token)}
                      className="gap-2"
                    >
                      {copied === share.token ? (
                        <>
                          <Check className="h-4 w-4 text-green-500" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy Link
                        </>
                      )}
                    </Button>
                    <a
                      href={`/shared/${share.token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm" className="gap-2">
                        <ExternalLink className="h-4 w-4" />
                        View
                      </Button>
                    </a>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => revokeShare(share.id)}
                      disabled={revoking === share.id}
                      className="gap-2"
                    >
                      {revoking === share.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Revoke
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
