"use client"

import React from "react"
import { useState } from "react"
import { Shield, Loader2, Search, ArrowRight, Zap, Globe } from "@/lib/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TOTAL_CHECKS_LABEL } from "@/lib/constants"
import { cn } from "@/lib/utils"
import type { ScanStatus } from "@/lib/scanner/types"

export type ScanMode = "quick" | "deep"

interface ScanFormProps {
  onScan: (url: string, mode?: ScanMode) => void
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
    setError("")
    return true
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (validate(url)) {
      onScan(url, mode)
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
          <Button
            type="submit"
            disabled={isScanning}
            className="h-11 px-6 font-medium shrink-0"
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
