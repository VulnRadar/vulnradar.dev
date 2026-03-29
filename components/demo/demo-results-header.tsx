'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { CheckCircle, RotateCcw, ArrowRight } from 'lucide-react'
import { ROUTES } from '@/lib/config/constants'
import type { ScanResult } from '@/lib/scanner/types'

interface DemoResultsHeaderProps {
  result: ScanResult
  onScanAgain: () => void
}

export function DemoResultsHeader({ result, onScanAgain }: DemoResultsHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
          <CheckCircle className="h-6 w-6 text-primary" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Scan Complete</p>
          <p className="font-semibold">
            {result.findings.length} finding{result.findings.length !== 1 ? 's' : ''} in{' '}
            {(result.duration / 1000).toFixed(1)}s
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onScanAgain}>
          <RotateCcw className="h-4 w-4" />
          Scan Again
        </Button>
        <Link href={ROUTES.SIGNUP}>
          <Button size="sm" className="gap-1.5">
            Create Account
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  )
}
