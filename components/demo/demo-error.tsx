"use client"

import { ShieldX, RefreshCw, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"

interface DemoErrorProps {
  error: string
  details?: string
  onRetry: () => void
}

export function DemoError({ error, details, onRetry }: DemoErrorProps) {
  const isBlocked = error === "This target cannot be scanned."
  
  return (
    <section className="relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-20 sm:pt-24">
        <div className="text-center max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <ShieldX className="h-8 w-8 text-destructive" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
            {isBlocked ? "Target Restricted" : "Scan Failed"}
          </h1>

          <p className="text-muted-foreground mb-4">
            {error}
          </p>

          {details && (
            <div className="text-left p-4 rounded-xl border border-border/50 bg-card/50 mb-6">
              <p className="text-xs text-muted-foreground leading-relaxed">{details}</p>
            </div>
          )}
          
          {isBlocked && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-6">
              <Mail className="h-3.5 w-3.5" />
              <span>
                Questions? Contact{" "}
                <Link href="mailto:support@vulnradar.dev" className="text-primary hover:underline">
                  support@vulnradar.dev
                </Link>
              </span>
            </div>
          )}

          <div>
            <Button onClick={onRetry} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
