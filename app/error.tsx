"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { AlertTriangle, Home, RotateCcw, Terminal, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { APP_NAME } from "@/lib/constants"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    console.error("[VulnRadar] Unhandled error:", error)
  }, [error])

  function copyErrorId() {
    if (error.digest) {
      navigator.clipboard.writeText(error.digest)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* Decorative grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.3)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.3)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,black_40%,transparent_100%)]" />

      <div className="relative w-full max-w-lg flex flex-col items-center gap-8">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Image
            src="/favicon.svg"
            alt={`${APP_NAME} logo`}
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="text-2xl font-bold text-foreground font-mono tracking-tight">{APP_NAME}</span>
        </div>

        {/* Error visual */}
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="relative">
            <div className="absolute inset-0 bg-destructive/15 blur-3xl rounded-full scale-150" />
            <div className="relative flex items-center justify-center w-28 h-28 rounded-2xl bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="h-14 w-14 text-destructive" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h1 className="text-7xl font-bold text-foreground font-mono">500</h1>
            <h2 className="text-xl font-semibold text-foreground text-balance">Internal Server Error</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm text-pretty">
              Something broke on our end. This has been logged and we'll look into it. Try again or head back to safety.
            </p>
          </div>

          {/* Terminal-style error block */}
          {error.digest && (
            <div className="w-full max-w-sm rounded-lg border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <Terminal className="h-3.5 w-3.5" />
                  error details
                </div>
                <button
                  onClick={copyErrorId}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <div className="px-3 py-2.5">
                <p className="text-xs font-mono text-muted-foreground">
                  <span className="text-destructive">error.digest</span> = <span className="text-foreground">{`"${error.digest}"`}</span>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
          <Button onClick={reset} variant="default" className="flex-1 gap-2">
            <RotateCcw className="h-4 w-4" />
            Try Again
          </Button>
          <Button asChild variant="outline" className="flex-1 bg-transparent">
            <Link href="/" className="flex items-center justify-center gap-2">
              <Home className="h-4 w-4" />
              Go Home
            </Link>
          </Button>
        </div>

        {/* Helper Links */}
        <div className="flex flex-col items-center gap-2 pt-4">
          <p className="text-xs text-muted-foreground">Need help?</p>
          <div className="flex gap-4 text-xs">
            <Link href="/contact" className="text-primary hover:underline">
              Contact Support
            </Link>
            <span className="text-muted-foreground">{"·"}</span>
            <Link href="/docs" className="text-primary hover:underline">
              Documentation
            </Link>
            <span className="text-muted-foreground">{"·"}</span>
            <Link href="/changelog" className="text-primary hover:underline">
              Changelog
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
