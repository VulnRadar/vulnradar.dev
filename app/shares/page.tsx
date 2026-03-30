"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { PaginationControl, usePagination } from "@/components/ui/pagination-control"
import { ShareModal } from "@/components/scanner/share-modal"
import { API } from "@/lib/config/constants"
import {
  type Share,
  getShareUrl,
  SharesStats,
  SharesEmptyState,
  SharesTable,
} from "@/components/shares"

export default function SharesPage() {
  const [shares, setShares] = useState<Share[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<number | null>(null)
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [selectedShare, setSelectedShare] = useState<Share | null>(null)

  const { totalPages, getPage } = usePagination(shares, pageSize)
  const paginatedShares = getPage(currentPage)

  useEffect(() => { fetchShares() }, [])

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
          const newTotalPages = Math.max(1, Math.ceil(updated.length / pageSize))
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

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          {/* Page title */}
          <div className="mb-2">
            <h1 className="text-2xl font-semibold tracking-tight">Shared Scans</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your active shared scan results. Revoke access anytime.
            </p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading shares...</p>
            </div>
          ) : (
            <>
              {shares.length > 0 && <SharesStats shares={shares} />}

              {shares.length === 0 ? (
                <SharesEmptyState />
              ) : (
                <SharesTable
                  shares={paginatedShares}
                  revoking={revoking}
                  onRevoke={revokeShare}
                  onOpenShareModal={(share) => {
                    setSelectedShare(share)
                    setShareModalOpen(true)
                  }}
                />
              )}

              {shares.length > 0 && (
                <PaginationControl
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                  pageSize={pageSize}
                  onPageSizeChange={(s) => { setPageSize(s); setCurrentPage(1) }}
                  totalItems={shares.length}
                />
              )}
            </>
          )}
        </div>
      </main>
      <Footer />

      {selectedShare && (
        <ShareModal
          open={shareModalOpen}
          onOpenChange={setShareModalOpen}
          shareUrl={getShareUrl(selectedShare.token)}
          title={`VulnRadar Scan: ${selectedShare.url}`}
        />
      )}
    </div>
  )
}
