"use client"

import { useEffect, useState } from "react"
import {
  ExternalLink,
  Trash2,
  Loader2,
  Share2,
  Link2,
  Clock,
  AlertTriangle,
  CheckCircle2,
  MoreHorizontal,
  Copy,
  Check,
  Shield,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import Link from "next/link"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { getSafetyRating } from "@/lib/scanner/safety-rating"
import { PaginationControl, usePagination } from "@/components/ui/pagination-control"
import type { Vulnerability } from "@/lib/scanner/types"
import { API } from "@/lib/config/constants"
import { ShareModal } from "@/components/scanner/share-modal"
import { cn } from "@/lib/ui/utils"

interface Share {
  id: number
  url: string
  scannedAt: string
  token: string
  summary: { critical: number; high: number; medium: number; low: number; info: number }
  findings: Vulnerability[]
  findingsCount: number
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export default function SharesPage() {
  const [shares, setShares] = useState<Share[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [selectedShare, setSelectedShare] = useState<Share | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

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

  async function copyShareLink(share: Share) {
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/shared/${share.token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedToken(share.token)
      setTimeout(() => setCopiedToken(null), 2000)
    } catch {
      // Fallback
    }
  }

  const getSeverityInfo = (share: Share) => {
    const rating = getSafetyRating(share.findings)
    if (rating === "unsafe") return { label: "Critical", color: "text-red-500", bg: "bg-red-500/10", icon: AlertTriangle }
    if (rating === "caution") return { label: "Caution", color: "text-yellow-500", bg: "bg-yellow-500/10", icon: AlertTriangle }
    return { label: "Clean", color: "text-emerald-500", bg: "bg-emerald-500/10", icon: CheckCircle2 }
  }



  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Shared Scans</h1>
            <p className="text-sm text-muted-foreground">Manage your active shared scan results. Revoke access anytime.</p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading shares...</p>
            </div>
          ) : (
          <>
          {/* Stats row */}
          {shares.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="flex flex-col gap-1 p-4 rounded-xl border border-border bg-card/50">
                <span className="text-2xl font-semibold tabular-nums">{shares.length}</span>
                <span className="text-xs text-muted-foreground">Active Shares</span>
              </div>
              <div className="flex flex-col gap-1 p-4 rounded-xl border border-border bg-card/50">
                <span className="text-2xl font-semibold tabular-nums text-emerald-500">
                  {shares.filter(s => getSafetyRating(s.findings) === "safe").length}
                </span>
                <span className="text-xs text-muted-foreground">Clean Scans</span>
              </div>
              <div className="flex flex-col gap-1 p-4 rounded-xl border border-border bg-card/50">
                <span className="text-2xl font-semibold tabular-nums text-yellow-500">
                  {shares.filter(s => getSafetyRating(s.findings) === "caution").length}
                </span>
                <span className="text-xs text-muted-foreground">With Warnings</span>
              </div>
              <div className="flex flex-col gap-1 p-4 rounded-xl border border-border bg-card/50">
                <span className="text-2xl font-semibold tabular-nums text-red-500">
                  {shares.filter(s => getSafetyRating(s.findings) === "unsafe").length}
                </span>
                <span className="text-xs text-muted-foreground">Critical</span>
              </div>
            </div>
          )}

          {shares.length === 0 ? (
            <Card className="flex flex-col items-center gap-6 p-12 text-center border-dashed bg-card/50">
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-muted">
                <Share2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground mb-1">No active shares</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Start sharing scan results from your history to make them available to others.
                </p>
              </div>
              <Link href="/history">
                <Button variant="outline" className="gap-2 bg-transparent">
                  <Shield className="h-4 w-4" />
                  View History
                </Button>
              </Link>
            </Card>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Table header */}
              <div className="hidden sm:grid grid-cols-[1fr,100px,100px,120px,80px] gap-4 px-5 py-3 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <div>URL</div>
                <div>Status</div>
                <div>Issues</div>
                <div>Shared</div>
                <div className="text-right">Actions</div>
              </div>

              {/* Rows */}
              <div className="divide-y divide-border">
                {paginatedShares.map((share) => {
                  const severity = getSeverityInfo(share)
                  const SeverityIcon = severity.icon
                  return (
                    <div
                      key={share.id}
                      className="group flex flex-col sm:grid sm:grid-cols-[1fr,100px,100px,120px,80px] gap-2 sm:gap-4 p-4 sm:px-5 sm:py-4 hover:bg-muted/20 transition-colors"
                    >
                      {/* URL */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn("flex items-center justify-center w-8 h-8 rounded-lg shrink-0", severity.bg)}>
                          <Link2 className={cn("h-4 w-4", severity.color)} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{share.url}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate sm:hidden">
                            {share.token.slice(0, 12)}...
                          </p>
                        </div>
                      </div>

                      {/* Status */}
                      <div className="flex items-center gap-1.5 sm:justify-start">
                        <SeverityIcon className={cn("h-3.5 w-3.5", severity.color)} />
                        <span className={cn("text-sm font-medium", severity.color)}>{severity.label}</span>
                      </div>

                      {/* Issues */}
                      <div className="flex items-center">
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {share.findingsCount} issue{share.findingsCount !== 1 ? "s" : ""}
                        </span>
                      </div>

                      {/* Shared */}
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="h-3.5 w-3.5 hidden sm:block" />
                        <span className="text-sm">{formatRelativeTime(new Date(share.scannedAt))}</span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => copyShareLink(share)}
                        >
                          {copiedToken === share.token ? (
                            <Check className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => openShareModal(share)}>
                              <Share2 className="h-4 w-4 mr-2" />
                              Share
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`/shared/${share.token}`} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4 mr-2" />
                                View Report
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => revokeShare(share.id)}
                              disabled={revoking === share.id}
                            >
                              {revoking === share.id ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4 mr-2" />
                              )}
                              Revoke Access
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
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
          shareUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/shared/${selectedShare.token}`}
          title={`VulnRadar Scan: ${selectedShare.url}`}
        />
      )}
    </div>
  )
}
