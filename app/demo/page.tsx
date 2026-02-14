"use client"

import { useState } from "react"
import { ScanSummary } from "@/components/scanner/scan-summary"
import { ResultsList } from "@/components/scanner/results-list"
import { IssueDetail } from "@/components/scanner/issue-detail"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Radar, Shield, Loader2, AlertTriangle, CheckCircle } from "lucide-react"
import { TOTAL_CHECKS_LABEL, DEMO_SCAN_LIMIT } from "@/lib/constants"
import type { ScanResult, Vulnerability } from "@/lib/scanner/types"

export default function DemoPage() {
  const [status, setStatus] = useState<"idle" | "scanning" | "done" | "error">("idle")
  const [result, setResult] = useState<ScanResult | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scansUsed, setScansUsed] = useState(0)

  async function handleSelfScan() {
    setStatus("scanning")
    setResult(null)
    setError(null)
    setSelectedIssue(null)

    try {
      const siteUrl = window.location.origin
      const res = await fetch("/api/demo-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: siteUrl }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Scan failed")
      }

      const data = await res.json()
      setResult(data)
      setScansUsed((prev) => prev + 1)
      setStatus("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setStatus("error")
    }
  }

  const scansRemaining = DEMO_SCAN_LIMIT - scansUsed

  return (
    <>
      {/* Hero section */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-4">
          <Shield className="h-3 w-3" />
          Self-Assessment Demo
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3 text-balance">
          Scan VulnRadar Itself
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed text-pretty">
          See VulnRadar in action by running a full vulnerability scan against this very site.
          This demonstrates the {TOTAL_CHECKS_LABEL} security checks in real-time.
        </p>
        {scansUsed > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            {scansRemaining} of {DEMO_SCAN_LIMIT} demo scans remaining
          </p>
        )}
      </div>

      {/* Scan card */}
      {status === "idle" && (
        <Card className="bg-card border-border max-w-md mx-auto">
          <CardContent className="p-6 sm:p-8 flex flex-col items-center gap-6 text-center">
            <div className="p-5 rounded-2xl bg-primary/5 border border-primary/10">
              <Radar className="h-10 w-10 sm:h-12 sm:w-12 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Ready to self-scan</h2>
              <p className="text-sm text-muted-foreground">
                This will scan{" "}
                <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">
                  {typeof window !== "undefined" ? window.location.origin : "this site"}
                </span>{" "}
                using all {TOTAL_CHECKS_LABEL} checks.
              </p>
            </div>
            <Button size="lg" className="gap-2" onClick={handleSelfScan}>
              <Radar className="h-4 w-4" />
              Run Self-Scan
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Scanning state */}
      {status === "scanning" && (
        <Card className="bg-card border-border max-w-md mx-auto">
          <CardContent className="p-6 sm:p-8 flex flex-col items-center gap-6 text-center">
            <div className="relative">
              <div className="p-5 rounded-2xl bg-primary/5 border border-primary/10">
                <Radar className="h-10 w-10 sm:h-12 sm:w-12 text-primary animate-pulse" />
              </div>
              <Loader2 className="absolute -bottom-1 -right-1 h-6 w-6 text-primary animate-spin" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Scanning in progress...</h2>
              <p className="text-sm text-muted-foreground">
                Running {TOTAL_CHECKS_LABEL} vulnerability checks against VulnRadar. This usually takes a few seconds.
              </p>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: "60%" }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {status === "error" && (
        <Card className="bg-card border-border max-w-md mx-auto">
          <CardContent className="p-6 sm:p-8 flex flex-col items-center gap-6 text-center">
            <div className="p-5 rounded-2xl bg-destructive/5 border border-destructive/10">
              <AlertTriangle className="h-10 w-10 sm:h-12 sm:w-12 text-destructive" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Scan failed</h2>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
            <Button variant="outline" className="bg-transparent gap-2" onClick={() => setStatus("idle")}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {status === "done" && result && (
        <div className="flex flex-col gap-6">
          {/* Success banner */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
            <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Self-scan complete</p>
              <p className="text-xs text-muted-foreground">
                Scanned {result.url} in {(result.duration / 1000).toFixed(1)}s with {result.findings.length} finding(s)
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent shrink-0 gap-1 w-full sm:w-auto"
              onClick={() => {
                setStatus("idle")
                setResult(null)
              }}
            >
              Scan Again
            </Button>
          </div>

          <ScanSummary result={result} />

          {selectedIssue ? (
            <IssueDetail issue={selectedIssue} onBack={() => setSelectedIssue(null)} />
          ) : (
            <ResultsList findings={result.findings} onSelectIssue={setSelectedIssue} />
          )}
        </div>
      )}

      {/* Info section */}
      <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            title: "Transparency",
            description: "We run the same checks on ourselves that we run on any site. No special treatment.",
            color: "text-emerald-500",
          },
          {
            title: "Eat Our Own Cooking",
            description: "If we find issues on our own site, we fix them. This page proves we practice what we preach.",
            color: "text-blue-500",
          },
          {
            title: "Real Results",
            description: `These are live scan results, not pre-generated. The same ${TOTAL_CHECKS_LABEL} checks run in real-time.`,
            color: "text-amber-500",
          },
        ].map((item) => (
          <Card key={item.title} className="bg-card border-border">
            <CardContent className="p-5">
              <h3 className={cn("text-sm font-semibold mb-1.5", item.color)}>{item.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
