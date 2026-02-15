"use client"

import { useEffect, useState } from "react"
import { Copy, ExternalLink, Trash2, Loader2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import Link from "next/link"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { getSafetyRating } from "@/lib/scanner/safety-rating"
import { PaginationControl, usePagination } from "@/components/ui/pagination-control"
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
  const [currentPage, setCurrentPage] = useState(1)

  const PAGE_SIZE = 5
  const { totalPages, getPage } = usePagination(shares, PAGE_SIZE)
  const paginatedShares = getPage(currentPage)

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
        setShares((prev) => {
          const updated = prev.filter((s) => s.id !== scanId)
          const newTotalPages = Math.max(1, Math.ceil(updated.length / PAGE_SIZE))
          if (currentPage > newTotalPages) setCurrentPage(newTotalPages)
          return updated
        })
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
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 sm:py-8">
          <div className="mb-6 sm:mb-8">
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-1 sm:mb-2">Shared Scans</h1>
            <p className="text-sm sm:text-base text-muted-foreground">Manage your active shared scan results. Revoke access anytime.</p>
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
                {paginatedShares.map((share) => (
                    <Card key={share.id} className="p-4 sm:p-6 border border-border/50 hover:border-border transition-colors">
                      {/* Header - URL and Severity */}
                      <div className="mb-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="text-sm sm:text-lg font-semibold text-foreground truncate flex-1">{share.url}</h3>
                          <span className={`text-xs sm:text-sm font-medium whitespace-nowrap ${getSeverityColor(share)}`}>
                      {getSeverityLabel(share)}
                    </span>
                        </div>

                        {/* Meta info - wraps on mobile */}
                        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                          <span>{new Date(share.scannedAt).toLocaleDateString()}</span>
                          <span className="hidden sm:inline">•</span>
                          <span>{share.findingsCount} finding{share.findingsCount !== 1 ? "s" : ""}</span>
                        </div>
                      </div>

                      {/* Token - full width on mobile */}
                      <div className="mb-4 p-2 bg-muted rounded border border-border/50">
                        <p className="text-xs font-mono text-muted-foreground break-all">{share.token}</p>
                      </div>

                      {/* Buttons - Stack on mobile, horizontal on desktop */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyShareLink(share.token)}
                            className="gap-2 flex-1 sm:flex-none"
                        >
                          {copied === share.token ? (
                              <>
                                <Check className="h-4 w-4 text-green-500" />
                                <span>Copied</span>
                              </>
                          ) : (
                              <>
                                <Copy className="h-4 w-4" />
                                <span>Copy Link</span>
                              </>
                          )}
                        </Button>
                        <a
                            href={`/shared/${share.token}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 sm:flex-none"
                        >
                          <Button variant="outline" size="sm" className="gap-2 w-full sm:w-auto">
                            <ExternalLink className="h-4 w-4" />
                            <span>View</span>
                          </Button>
                        </a>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => revokeShare(share.id)}
                            disabled={revoking === share.id}
                            className="gap-2 flex-1 sm:flex-none"
                        >
                          {revoking === share.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                              <Trash2 className="h-4 w-4" />
                          )}
                          <span>Revoke</span>
                        </Button>
                      </div>
                    </Card>
                ))}

                {shares.length > PAGE_SIZE && (
                  <PaginationControl
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={setCurrentPage}
                  />
                )}
              </div>
          )}
        </main>
        <Footer />
      </div>
  )
}
