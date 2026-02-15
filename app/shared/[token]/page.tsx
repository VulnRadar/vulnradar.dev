"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import Image from "next/image"
import {
  Loader2,
  AlertCircle,
  ExternalLink,
  User,
  RotateCcw,
} from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { ScanSummary } from "@/components/scanner/scan-summary"
import { ResultsList } from "@/components/scanner/results-list"
import { IssueDetail } from "@/components/scanner/issue-detail"
import { ExportButton } from "@/components/scanner/export-button"
import { ResponseHeaders } from "@/components/scanner/response-headers"
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery"
import { APP_NAME } from "@/lib/constants"
import type { ScanResult, Vulnerability } from "@/lib/scanner/types"

export default function SharedScanPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [result, setResult] = useState<ScanResult | null>(null)
  const [scannedBy, setScannedBy] = useState("")
  const [scannedByAvatar, setScannedByAvatar] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/shared/${token}`)
        if (!res.ok) {
          const data = await res.json()
          setError(data.error || "This shared scan could not be found.")
          return
        }
        const data = await res.json()
        setResult(data)
        setScannedBy(data.scannedBy || "")
        setScannedByAvatar(data.scannedByAvatar || null)
      } catch {
        setError("Failed to load shared scan.")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Minimal public header */}
      <header className="sticky top-0 z-50 h-14 flex items-center justify-between px-4 sm:px-6 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Image
            src="/favicon.svg"
            alt={`${APP_NAME} logo`}
            width={20}
            height={20}
            className="h-5 w-5"
          />
          <span className="text-base font-semibold text-foreground tracking-tight">{APP_NAME}</span>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md font-medium">
            Shared Report
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/login")}
            className="bg-transparent text-xs"
          >
            Sign In
          </Button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 sm:py-8 flex flex-col gap-6">
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
                {/* Action bar at top -- matches dashboard/history pattern */}
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
      </main>

      {/* Minimal footer */}
      <footer className="border-t border-border py-4 px-4 text-center">
        <p className="text-xs text-muted-foreground">
          {APP_NAME} - Security vulnerability scanner.{" "}
          <button
            onClick={() => router.push("/signup")}
            className="text-primary hover:underline"
          >
            Create a free account
          </button>
          {" "}to run your own scans.
        </p>
      </footer>
    </div>
  )
}
