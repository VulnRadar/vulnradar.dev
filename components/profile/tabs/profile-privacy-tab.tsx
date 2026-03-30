'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  AlertTriangle,
  Clock,
  Download,
  Globe,
  Lock,
  Shield,
  Trash2,
} from 'lucide-react'
import { API } from '@/lib/config/constants'
import type { ProfileTabProps } from '@/components/profile/types'

export function ProfilePrivacyTab({
  user,
  loading,
  error,
  success,
  setError,
  setSuccess,
  pendingChanges,
  setPendingChanges,
}: ProfileTabProps) {
  const [dataReqInfo, setDataReqInfo] = useState<{
    hasData: boolean
    canDownloadNew: boolean
    cooldownEndsAt?: string
    lastDownloadAt?: string
  } | null>(null)
  const [requestingData, setRequestingData] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Fetch data export info on mount
  useEffect(() => {
    const fetchDataReqInfo = async () => {
      try {
        const res = await fetch(API.DATA_REQUEST)
        if (res.ok) {
          const data = await res.json()
          setDataReqInfo(data)
        }
      } catch {
        // Silently fail
      }
    }
    fetchDataReqInfo()
  }, [])

  async function handleRequestData() {
    setRequestingData(true)
    setError(null)
    try {
      const res = await fetch(API.DATA_REQUEST, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setSuccess('Data export initiated. You will receive an email with download link shortly.')
        setDataReqInfo(data)
      } else {
        setError(data.error || 'Failed to request data export.')
      }
    } catch {
      setError('Failed to request data export.')
    } finally {
      setRequestingData(false)
    }
  }

  async function handleDownloadPreviousData() {
    setRequestingData(true)
    setError(null)
    try {
      const res = await fetch(API.DATA_REQUEST, { method: 'GET' })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `vulnradar-data-export-${new Date().toISOString().split('T')[0]}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        setSuccess('Data export downloaded successfully.')
      } else {
        setError('Failed to download data export.')
      }
    } catch {
      setError('Failed to download data export.')
    } finally {
      setRequestingData(false)
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(API.ACCOUNT, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        setSuccess('Account deletion initiated. Redirecting to login...')
        setTimeout(() => {
          window.location.href = '/login'
        }, 1500)
      } else {
        setError(data.error || 'Failed to delete account.')
      }
    } catch {
      setError('Failed to delete account.')
    } finally {
      setDeleting(false)
    }
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  function getTimeRemaining(endDate: string) {
    const now = new Date()
    const end = new Date(endDate)
    const diff = end.getTime() - now.getTime()

    if (diff <= 0) return 'now'

    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading privacy settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Privacy & Data Protection */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Privacy & Data Protection</h2>
            <p className="text-sm text-muted-foreground">Protected under GDPR and privacy regulations</p>
          </div>
        </div>
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-card/50 border border-border">
                <Globe className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-foreground">GDPR Compliant</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Full compliance with EU data protection regulations</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-card/50 border border-border">
                <Lock className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Encrypted Storage</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Your data is encrypted at rest and in transit</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Data Export */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Download className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Data Export</h2>
            <p className="text-sm text-muted-foreground">Download your data, available every 30 days</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4">
              {/* Download Fresh Data Section */}
              <div className="flex flex-col gap-4 p-4 rounded-lg border border-border bg-secondary/30">
                {/* Can download fresh data - no cooldown or cooldown expired */}
                {dataReqInfo?.canDownloadNew && (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Download Fresh Export</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {dataReqInfo?.lastDownloadAt
                          ? 'Your 30-day cooldown has expired. Get a fresh export now.'
                          : 'Download your complete account data now.'}
                      </p>
                    </div>
                    <Button
                      onClick={handleRequestData}
                      disabled={requestingData}
                      className="shrink-0"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {requestingData ? 'Downloading...' : 'Download Now'}
                    </Button>
                  </div>
                )}

                {/* Cooldown active - can't get fresh data yet */}
                {!dataReqInfo?.canDownloadNew && dataReqInfo?.lastDownloadAt && (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Fresh Export Cooldown</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Next fresh export available in{' '}
                        <span className="font-mono text-foreground font-semibold">
                          {dataReqInfo.cooldownEndsAt ? getTimeRemaining(dataReqInfo.cooldownEndsAt) || 'soon' : 'soon'}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Last downloaded: {formatDate(dataReqInfo.lastDownloadAt)}
                      </p>
                    </div>
                    <Button disabled className="shrink-0">
                      <Clock className="mr-2 h-4 w-4" />
                      On Cooldown
                    </Button>
                  </div>
                )}
              </div>

              {/* Re-download Previous Export */}
              {dataReqInfo?.hasData && (
                <div className="flex flex-col gap-4 p-4 rounded-lg border border-border bg-muted/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Previous Export Available</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Re-download your last export anytime. This data was last updated {dataReqInfo.lastDownloadAt ? formatDate(dataReqInfo.lastDownloadAt) : 'recently'}.
                      </p>
                    </div>
                    <Button
                      onClick={handleDownloadPreviousData}
                      variant="outline"
                      className="shrink-0"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Re-download
                    </Button>
                  </div>
                </div>
              )}

              {/* How It Works Box */}
              <div className="flex gap-3 p-3 rounded-lg bg-muted/50 border border-border">
                <Download className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-foreground">How It Works</p>
                  <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                    <li>1. Click "Download Now" to get a fresh export</li>
                    <li>2. Your data downloads as a JSON file</li>
                    <li>3. Re-download anytime from "Previous Export"</li>
                    <li>4. Request a new fresh export after 30 days</li>
                  </ul>
                </div>
              </div>

              {/* What's Included Box */}
              <div className="flex gap-3 p-3 rounded-lg bg-muted/50 border border-border">
                <Shield className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-foreground">{`What's Included`}</p>
                  <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                    <li>Your profile information</li>
                    <li>All API keys and metadata</li>
                    <li>Complete scan history and results</li>
                    <li>API usage logs and statistics</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Danger Zone */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-destructive/10">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
            <p className="text-sm text-muted-foreground">Permanent account deletion, cannot be undone</p>
          </div>
        </div>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6">
            {!showDeleteConfirm ? (
              <Button
                variant="outline"
                className="text-destructive dark:text-red-400 border-destructive/30 hover:bg-destructive/10 hover:text-destructive dark:hover:text-red-400 bg-transparent"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Account
              </Button>
            ) : (
              <div className="flex flex-col gap-4 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
                <div>
                  <p className="text-sm font-semibold text-foreground">Are you absolutely sure?</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    This will permanently delete your account, all API keys, scan history, and data exports.
                    Type <span className="font-mono font-semibold text-destructive">DELETE</span> to confirm.
                  </p>
                </div>
                <Input
                  placeholder="Type DELETE to confirm"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="bg-card font-mono"
                />
                <div className="flex items-center gap-2">
                  <Button variant="destructive" disabled={deleteConfirmText !== 'DELETE' || deleting} onClick={handleDeleteAccount}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {deleting ? 'Deleting...' : 'Permanently Delete Account'}
                  </Button>
                  <Button variant="ghost" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText('') }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
