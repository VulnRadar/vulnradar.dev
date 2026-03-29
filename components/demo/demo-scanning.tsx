"use client"

import { Loader2, Shield } from "lucide-react"
import { TOTAL_CHECKS_LABEL } from "@/lib/config/constants"

export function DemoScanning() {
  return (
    <section className="relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-20 sm:pt-24">
        <div className="text-center max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Shield className="h-8 w-8 text-primary animate-pulse" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
            Scanning in progress
          </h1>

          <p className="text-muted-foreground mb-8">
            Running {TOTAL_CHECKS_LABEL} security checks against this site
          </p>

          <div className="space-y-4 max-w-xs mx-auto">
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div 
                className="h-full bg-primary rounded-full animate-pulse" 
                style={{ width: "75%" }} 
              />
            </div>
            
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>This typically takes 10-30 seconds</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
