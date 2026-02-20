"use client"

import { useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { AlertTriangle, Home, RotateCcw } from "@/lib/icons"
import { Button } from "@/components/ui/button"
import { APP_NAME } from "@/lib/constants"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[VulnRadar] Unhandled error:", error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-8">
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

        {/* Error Icon and Message */}
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="relative">
            <div className="absolute inset-0 bg-destructive/20 blur-3xl rounded-full" />
            <div className="relative flex items-center justify-center w-24 h-24 rounded-full bg-destructive/10 border-2 border-destructive/20">
              <AlertTriangle className="h-12 w-12 text-destructive" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h1 className="text-6xl font-bold text-foreground font-mono">500</h1>
            <h2 className="text-xl font-semibold text-foreground">Something Went Wrong</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
              An unexpected error occurred while loading this page.
              This is usually temporary -- try again or head back home.
            </p>
          </div>

          {error.digest && (
            <p className="text-xs text-muted-foreground font-mono bg-muted/50 border border-border rounded-lg px-3 py-1.5">
              Error ID: {error.digest}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 w-full">
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
            <span className="text-muted-foreground">·</span>
            <Link href="/docs" className="text-primary hover:underline">
              Documentation
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link href="/changelog" className="text-primary hover:underline">
              Changelog
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
