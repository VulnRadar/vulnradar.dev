"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Terminal, Play, CheckCircle } from "lucide-react"
import { TOTAL_CHECKS_LABEL, DEMO_SCAN_LIMIT, APP_NAME } from "@/lib/config/constants"

interface DemoHeroProps {
  scansRemaining: number | null
  onScan: () => void
  isLoading?: boolean
}

export function DemoHero({ scansRemaining, onScan, isLoading }: DemoHeroProps) {
  return (
    <section className="relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-12 sm:pt-20">
        <div className="text-center max-w-2xl mx-auto">
          <Badge variant="outline" className="mb-5 gap-1.5 py-1 px-3 border-primary/30 bg-primary/5 text-xs">
            <Terminal className="h-3 w-3 text-primary" />
            Live Demo
          </Badge>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-5 text-balance">
            See {APP_NAME}{" "}
            <span className="text-muted-foreground">in action</span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto mb-8 text-pretty">
            Run a real vulnerability scan against this site. Experience {TOTAL_CHECKS_LABEL} security checks in real-time.
          </p>

          <div className="flex flex-col items-center gap-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/50 border border-border/50 text-sm">
              <span className="text-muted-foreground">Target:</span>
              <code className="font-mono text-foreground">
                {typeof window !== "undefined" ? window.location.origin : "vulnradar.dev"}
              </code>
            </div>

            <Button
              size="lg"
              className="h-11 px-8 gap-2"
              onClick={onScan}
              disabled={isLoading}
            >
              <Play className="h-4 w-4" />
              {isLoading ? "Initializing..." : "Run Self-Scan"}
            </Button>

            {scansRemaining !== null && (
              <p className="text-sm text-muted-foreground">
                {scansRemaining} of {DEMO_SCAN_LIMIT} free scans remaining
              </p>
            )}
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
            {["No account required", "Real-time results", "Full vulnerability report"].map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-primary" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
