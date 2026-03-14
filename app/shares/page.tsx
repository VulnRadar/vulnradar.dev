"use client"

import { useEffect, useState } from "react"
import { ExternalLink, Trash2, Loader2, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import Link from "next/link"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { getSafetyRating } from "@/lib/scanner/safety-rating"
import { PaginationControl, usePagination } from "@/components/ui/pagination-control"
import type { Vulnerability } from "@/lib/scanner/types"
import { API } from "@/lib/constants"
import { ShareModal } from "@/components/scanner/share-modal"

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
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [selectedShare, setSelectedShare] = useState<Share | null>(null)

  const PAGE_SIZE = pageSize
  const { totalPages, getPage } = usePagination(shares, PAGE_SIZE)
  const paginatedShares = getPage(currentPage)

  useEffect(() => {
    fetchShares()
  }, [])

  async function fetchShares() {
    setLoading(true)
    try {
      const res = await fetch(API.SHARES)
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
      const res = await fetch(`${API.HISTORY}/${scanId}/share`, { method: "DELETE" })
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

  function openShareModal(share: Share) {
    setSelectedShare(share)
    setShareModalOpen(true)
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
        <div className="min-h-screen flex flex-col bg-background">
          <Header />
          <main className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading shares...</p>
            </div>
          </main>
          <Footer />
        </div>
    )
  }

  return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8">
          <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1 mb-2">
            <h1 className="text-xl font-bold text-foreground">Shared Scans</h1>
            <p className="text-sm text-muted-foreground">Manage your active shared scan results. Revoke access anytime.</p>
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
                      <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openShareModal(share)}
                            className="gap-2"
                        >
                          <Share2 className="h-4 w-4" />
                          <span className="hidden sm:inline">Share</span>
                        </Button>
                        <a
                            href={`/shared/${share.token}`}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                          <Button variant="outline" size="sm" className="gap-2">
                            <ExternalLink className="h-4 w-4" />
                            <span className="hidden sm:inline">View</span>
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
                          <span className="hidden sm:inline">Revoke</span>
                        </Button>
                      </div>
                    </Card>
                ))}

                <PaginationControl
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                  pageSize={pageSize}
                  onPageSizeChange={(s) => { setPageSize(s); setCurrentPage(1) }}
                  totalItems={shares.length}
                />
              </div>
          )}
          </div>
        </main>
        <Footer />

        {selectedShare && (
          <ShareModal
            open={shareModalOpen}
            onOpenChange={setShareModalOpen}
            shareUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/shared/${selectedShare.token}`}
            title={`VulnRadar Scan: ${selectedShare.url}`}
          />
        )}
      </div>
  )
}
