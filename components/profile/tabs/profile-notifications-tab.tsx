"use client";

import { useState, useEffect } from "react";
import {
  Shield,
  LogIn,
  Lock,
  Fingerprint,
  MonitorSmartphone,
  CheckCircle2,
  AlertCircle,
  CalendarClock,
  Key,
  Gauge,
  Webhook,
  XCircle,
  UserCog,
  Download,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { ProfileTabProps, NotificationPrefs } from "../types";

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
};

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
  const initialPrefs = preloadedNotifPrefs
    ? { ...DEFAULT_PREFS, ...preloadedNotifPrefs }
    : DEFAULT_PREFS;
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(initialPrefs);
  const [originalPrefs, setOriginalPrefs] =
    useState<NotificationPrefs>(initialPrefs);

  // Update state when preloaded data changes
  useEffect(() => {
    if (preloadedNotifPrefs) {
      const prefs = { ...DEFAULT_PREFS, ...preloadedNotifPrefs };
      setNotifPrefs(prefs);
      setOriginalPrefs(prefs);
    }
  }, [preloadedNotifPrefs]);

  // Reset to original values when discardKey changes (discard was clicked)
  useEffect(() => {
    if (discardKey && discardKey > 0) {
      setNotifPrefs(originalPrefs);
    }
  }, [discardKey, originalPrefs]);

  // Update original values when saveKey changes (save was successful)
  useEffect(() => {
    if (saveKey && saveKey > 0) {
      setOriginalPrefs(notifPrefs);
    }
  }, [saveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = (key: keyof NotificationPrefs, checked: boolean) => {
    setNotifPrefs((prev) => ({ ...prev, [key]: checked }));
    // Track changes relative to original values
    const isChanged = checked !== originalPrefs[key];
    setPendingChanges((prev) => {
      const currentNotifs =
        (prev.notifications as Record<string, boolean>) || {};
      if (isChanged) {
        return {
          ...prev,
          notifications: { ...currentNotifs, [key]: checked },
        };
      } else {
        // Remove from pending if it's back to original
        const { [key]: _, ...rest } = currentNotifs;
        const hasChanges = Object.keys(rest).length > 0;
        if (hasChanges) {
          return { ...prev, notifications: rest };
        } else {
          const { notifications: __, ...otherChanges } = prev;
          return otherChanges;
        }
      }
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
        We only send what is checked below. Security alerts marked Recommended
        stay on regardless, since they are how you find out about access you did
        not grant.
      </p>

      {/* --- SECURITY --- */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Sign-in and account access
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Passwords, two-step verification, and sessions.
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-0 divide-y divide-border/60">
            {(
              [
                {
                  key: "email_security" as const,
                  icon: Shield,
                  label: "Security Alerts",
                  desc: "Unusual activity, account compromise warnings, and critical security events.",
                  badge: "Recommended",
                },
                {
                  key: "email_new_login" as const,
                  icon: LogIn,
                  label: "Login Alerts",
                  desc: "Notifications when someone signs into your account from a new device or location.",
                  badge: "" as const,
                },
                {
                  key: "email_password_change" as const,
                  icon: Lock,
                  label: "Password Changes",
                  desc: "Alerts when your password is changed or a reset is requested.",
                  badge: "" as const,
                },
                {
                  key: "email_2fa_change" as const,
                  icon: Fingerprint,
                  label: "2FA Changes",
                  desc: "Notifications when two-factor authentication is enabled, disabled, or modified.",
                  badge: "" as const,
                },
                {
                  key: "email_session_revoked" as const,
                  icon: MonitorSmartphone,
                  label: "Session Alerts",
                  desc: "Alerts about active sessions and session revocations.",
                  badge: "" as const,
                },
              ] as const
            ).map(({ key, icon: Icon, label, desc, badge }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Icon
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <p className="text-sm font-medium text-foreground">
                      {label}
                    </p>
                    {badge && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 uppercase font-semibold"
                      >
                        {badge}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                </div>
                <Switch
                  checked={notifPrefs[key]}
                  onCheckedChange={(checked) => handleToggle(key, checked)}
                  aria-label={label}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* --- SCANNING --- */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Scans
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Results, critical findings, and scheduled runs.
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-0 divide-y divide-border/60">
            {(
              [
                {
                  key: "email_scan_complete" as const,
                  icon: CheckCircle2,
                  label: "Scan Completed",
                  desc: "Alerts when vulnerability scans are finished.",
                },
                {
                  key: "email_critical_findings" as const,
                  icon: AlertCircle,
                  label: "Critical Issues Found",
                  desc: "Immediate alerts when critical vulnerabilities are detected.",
                },
                {
                  key: "email_schedules" as const,
                  icon: CalendarClock,
                  label: "Scheduled Scans Completed",
                  desc: "Alerts when your scheduled scans finish.",
                },
              ] as const
            ).map(({ key, icon: Icon, label, desc }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Icon
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <p className="text-sm font-medium text-foreground">
                      {label}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                </div>
                <Switch
                  checked={notifPrefs[key]}
                  onCheckedChange={(checked) => handleToggle(key, checked)}
                  aria-label={label}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* --- API & INTEGRATIONS --- */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            API and webhooks
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Key activity, rate limits, and delivery failures.
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-0 divide-y divide-border/60">
            {(
              [
                {
                  key: "email_api_keys" as const,
                  icon: Key,
                  label: "API Key Activity",
                  desc: "Alerts when API keys are created, revoked, or approaching expiration.",
                },
                {
                  key: "email_api_limit_warning" as const,
                  icon: Gauge,
                  label: "API Limit Warnings",
                  desc: "Warnings when your API usage nears rate limits or daily quotas.",
                },
                {
                  key: "email_webhooks" as const,
                  icon: Webhook,
                  label: "Webhook Events",
                  desc: "Notifications when webhooks are created, modified, or disabled.",
                },
                {
                  key: "email_webhook_failure" as const,
                  icon: XCircle,
                  label: "Webhook Failures",
                  desc: "Alerts when webhook deliveries fail repeatedly.",
                },
              ] as const
            ).map(({ key, icon: Icon, label, desc }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Icon
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <p className="text-sm font-medium text-foreground">
                      {label}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                </div>
                <Switch
                  checked={notifPrefs[key]}
                  onCheckedChange={(checked) => handleToggle(key, checked)}
                  aria-label={label}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* --- ACCOUNT --- */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Account and teams
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Data exports, deletion, and team membership.
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-0 divide-y divide-border/60">
            {(
              [
                {
                  key: "email_data_requests" as const,
                  icon: Download,
                  label: "Data Export Updates",
                  desc: "Notifications when your data export is ready for download.",
                },
                {
                  key: "email_account_deletion" as const,
                  icon: UserCog,
                  label: "Account Deletion",
                  desc: "Confirmations and alerts when account deletion is requested or processed.",
                },
                {
                  key: "email_team_invite" as const,
                  icon: Users,
                  label: "Team Invites",
                  desc: "Notifications when you're invited to join a team or workspace.",
                },
                {
                  key: "email_team_changes" as const,
                  icon: Users,
                  label: "Team Changes",
                  desc: "Alerts about team membership changes, role updates, and team activity.",
                },
              ] as const
            ).map(({ key, icon: Icon, label, desc }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Icon
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <p className="text-sm font-medium text-foreground">
                      {label}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                </div>
                <Switch
                  checked={notifPrefs[key]}
                  onCheckedChange={(checked) => handleToggle(key, checked)}
                  aria-label={label}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
