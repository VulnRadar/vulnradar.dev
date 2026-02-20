"use client"

import React from "react"
import { useState } from "react"
import { Shield, Loader2, Search, ArrowRight, Zap, Globe, SlidersHorizontal, Check, Lock, Cookie, FileCode, Eye, Settings, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TOTAL_CHECKS_LABEL } from "@/lib/constants"
import { cn } from "@/lib/utils"
import type { ScanStatus } from "@/lib/scanner/types"

export type ScanMode = "quick" | "deep"

export const SCANNER_CATEGORIES = [
  { id: "headers", label: "Security Headers", icon: Shield, description: "HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy" },
  { id: "ssl", label: "SSL / TLS", icon: Lock, description: "Certificate validity, protocol version, chain verification" },
  { id: "cookies", label: "Cookie Security", icon: Cookie, description: "Secure, HttpOnly, SameSite flags" },
  { id: "content", label: "Content Analysis", icon: FileCode, description: "Mixed content, DOM XSS sinks, iframes, reverse tabnabbing" },
  { id: "information-disclosure", label: "Info Disclosure", icon: Eye, description: "Server headers, source maps, secrets, private IPs, debug info" },
  { id: "configuration", label: "Configuration", icon: Settings, description: "robots.txt, security.txt, open redirects" },
  { id: "dns", label: "DNS & Email", icon: Mail, description: "SPF, DMARC, DKIM, DNSSEC records" },
] as const

export type ScannerCategoryId = (typeof SCANNER_CATEGORIES)[number]["id"]

const ALL_CATEGORY_IDS = SCANNER_CATEGORIES.map((c) => c.id)

interface ScanFormProps {
  onScan: (url: string, mode?: ScanMode, scanners?: string[]) => void
  status: ScanStatus
}

const FEATURES = [
  "Security headers",
  "SSL/TLS config",
  "Cookie security",
  "CORS policy",
  "Mixed content",
  `${TOTAL_CHECKS_LABEL} checks total`,
]

export function ScanForm({ onScan, status }: ScanFormProps) {
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  const [mode, setMode] = useState<ScanMode>("quick")
  const [selectedScanners, setSelectedScanners] = useState<Set<string>>(new Set(ALL_CATEGORY_IDS))
  const [selectorOpen, setSelectorOpen] = useState(false)

  const allSelected = selectedScanners.size === ALL_CATEGORY_IDS.length
  const noneSelected = selectedScanners.size === 0

  function toggleScanner(id: string) {
    setSelectedScanners((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelected) setSelectedScanners(new Set())
    else setSelectedScanners(new Set(ALL_CATEGORY_IDS))
  }

  function validate(input: string): boolean {
    if (!input.trim()) {
      setError("Please enter a URL")
      return false
    }
    try {
      const parsed = new URL(input)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setError("URL must start with http:// or https://")
        return false
      }
    } catch {
      setError("Please enter a valid URL (e.g., https://example.com)")
      return false
    }
    if (noneSelected) {
      setError("Select at least one scanner category")
      return false
    }
    setError("")
    return true
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (validate(url)) {
      const scanners = allSelected ? undefined : Array.from(selectedScanners)
      onScan(url, mode, scanners)
    }
  }

  const isScanning = status === "scanning"

  return (
    <div className="flex flex-col items-center gap-6 py-10 sm:py-16 px-4">
      {/* Hero text */}
      <div className="flex flex-col items-center gap-3 text-center max-w-xl">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground text-balance">
          Scan Your Website for Vulnerabilities
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-md">
          Enter any URL to run security checks across headers, SSL, cookies,
          content, and configuration.
        </p>
      </div>

      {/* Feature pills */}
      <div className="flex flex-wrap justify-center gap-2">
        {FEATURES.map((f) => (
          <span
            key={f}
            className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground"
          >
            {f}
          </span>
        ))}
      </div>

      {/* Scan mode toggle */}
      <div className="flex items-center gap-1.5 p-1 rounded-lg bg-muted/50 border border-border">
        <button
          type="button"
          onClick={() => setMode("quick")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
            mode === "quick"
              ? "bg-background text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Zap className="h-3 w-3" />
          Quick Scan
        </button>
        <button
          type="button"
          onClick={() => setMode("deep")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
            mode === "deep"
              ? "bg-background text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Globe className="h-3 w-3" />
          Deep Crawl
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground text-center -mt-2">
        {mode === "quick"
          ? "Scans the single URL you enter for vulnerabilities."
          : "Crawls the site to find internal pages, then scans each one."}
      </p>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 w-full max-w-lg"
      >
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                if (error) setError("")
              }}
              disabled={isScanning}
              className="pl-9 h-11 bg-card border-border text-foreground placeholder:text-muted-foreground"
              aria-label="Website URL to scan"
              aria-invalid={!!error}
              aria-describedby={error ? "url-error" : undefined}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={isScanning || noneSelected}
              className="h-11 px-6 font-medium shrink-0 flex-1 sm:flex-none"
            >
              {isScanning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Scanning
                </>
              ) : (
                <>
                  Scan
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isScanning}
                  className={cn(
                    "h-11 px-3 bg-transparent shrink-0",
                    !allSelected && "border-primary/50 text-primary",
                  )}
                  aria-label="Select scanners"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  <span className="hidden sm:inline ml-2 text-xs">
                    {allSelected ? "All Scanners" : `${selectedScanners.size}/${ALL_CATEGORY_IDS.length}`}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Select Scanners</span>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs text-primary hover:underline"
                  >
                    {allSelected ? "Deselect All" : "Select All"}
                  </button>
                </div>
                <div className="p-1.5 max-h-72 overflow-y-auto">
                  {SCANNER_CATEGORIES.map(({ id, label, icon: Icon, description }) => {
                    const checked = selectedScanners.has(id)
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleScanner(id)}
                        className={cn(
                          "w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors",
                          checked
                            ? "bg-primary/5 hover:bg-primary/10"
                            : "hover:bg-muted",
                        )}
                      >
                        <div className={cn(
                          "flex items-center justify-center w-5 h-5 rounded border mt-0.5 shrink-0 transition-colors",
                          checked
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-border",
                        )}>
                          {checked && <Check className="h-3 w-3" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium text-foreground">{label}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{description}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="px-3 py-2 border-t border-border">
                  <p className="text-[10px] text-muted-foreground text-center">
                    {selectedScanners.size} of {ALL_CATEGORY_IDS.length} scanner categories selected
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {error && (
          <p id="url-error" className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  )
}
