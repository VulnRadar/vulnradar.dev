'use client'

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DemoErrorProps {
  error: string
  onRetry: () => void
}

export function DemoError({ error, onRetry }: DemoErrorProps) {
  return (
    <section className="relative overflow-hidden -mx-4 px-4 -mt-8 pt-8 pb-16">
      <div className="relative text-center max-w-md mx-auto">
        <div className="p-8 rounded-2xl border border-destructive/30 bg-card shadow-xl">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-10 w-10 text-destructive" />
          </div>

          <h2 className="text-xl font-semibold mb-2">Scan failed</h2>
          <p className="text-sm text-muted-foreground mb-6">{error}</p>

          <Button variant="outline" className="gap-2" onClick={onRetry}>
            <RotateCcw className="h-4 w-4" />
            Try Again
          </Button>
        </div>
      </div>
    </section>
  )
}
