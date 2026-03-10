"use client"

import React from "react"
import { useState } from "react"
import { Shield, Loader2, Search, ArrowRight, Zap, Globe, SlidersHorizontal, Check, Lock, Cookie, FileCode, Eye, Settings, Mail, ChevronDown, List } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { TOTAL_CHECKS_LABEL } from "@/lib/constants"
import { cn } from "@/lib/utils"
import type { ScanStatus } from "@/lib/scanner/types"

// Protocol definitions with their applicable scanner categories
export const SCAN_PROTOCOLS = [
  { value: "https://", label: "HTTPS", description: "Secure HTTP (recommended)", categories: ["headers", "ssl", "cookies", "content", "information-disclosure", "configuration", "dns"] },
  { value: "http://", label: "HTTP", description: "Unencrypted HTTP", categories: ["headers", "cookies", "content", "information-disclosure", "configuration", "dns"] },
  { value: "wss://", label: "WSS", description: "Secure WebSocket", categories: ["ssl", "headers"] },
  { value: "ws://", label: "WS", description: "WebSocket", categories: ["headers"] },
  { value: "ftp://", label: "FTP", description: "File Transfer Protocol", categories: ["configuration"] },
  { value: "ftps://", label: "FTPS", description: "Secure FTP", categories: ["ssl", "configuration"] },
] as const

export type ScanProtocol = (typeof SCAN_PROTOCOLS)[number]["value"]

export function isHttpProtocol(protocol: ScanProtocol): boolean {
  return protocol === "https://" || protocol === "http://"
}

export type ScanMode = "quick" | "deep" | "bulk"

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
  onScan: (url: string, mode?: ScanMode, scanners?: string[], protocol?: ScanProtocol) => void
  onBulkScan?: (urls: string[]) => void
  bulkStatus?: "idle" | "scanning" | "done"
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

export function ScanForm({ onScan, onBulkScan, bulkStatus = "idle", status }: ScanFormProps) {
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  const [mode, setMode] = useState<ScanMode>("quick")
  const [protocol, setProtocol] = useState<ScanProtocol>("https://")
  const [selectedScanners, setSelectedScanners] = useState<Set<string>>(new Set(ALL_CATEGORY_IDS))
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [bulkUrls, setBulkUrls] = useState("")
  const [bulkError, setBulkError] = useState("")

  // Get available categories for current protocol
  const protocolConfig = SCAN_PROTOCOLS.find(p => p.value === protocol)
  const availableCategories = protocolConfig?.categories || []

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
      setError("Please enter a domain or URL")
      return false
    }
    // Strip any existing protocol for validation
    const cleaned = input.replace(/^(?:https?|wss?|ftps?):\/\//i, "").trim()
    if (!cleaned) {
      setError("Please enter a valid domain")
      return false
    }
    // Basic domain validation
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*(\.[a-zA-Z]{2,})?(:\d+)?(\/.*)?$/
    if (!domainRegex.test(cleaned)) {
      setError("Please enter a valid domain (e.g., example.com)")
      return false
    }
    // Check if any selected scanners are available for this protocol
    const validScanners = Array.from(selectedScanners).filter(s => availableCategories.includes(s))
    if (validScanners.length === 0) {
      setError(`No selected scanners available for ${protocol.replace("://", "").toUpperCase()} protocol`)
      return false
    }
    setError("")
    return true
  }

  // Build full URL with selected protocol
  function buildFullUrl(input: string): string {
    const cleaned = input.replace(/^(?:https?|wss?|ftps?):\/\//i, "").trim()
    return protocol + cleaned
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (validate(url)) {
      const fullUrl = buildFullUrl(url)
      const validScanners = Array.from(selectedScanners).filter(s => availableCategories.includes(s))
      const scanners = validScanners.length === availableCategories.length ? undefined : validScanners
      onScan(fullUrl, mode, scanners, protocol)
    }
  }

  function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBulkError("")
    const lines = bulkUrls.split("\n").map(u => u.trim()).filter(Boolean)
    if (lines.length === 0) { setBulkError("Enter at least one URL."); return }
    if (lines.length > 10) { setBulkError("Maximum 10 URLs per bulk scan."); return }
    const invalid = lines.filter(u => { try { new URL(u); return false } catch { return true } })
    if (invalid.length > 0) { setBulkError(`Invalid URLs: ${invalid.slice(0, 2).join(", ")}${invalid.length > 2 ? "…" : ""}`); return }
    onBulkScan?.(lines)
  }

  const isScanning = status === "scanning"
  const isBulkScanning = bulkStatus === "scanning"

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
          onClick={() => isHttpProtocol(protocol) && setMode("deep")}
          disabled={!isHttpProtocol(protocol)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
            !isHttpProtocol(protocol) && "opacity-50 cursor-not-allowed",
            mode === "deep"
              ? "bg-background text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground",
          )}
          title={!isHttpProtocol(protocol) ? "Deep crawl only available for HTTP/HTTPS" : undefined}
        >
          <Globe className="h-3 w-3" />
          Deep Crawl
        </button>
        <button
          type="button"
          onClick={() => setMode("bulk")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
            mode === "bulk"
              ? "bg-background text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <List className="h-3 w-3" />
          Bulk Scan
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground text-center -mt-2">
        {mode === "quick" && `Scans the single ${protocol.replace("://", "").toUpperCase()} endpoint for vulnerabilities.`}
        {mode === "deep" && "Crawls the site to find internal pages, then scans each one."}
        {mode === "bulk" && "Scan up to 10 URLs at once. Each URL counts toward your daily limit."}
      </p>

      {/* Single URL form (Quick / Deep) */}
      {mode !== "bulk" && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full max-w-lg">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 flex">
              {/* Protocol dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={isScanning}
                    className={cn(
                      "flex items-center gap-1 px-3 h-11 rounded-l-md border border-r-0 border-border bg-muted/50 text-xs font-mono font-medium text-muted-foreground hover:bg-muted transition-colors shrink-0",
                      isScanning && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {protocol.replace("://", "")}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {SCAN_PROTOCOLS.map((p) => (
                    <DropdownMenuItem
                      key={p.value}
                      onClick={() => {
                        setProtocol(p.value)
                        const protoCfg = SCAN_PROTOCOLS.find(pr => pr.value === p.value)
                        if (protoCfg) {
                          setSelectedScanners(new Set(protoCfg.categories.filter(c => ALL_CATEGORY_IDS.includes(c))))
                        }
                        if (p.value !== "https://" && p.value !== "http://") {
                          setMode("quick")
                        }
                      }}
                      className={cn(
                        "flex flex-col items-start gap-0.5",
                        protocol === p.value && "bg-primary/10"
                      )}
                    >
                      <span className="font-mono font-medium">{p.value}</span>
                      <span className="text-[10px] text-muted-foreground">{p.description}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* URL input */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="example.com"
                  value={url}
                  onChange={(e) => {
                    const val = e.target.value.replace(/^(?:https?|wss?|ftps?):\/\//i, "")
                    setUrl(val)
                    if (error) setError("")
                  }}
                  disabled={isScanning}
                  className="pl-9 h-11 rounded-l-none bg-card border-border text-foreground placeholder:text-muted-foreground"
                  aria-label="Domain or URL to scan"
                  aria-invalid={!!error}
                  aria-describedby={error ? "url-error" : undefined}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={isScanning || noneSelected}
                className="h-11 px-6 font-medium shrink-0 flex-1 sm:flex-none"
              >
                {isScanning ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scanning</>
                ) : (
                  <>Scan<ArrowRight className="ml-2 h-4 w-4" /></>
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
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">Select Scanners</span>
                      <span className="text-[10px] text-muted-foreground">
                        {availableCategories.length} available for {protocol.replace("://", "").toUpperCase()}
                      </span>
                    </div>
                    <button type="button" onClick={toggleAll} className="text-xs text-primary hover:underline">
                      {allSelected ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                  <div className="p-1.5 max-h-72 overflow-y-auto">
                    {SCANNER_CATEGORIES.map(({ id, label, icon: Icon, description }) => {
                      const checked = selectedScanners.has(id)
                      const isAvailable = availableCategories.includes(id)
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => isAvailable && toggleScanner(id)}
                          disabled={!isAvailable}
                          className={cn(
                            "w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors",
                            !isAvailable && "opacity-40 cursor-not-allowed",
                            isAvailable && checked ? "bg-primary/5 hover:bg-primary/10" : isAvailable && "hover:bg-muted",
                          )}
                        >
                          <div className={cn(
                            "flex items-center justify-center w-5 h-5 rounded border mt-0.5 shrink-0 transition-colors",
                            checked && isAvailable ? "bg-primary border-primary text-primary-foreground" : "border-border",
                          )}>
                            {checked && isAvailable && <Check className="h-3 w-3" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium text-foreground">{label}</span>
                              {!isAvailable && (
                                <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                  N/A for {protocol.replace("://", "").toUpperCase()}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{description}</p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  <div className="px-3 py-2 border-t border-border">
                    <p className="text-[10px] text-muted-foreground text-center">
                      {Array.from(selectedScanners).filter(s => availableCategories.includes(s)).length} of {availableCategories.length} available scanners selected
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {error && (
            <p id="url-error" className="text-sm text-destructive" role="alert">{error}</p>
          )}
        </form>
      )}

      {/* Bulk scan form */}
      {mode === "bulk" && (
        <form onSubmit={handleBulkSubmit} className="flex flex-col gap-3 w-full max-w-lg">
          <textarea
            placeholder={"https://example.com\nhttps://another-site.com\nhttps://third-site.com"}
            value={bulkUrls}
            onChange={(e) => { setBulkUrls(e.target.value); if (bulkError) setBulkError("") }}
            rows={5}
            disabled={isBulkScanning}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono disabled:opacity-50"
            aria-label="URLs to bulk scan, one per line"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              {bulkUrls.split("\n").filter(u => u.trim()).length} / 10 URLs &middot; one per line &middot; must include https://
            </p>
            <Button
              type="submit"
              disabled={isBulkScanning || !bulkUrls.trim()}
              className="h-10 px-5 font-medium shrink-0"
            >
              {isBulkScanning ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scanning...</>
              ) : (
                <><List className="mr-2 h-4 w-4" />Start Bulk Scan</>
              )}
            </Button>
          </div>
          {bulkError && (
            <p className="text-sm text-destructive" role="alert">{bulkError}</p>
          )}
        </form>
      )}
    </div>
  )
}
