'use client'

import { useState, useEffect } from 'react'
import { Shield, LogIn, Lock, Fingerprint, MonitorSmartphone, Scan, CheckCircle2, AlertCircle, CalendarClock, Zap, Key, Gauge, Webhook, XCircle, UserCog, Download, Users, Mail } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import type { ProfileTabProps, NotificationPrefs } from '../types'

const DEFAULT_PREFS: NotificationPrefs = {
  email_security: true,
  email_new_login: true,
  email_password_change: true,
  email_2fa_change: true,
  email_session_revoked: true,
  email_scan_complete: true,
  email_critical_findings: true,
  email_regression_alert: true,
  email_schedules: true,
  email_api_keys: true,
  email_api_limit_warning: true,
  email_webhooks: true,
  email_webhook_failure: true,
  email_data_requests: true,
  email_account_deletion: true,
  email_team_invite: true,
  email_team_changes: true,
}

export function ProfileNotificationsTab({
  user: _user,
  loading: _loading,
  error: _error,
  success: _success,
  setError: _setError,
  setSuccess: _setSuccess,
  onTabChange: _onTabChange,
  pendingChanges: _pendingChanges,
  setPendingChanges,
  discardKey,
  saveKey,
  preloadedNotifPrefs,
}: ProfileTabProps) {
  // Initialize with preloaded data if available
  const initialPrefs = preloadedNotifPrefs ? { ...DEFAULT_PREFS, ...preloadedNotifPrefs } : DEFAULT_PREFS
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(initialPrefs)
  const [originalPrefs, setOriginalPrefs] = useState<NotificationPrefs>(initialPrefs)

  // Update state when preloaded data changes
  useEffect(() => {
    if (preloadedNotifPrefs) {
      const prefs = { ...DEFAULT_PREFS, ...preloadedNotifPrefs }
      setNotifPrefs(prefs)
      setOriginalPrefs(prefs)
    }
  }, [preloadedNotifPrefs])

  // Reset to original values when discardKey changes (discard was clicked)
  useEffect(() => {
    if (discardKey && discardKey > 0) {
      setNotifPrefs(originalPrefs)
    }
  }, [discardKey, originalPrefs])

  // Update original values when saveKey changes (save was successful)
  useEffect(() => {
    if (saveKey && saveKey > 0) {
      setOriginalPrefs(notifPrefs)
    }
  }, [saveKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = (key: keyof NotificationPrefs, checked: boolean) => {
    setNotifPrefs((prev) => ({ ...prev, [key]: checked }))
    // Track changes relative to original values
    const isChanged = checked !== originalPrefs[key]
    setPendingChanges((prev) => {
      const currentNotifs = (prev.notifications as Record<string, boolean>) || {}
      if (isChanged) {
        return {
          ...prev,
          notifications: { ...currentNotifs, [key]: checked },
        }
      } else {
        // Remove from pending if it's back to original
        const { [key]: _, ...rest } = currentNotifs
        const hasChanges = Object.keys(rest).length > 0
        if (hasChanges) {
          return { ...prev, notifications: rest }
        } else {
          const { notifications: __, ...otherChanges } = prev
          return otherChanges
        }
      }
    })
  }

  return (
    <div className="flex flex-col gap-8">
      {/* --- SECURITY --- */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Security Notifications</h2>
            <p className="text-sm text-muted-foreground">Critical alerts for account access and auth</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 pb-4 flex flex-col gap-4">
            {([
              { key: "email_security" as const, icon: Shield, label: "Security Alerts", desc: "Unusual activity, account compromise warnings, and critical security events.", badge: "Recommended" },
              { key: "email_new_login" as const, icon: LogIn, label: "Login Alerts", desc: "Notifications when someone signs into your account from a new device or location." },
              { key: "email_password_change" as const, icon: Lock, label: "Password Changes", desc: "Alerts when your password is changed or a reset is requested." },
              { key: "email_2fa_change" as const, icon: Fingerprint, label: "2FA Changes", desc: "Notifications when two-factor authentication is enabled, disabled, or modified." },
              { key: "email_session_revoked" as const, icon: MonitorSmartphone, label: "Session Alerts", desc: "Alerts about active sessions and session revocations." },
            ] as const).map(({ key, icon: Icon, label, desc, badge }) => (
              <div key={key} className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    {badge && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 uppercase font-semibold">{badge}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-5.5">{desc}</p>
                </div>
                <Switch checked={notifPrefs[key]} onCheckedChange={(checked) => handleToggle(key, checked)} />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* --- SCANNING --- */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Scan className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Scanning Notifications</h2>
            <p className="text-sm text-muted-foreground">Results and scheduled scan alerts</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 pb-4 flex flex-col gap-4">
            {([
              { key: "email_scan_complete" as const, icon: CheckCircle2, label: "Scan Completed", desc: "Alerts when vulnerability scans are finished." },
              { key: "email_critical_findings" as const, icon: AlertCircle, label: "Critical Issues Found", desc: "Immediate alerts when critical vulnerabilities are detected." },
              { key: "email_schedules" as const, icon: CalendarClock, label: "Scheduled Scans Completed", desc: "Alerts when your scheduled scans finish." },
            ] as const).map(({ key, icon: Icon, label, desc }) => (
              <div key={key} className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">{label}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-5.5">{desc}</p>
                </div>
                <Switch checked={notifPrefs[key]} onCheckedChange={(checked) => handleToggle(key, checked)} />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* --- API & INTEGRATIONS --- */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{"API & Integrations"}</h2>
            <p className="text-sm text-muted-foreground">API keys, limits, and webhook alerts</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 pb-4 flex flex-col gap-4">
            {([
              { key: "email_api_keys" as const, icon: Key, label: "API Key Activity", desc: "Alerts when API keys are created, revoked, or approaching expiration." },
              { key: "email_api_limit_warning" as const, icon: Gauge, label: "API Limit Warnings", desc: "Warnings when your API usage nears rate limits or daily quotas." },
              { key: "email_webhooks" as const, icon: Webhook, label: "Webhook Events", desc: "Notifications when webhooks are created, modified, or disabled." },
              { key: "email_webhook_failure" as const, icon: XCircle, label: "Webhook Failures", desc: "Alerts when webhook deliveries fail repeatedly." },
            ] as const).map(({ key, icon: Icon, label, desc }) => (
              <div key={key} className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">{label}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-5.5">{desc}</p>
                </div>
                <Switch checked={notifPrefs[key]} onCheckedChange={(checked) => handleToggle(key, checked)} />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* --- ACCOUNT --- */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <UserCog className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Account Notifications</h2>
            <p className="text-sm text-muted-foreground">Account and team activity alerts</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 pb-4 flex flex-col gap-4">
            {([
              { key: "email_data_requests" as const, icon: Download, label: "Data Export Updates", desc: "Notifications when your data export is ready for download." },
              { key: "email_account_deletion" as const, icon: UserCog, label: "Account Deletion", desc: "Confirmations and alerts when account deletion is requested or processed." },
              { key: "email_team_invite" as const, icon: Users, label: "Team Invites", desc: "Notifications when you're invited to join a team or workspace." },
              { key: "email_team_changes" as const, icon: Users, label: "Team Changes", desc: "Alerts about team membership changes, role updates, and team activity." },
            ] as const).map(({ key, icon: Icon, label, desc }) => (
              <div key={key} className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/30">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">{label}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-5.5">{desc}</p>
                </div>
                <Switch checked={notifPrefs[key]} onCheckedChange={(checked) => handleToggle(key, checked)} />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Info card */}
      <section>
        <Card className="border-border/40 bg-card/30">
          <CardContent className="pt-5 pb-5">
            <div className="flex gap-3">
              <div className="p-2 rounded-lg bg-muted/50">
                <Mail className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">About Email Notifications</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  We only send essential notifications. Critical security alerts are always sent regardless of your preferences.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
