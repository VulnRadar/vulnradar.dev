"use client"

import { useState } from "react"
import { ScanSummary } from "@/components/scanner/scan-summary"
import { ResultsList } from "@/components/scanner/results-list"
import { IssueDetail } from "@/components/scanner/issue-detail"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/ui/utils"
import { Radar, Shield, Loader2, AlertTriangle, CheckCircle, Sparkles, ArrowRight, Play, RotateCcw, Zap, Eye, Lock } from "lucide-react"
import { ResponseHeaders } from "@/components/scanner/response-headers"
import { SubdomainDiscovery } from "@/components/scanner/subdomain-discovery"
import { TOTAL_CHECKS_LABEL, DEMO_SCAN_LIMIT, API, APP_NAME, ROUTES } from "@/lib/config/constants"
import type { ScanResult, Vulnerability } from "@/lib/scanner/types"
import Link from "next/link"

export default function DemoPage() {
  const [status, setStatus] = useState<"idle" | "scanning" | "done" | "error">("idle")
  const [result, setResult] = useState<ScanResult | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scansRemaining, setScansRemaining] = useState<number | null>(null)

  async function handleSelfScan() {
    setStatus("scanning")
    setResult(null)
    setError(null)
    setSelectedIssue(null)

    try {
      const siteUrl = window.location.origin
      const res = await fetch(API.DEMO_SCAN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: siteUrl }),
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
      setError("Something went wrong")
      setStatus("error")
    }
  }

  return (
    <div className="min-h-0">
      {/* Hero Section - Only show when idle */}
      {status === "idle" && (
        <section className="relative overflow-hidden -mx-4 px-4 -mt-8 pt-8 pb-16">
          {/* Glowing orb background */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-primary/5 rounded-full blur-3xl" />
          </div>
          
          <div className="relative text-center max-w-2xl mx-auto">
            <Badge variant="outline" className="mb-6 gap-2 py-1.5 px-4 border-primary/30 bg-primary/5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm">Live Demo</span>
            </Badge>
            
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4 text-balance leading-[1.1]">
              See {APP_NAME}{" "}
              <span className="text-muted-foreground">in action</span>
            </h1>
            
            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8 leading-relaxed text-pretty">
              Run a real vulnerability scan against this very site. Experience {TOTAL_CHECKS_LABEL} security checks in real-time.
            </p>

            {scansRemaining !== null && (
              <p className="text-sm text-muted-foreground mb-8">
                {scansRemaining} of {DEMO_SCAN_LIMIT} free scans remaining (resets every 12 hours)
              </p>
            )}

            {/* Scan Card */}
            <div className="max-w-md mx-auto">
              <div className="relative p-8 rounded-2xl border border-border bg-card shadow-xl">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
                
                <div className="relative">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Radar className="h-10 w-10 text-primary" />
                  </div>
                  
                  <h2 className="text-xl font-semibold mb-2">Ready to scan</h2>
                  <p className="text-sm text-muted-foreground mb-6">
                    Scan{" "}
                    <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                      {typeof window !== "undefined" ? window.location.origin : "this site"}
                    </code>
                  </p>
                  
                  <Button size="lg" className="w-full h-12 gap-2 shadow-lg shadow-primary/25" onClick={handleSelfScan}>
                    <Play className="h-4 w-4" />
                    Run Self-Scan
                  </Button>
                </div>
              </div>
            </div>

            {/* Features preview */}
            <div className="mt-12 grid grid-cols-3 gap-4 max-w-lg mx-auto">
              {[
                { icon: Zap, label: "Lightning Fast" },
                { icon: Eye, label: "Deep Analysis" },
                { icon: Lock, label: "Privacy First" },
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border/50 bg-card/30">
                  <item.icon className="h-5 w-5 text-primary" />
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Scanning State */}
      {status === "scanning" && (
        <section className="relative overflow-hidden -mx-4 px-4 -mt-8 pt-8 pb-16">
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-primary/5 rounded-full blur-3xl animate-pulse" />
          </div>
          
          <div className="relative text-center max-w-md mx-auto">
            <div className="p-8 rounded-2xl border border-border bg-card shadow-xl">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="absolute inset-0 rounded-2xl bg-primary/10 animate-ping" />
                <div className="relative w-full h-full rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Radar className="h-12 w-12 text-primary animate-pulse" />
                </div>
              </div>
              
              <h2 className="text-xl font-semibold mb-2">Scanning in progress</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Running {TOTAL_CHECKS_LABEL} security checks...
              </p>
              
              <div className="space-y-3">
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: "75%" }} />
                </div>
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>This usually takes a few seconds</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Error State */}
      {status === "error" && (
        <section className="relative overflow-hidden -mx-4 px-4 -mt-8 pt-8 pb-16">
          <div className="relative text-center max-w-md mx-auto">
            <div className="p-8 rounded-2xl border border-destructive/30 bg-card shadow-xl">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-10 w-10 text-destructive" />
              </div>
              
              <h2 className="text-xl font-semibold mb-2">Scan failed</h2>
              <p className="text-sm text-muted-foreground mb-6">{error}</p>
              
              <Button variant="outline" className="gap-2" onClick={() => setStatus("idle")}>
                <RotateCcw className="h-4 w-4" />
                Try Again
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Results */}
      {status === "done" && result && (
        <div className="space-y-6">
          {selectedIssue ? (
            <IssueDetail issue={selectedIssue} onBack={() => setSelectedIssue(null)} />
          ) : (
            <>
              {/* Results Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 rounded-2xl border border-border bg-card">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <CheckCircle className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Scan Complete</p>
                    <p className="font-semibold">
                      {result.findings.length} finding{result.findings.length !== 1 ? "s" : ""} in {(result.duration / 1000).toFixed(1)}s
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setStatus("idle")
                      setResult(null)
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Scan Again
                  </Button>
                  <Link href={ROUTES.SIGNUP}>
                    <Button size="sm" className="gap-1.5">
                      Create Account
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Scan Results */}
              <ScanSummary result={result} />

              {result.responseHeaders && Object.keys(result.responseHeaders).length > 0 && (
                <ResponseHeaders headers={result.responseHeaders} />
              )}

              <SubdomainDiscovery url={result.url} />

              <ResultsList findings={result.findings} onSelectIssue={setSelectedIssue} />
            </>
          )}
        </div>
      )}

      {/* Bottom CTA - Show when results are displayed or on error */}
      {(status === "done" || status === "error") && (
        <section className="mt-16 -mx-4 px-4 py-12 border-t border-border bg-muted/30">
          <div className="text-center max-w-xl mx-auto">
            <h2 className="text-2xl font-bold mb-3 tracking-tight">Ready for more?</h2>
            <p className="text-muted-foreground mb-6">
              Create a free account to scan your own sites, track history, and access the full API.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href={ROUTES.SIGNUP}>
                <Button size="lg" className="gap-2 shadow-lg shadow-primary/25">
                  Get Started Free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href={ROUTES.PRICING}>
                <Button size="lg" variant="outline">
                  View Pricing
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Info Cards - Only show when idle */}
      {status === "idle" && (
        <section className="mt-16 pt-12 border-t border-border">
          <h3 className="text-lg font-semibold text-center mb-6">Why run a self-scan?</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                title: "Transparency",
                description: "We run the same checks on ourselves that we run on any site. No special treatment.",
              },
              {
                title: "Eat Our Own Cooking",
                description: "If we find issues on our own site, we fix them. This proves we practice what we preach.",
              },
              {
                title: "Real Results",
                description: `Live scan results, not pre-generated. The same ${TOTAL_CHECKS_LABEL} checks run in real-time.`,
              },
            ].map((item, i) => (
              <div key={i} className="p-6 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
                <h4 className="font-semibold mb-2 text-primary">{item.title}</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
