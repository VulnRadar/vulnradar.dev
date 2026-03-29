'use client'

import { useState } from 'react'
import { ScanSummary } from '@/components/scanner/scan-summary'
import { ResultsList } from '@/components/scanner/results-list'
import { IssueDetail } from '@/components/scanner/issue-detail'
import {
  DemoHero,
  DemoScanning,
  DemoError,
  DemoResultsHeader,
  DemoCTA,
  DemoInfo,
} from '@/components/demo'
import { ResponseHeaders } from '@/components/scanner/response-headers'
import { SubdomainDiscovery } from '@/components/scanner/subdomain-discovery'
import { API } from '@/lib/config/constants'
import type { ScanResult, Vulnerability } from '@/lib/scanner/types'

export default function DemoPage() {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<Vulnerability | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scansRemaining, setScansRemaining] = useState<number | null>(null)

  async function handleSelfScan() {
    setStatus('scanning')
    setResult(null)
    setError(null)
    setSelectedIssue(null)

    try {
      const siteUrl = window.location.origin
      const res = await fetch(API.DEMO_SCAN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: siteUrl }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Scan failed')
        if (typeof data.remaining === 'number') setScansRemaining(data.remaining)
        setStatus('error')
        return
      }

      setResult(data)
      if (typeof data.remaining === 'number') setScansRemaining(data.remaining)
      setStatus('done')
    } catch {
      setError('Something went wrong')
      setStatus('error')
    }
  }

  return (
    <div className="min-h-0">
      {/* Hero Section */}
      {status === 'idle' && (
        <>
          <DemoHero scansRemaining={scansRemaining} onScan={handleSelfScan} />
          <DemoInfo />
        </>
      )}

      {/* Scanning State */}
      {status === 'scanning' && <DemoScanning />}

      {/* Error State */}
      {status === 'error' && (
        <DemoError
          error={error || 'An error occurred'}
          onRetry={() => setStatus('idle')}
        />
      )}

      {/* Results */}
      {status === 'done' && result && (
        <div className="space-y-6">
          {selectedIssue ? (
            <IssueDetail issue={selectedIssue} onBack={() => setSelectedIssue(null)} />
          ) : (
            <>
              <DemoResultsHeader
                result={result}
                onScanAgain={() => {
                  setStatus('idle')
                  setResult(null)
                }}
              />

              <ScanSummary result={result} />

              {result.responseHeaders && Object.keys(result.responseHeaders).length > 0 && (
                <ResponseHeaders headers={result.responseHeaders} />
              )}

              <SubdomainDiscovery url={result.url} />

              <ResultsList findings={result.findings} onSelectIssue={setSelectedIssue} />
            </>
          )}
        </div>
      )}

      {/* Bottom CTA */}
      {(status === 'done' || status === 'error') && <DemoCTA />}
    </div>
  )
}
