"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import Image from "next/image"
import {
  Loader2,
  AlertCircle,
  ExternalLink,
  User,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScanSummary } from "@/components/scanner/scan-summary"
import { ResultsList } from "@/components/scanner/results-list"
import { IssueDetail } from "@/components/scanner/issue-detail"
import { ExportButton } from "@/components/scanner/export-button"
import type { ScanResult, Vulnerability } from "@/lib/scanner/types"

export default function SharedScanPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [result, setResult] = useState<ScanResult | null>(null)
  const [scannedBy, setScannedBy] = useState("")
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
            alt="VulnRadar logo"
            width={20}
            height={20}
            className="h-5 w-5"
          />
          <span className="text-base font-semibold text-foreground tracking-tight">VulnRadar</span>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md font-medium">
            Shared Report
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/login")}
          className="bg-transparent text-xs"
        >
          Sign In
        </Button>
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
              Sign In to VulnRadar
            </Button>
          </div>
        )}

        {!loading && result && (
          <div className="flex flex-col gap-6">
            {/* Shared by banner */}
            {scannedBy && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground">
                <User className="h-4 w-4 shrink-0" />
                <span>
                  Shared by <span className="font-medium text-foreground">{scannedBy}</span>
                </span>
                <span className="mx-1">-</span>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline truncate"
                >
                  {result.url}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </div>
            )}

            {selectedIssue ? (
              <IssueDetail issue={selectedIssue} onBack={() => setSelectedIssue(null)} />
            ) : (
              <>
                <ScanSummary result={result} />
                {result.findings.length > 0 && (
                  <ResultsList findings={result.findings} onSelectIssue={setSelectedIssue} />
                )}
                <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
                  <ExportButton result={result} />
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* Minimal footer */}
      <footer className="border-t border-border py-4 px-4 text-center">
        <p className="text-xs text-muted-foreground">
          VulnRadar - Security vulnerability scanner.{" "}
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
