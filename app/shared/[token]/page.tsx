"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import {
  Loader2,
  AlertCircle,
  ExternalLink,
  User,
  RotateCcw,
  MessageSquare,
  Tag,
} from "lucide-react"
import { PublicPageShell } from "@/components/public-page-shell"
import { ScanSummary } from "@/components/scanner/scan-summary"
import { ResultsList } from "@/components/scanner/results-list"
import { IssueDetail } from "@/components/scanner/issue-detail"
import { ExportButton } from "@/components/scanner/export-button"
import { ResponseHeaders } from "@/components/scanner/response-headers"
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery"
import { STAFF_ROLES, STAFF_ROLE_LABELS, ROLE_BADGE_STYLES, API } from "@/lib/constants"
import type { ScanResult, Vulnerability } from "@/lib/scanner/types"

export default function SharedScanPage() {
  const params = useParams()
  const token = params.token as string

  const [result, setResult] = useState<ScanResult | null>(null)
  const [scannedBy, setScannedBy] = useState("")
  const [scannedByAvatar, setScannedByAvatar] = useState<string | null>(null)
  const [scannedByRole, setScannedByRole] = useState<string>("user")
  const [scannedByBadges, setScannedByBadges] = useState<{ id: number; name: string; display_name: string; icon: string | null; color: string | null; priority: number }[]>([])
  const [scanNotes, setScanNotes] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API.SHARED}/${token}`)
        if (!res.ok) {
          const data = await res.json()
          setError(data.error || "This shared scan could not be found.")
          return
        }
        const data = await res.json()
        setResult(data)
        setScannedBy(data.scannedBy || "")
        setScannedByAvatar(data.scannedByAvatar || null)
        setScannedByRole(data.scannedByRole || "user")
        setScannedByBadges(data.scannedByBadges || [])
        setScanNotes(data.notes || "")
      } catch {
        setError("Failed to load shared scan.")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  return (
    <PublicPageShell badge="Shared Report" maxWidth="max-w-5xl" padding="py-6 sm:py-8">
      <div className="flex flex-col gap-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading shared scan...</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center gap-5 py-16">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <div className="flex flex-col items-center gap-2 text-center max-w-sm">
              <h2 className="text-base font-semibold text-foreground">Scan Not Found</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{error}</p>
            </div>
            <Button variant="outline" onClick={() => router.push("/login")} className="bg-transparent">
              Sign In to {APP_NAME}
            </Button>
          </div>
        )}

        {!loading && result && (
          <div className="flex flex-col gap-6">
            {selectedIssue ? (
              <IssueDetail issue={selectedIssue} onBack={() => setSelectedIssue(null)} />
            ) : (
              <>
                {/* Action bar at top */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {scannedBy && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {scannedByAvatar ? (
                            <img src={scannedByAvatar} alt={scannedBy} className="h-5 w-5 rounded-full object-cover shrink-0" />
                          ) : (
                            <User className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span>
                            Shared by <span className="font-medium text-foreground">{scannedBy}</span>
                          </span>
                          {scannedByRole && scannedByRole !== STAFF_ROLES.USER && ROLE_BADGE_STYLES[scannedByRole] && (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${ROLE_BADGE_STYLES[scannedByRole]}`}>
                              {STAFF_ROLE_LABELS[scannedByRole] || scannedByRole}
                            </span>
                          )}
                          {scannedByBadges.length > 0 && scannedByBadges.slice(0, 3).map((badge) => (
                            <span
                              key={badge.id}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                              style={{
                                backgroundColor: `${badge.color}15`,
                                borderWidth: 1,
                                borderColor: `${badge.color}40`,
                                color: badge.color || undefined,
                              }}
                              title={badge.display_name}
                            >
                              <Tag className="h-2.5 w-2.5" />
                              {badge.display_name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
                    >
                      {result.url}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ExportButton result={result} />
                  </div>
                </div>

                {/* Scan summary */}
                <ScanSummary result={result} />

                {/* Response headers */}
                {result.responseHeaders && Object.keys(result.responseHeaders).length > 0 && (
                  <ResponseHeaders headers={result.responseHeaders} />
                )}

                {/* Subdomain discovery */}
                <SubdomainDiscovery url={result.url} />

                {/* Notes (read-only) */}
                {scanNotes && (
                  <div className="rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-medium text-foreground">Notes</h3>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{scanNotes}</p>
                  </div>
                )}

                {/* Results list */}
                {result.findings.length > 0 ? (
                  <ResultsList findings={result.findings} onSelectIssue={setSelectedIssue} />
                ) : (
                  <div className="flex flex-col items-center gap-3 py-8 text-center rounded-xl border border-dashed border-border">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <RotateCcw className="h-5 w-5 text-emerald-500" />
                    </div>
                    <p className="text-sm font-medium text-foreground">No issues found</p>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      This scan came back clean with no detected vulnerabilities.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </PublicPageShell>
  )
}
