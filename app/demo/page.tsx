"use client"

import { useState, useCallback } from "react"
import { ScanSummary } from "@/components/scanner/scan-summary"
import { ResultsList } from "@/components/scanner/results-list"
import { IssueDetail } from "@/components/scanner/issue-detail"
import { ResponseHeaders } from "@/components/scanner/response-headers"
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery"
import { ScanningIndicator } from "@/components/scanner/scanning-indicator"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TOTAL_CHECKS_LABEL, DEMO_SCAN_LIMIT } from "@/lib/constants"
import type { ScanResult, Vulnerability } from "@/lib/scanner/types"
import { AlertCircle, RotateCcw, Shield, Search } from "lucide-react"

type DemoStatus = "idle" | "scanning" | "done" | "error"

export default function DemoPage() {
  const [status, setStatus] = useState<DemoStatus>("idle")
  const [result, setResult] = useState<ScanResult | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scansRemaining, setScansRemaining] = useState<number | null>(null)
  const [inputUrl, setInputUrl] = useState("")

  const handleScan = useCallback(async (url: string) => {
    setStatus("scanning")
    setResult(null)
    setError(null)
    setSelectedIssue(null)

    try {
      const res = await fetch("/api/demo-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Scan failed")
        if (typeof data.remaining === "number") setScansRemaining(data.remaining)
        setStatus("error")
        return
      }

      setResult(data)
      if (typeof data.remaining === "number") setScansRemaining(data.remaining)
      setStatus("done")
    } catch {
      setError("Failed to connect. Please check your connection and try again.")
      setStatus("error")
    }
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    let url = inputUrl.trim()
    if (!url) return
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url
    }
    handleScan(url)
  }

  function handleReset() {
    setStatus("idle")
    setResult(null)
    setError(null)
    setSelectedIssue(null)
    setInputUrl("")
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 pb-12">
        {/* Hero */}
        <div className="text-center mb-8 pt-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-4">
            <Shield className="h-3 w-3" />
            Free Demo Scanner
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3 text-balance">
            Try VulnRadar Free
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed text-pretty">
            Scan any website with {TOTAL_CHECKS_LABEL} security checks. No account required.
          </p>
          {scansRemaining !== null && (
            <p className="text-xs text-muted-foreground mt-2">
              {scansRemaining} of {DEMO_SCAN_LIMIT} free scans remaining (resets every 12 hours)
            </p>
          )}
        </div>

        {/* Scan form (always visible when not viewing results) */}
        {status !== "done" && (
          <form onSubmit={handleSubmit} className="max-w-2xl mx-auto mb-8">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Enter any URL to scan (e.g. example.com)"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  disabled={status === "scanning"}
                  className="pl-9 bg-card border-border h-11"
                />
              </div>
              <Button
                type="submit"
                disabled={status === "scanning" || !inputUrl.trim()}
                className="h-11 px-6 gap-2"
              >
                <Shield className="h-4 w-4" />
                <span className="hidden sm:inline">Scan</span>
              </Button>
            </div>
          </form>
        )}

        {/* Scanning state */}
        {status === "scanning" && <ScanningIndicator />}

        {/* Error state */}
        {status === "error" && error && (
          <div className="flex flex-col items-center gap-5 py-12">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <div className="flex flex-col items-center gap-2 text-center max-w-sm">
              <h2 className="text-base font-semibold text-foreground">Scan Failed</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{error}</p>
            </div>
            <Button variant="outline" onClick={handleReset} className="bg-transparent">
              <RotateCcw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </div>
        )}

        {/* Results */}
        {status === "done" && result && (
          <div className="flex flex-col gap-6">
            {selectedIssue ? (
              <IssueDetail issue={selectedIssue} onBack={() => setSelectedIssue(null)} />
            ) : (
              <>
                {/* Action bar */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-1">Scanned URL</p>
                    <p className="text-sm font-medium text-foreground truncate">{result.url}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={handleReset} size="sm" className="bg-transparent">
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Scan Another
                    </Button>
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
                <ResultsList findings={result.findings} onSelectIssue={setSelectedIssue} />
              </>
            )}
          </div>
        )}

        {/* Info section (only when idle) */}
        {status === "idle" && (
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                title: "No Account Needed",
                description: `Run up to ${DEMO_SCAN_LIMIT} scans every 12 hours without signing up. Create a free account for unlimited access.`,
                color: "text-emerald-500",
              },
              {
                title: "Full Security Checks",
                description: `The same ${TOTAL_CHECKS_LABEL} checks that run for authenticated users. No features held back.`,
                color: "text-blue-500",
              },
              {
                title: "Real-Time Results",
                description: "Live scan results, not pre-generated. See headers, subdomains, and vulnerabilities in real-time.",
                color: "text-amber-500",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-border bg-card p-5">
                <h3 className={`text-sm font-semibold mb-1.5 ${item.color}`}>{item.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}
