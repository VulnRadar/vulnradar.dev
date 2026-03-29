'use client'

import { Loader2, Radar } from 'lucide-react'
import { TOTAL_CHECKS_LABEL } from '@/lib/config/constants'

export function DemoScanning() {
  return (
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
          <p className="text-sm text-muted-foreground mb-6">Running {TOTAL_CHECKS_LABEL} security checks...</p>

          <div className="space-y-3">
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '75%' }} />
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>This usually takes a few seconds</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
