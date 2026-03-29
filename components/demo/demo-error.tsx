"use client"

import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DemoErrorProps {
  error: string
  onRetry: () => void
}

export function DemoError({ error, onRetry }: DemoErrorProps) {
  return (
    <section className="relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-20 sm:pt-24">
        <div className="text-center max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
            Scan failed
          </h1>

          <p className="text-muted-foreground mb-4">
            Something went wrong while scanning this site
          </p>

          <p className="text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-lg inline-block mb-8">
            {error}
          </p>

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
