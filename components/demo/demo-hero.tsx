'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sparkles, Play, Radar } from 'lucide-react'
import { TOTAL_CHECKS_LABEL, DEMO_SCAN_LIMIT, APP_NAME } from '@/lib/config/constants'

interface DemoHeroProps {
  scansRemaining: number | null
  onScan: () => void
  isLoading?: boolean
}

export function DemoHero({ scansRemaining, onScan, isLoading }: DemoHeroProps) {
  return (
    <section className="relative overflow-hidden -mx-4 px-4 -mt-8 pt-8 pb-16">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative text-center max-w-2xl mx-auto">
        <Badge variant="outline" className="mb-6 gap-2 py-1.5 px-4 border-primary/30 bg-primary/5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-sm">Live Demo</span>
        </Badge>

        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4 text-balance leading-[1.1]">
          See {APP_NAME} <span className="text-muted-foreground">in action</span>
        </h1>

        <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8 leading-relaxed text-pretty">
          Run a real vulnerability scan against this very site. Experience {TOTAL_CHECKS_LABEL} security checks in real-time.
        </p>

        {scansRemaining !== null && (
          <p className="text-sm text-muted-foreground mb-8">
            {scansRemaining} of {DEMO_SCAN_LIMIT} free scans remaining (resets every 12 hours)
          </p>
        )}

        <div className="max-w-md mx-auto">
          <div className="relative p-8 rounded-2xl border border-border bg-card shadow-xl">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />

            <div className="relative">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Radar className="h-10 w-10 text-primary" />
              </div>

              <h2 className="text-xl font-semibold mb-2">Ready to scan</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Scan{' '}
                <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                  {typeof window !== 'undefined' ? window.location.origin : 'this site'}
                </code>
              </p>

              <Button
                size="lg"
                className="w-full h-12 gap-2 shadow-lg shadow-primary/25"
                onClick={onScan}
                disabled={isLoading}
              >
                <Play className="h-4 w-4" />
                {isLoading ? 'Scanning...' : 'Run Self-Scan'}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-3 gap-4 max-w-lg mx-auto">
          {[
            { icon: '⚡', label: 'Lightning Fast' },
            { icon: '👁️', label: 'Deep Analysis' },
            { icon: '🔒', label: 'Privacy First' },
          ].map((item, i) => (
            <div key={i} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border/50 bg-card/30">
              <span className="text-2xl">{item.icon}</span>
              <span className="text-xs text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
