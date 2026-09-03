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
  AlertTriangle,
  CalendarClock,
  Key,
  Gauge,
  Webhook,
  XCircle,
  UserCog,
  Download,
  Users,
  BarChart3,
  ShieldAlert,
  Sparkles,
  GraduationCap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { ProfileTabProps, NotificationPrefs } from "../types";

// Fills in any column a response that DID arrive left out, so a preference
// added after a user's row was written still renders as a boolean. It is not
// a stand-in for a response that never arrived: see the null tri-state below.
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
  email_posture_digest: true,
  email_api_keys: true,
  email_api_limit_warning: true,
  email_webhooks: true,
  email_webhook_failure: true,
  email_data_requests: true,
  email_account_deletion: true,
  email_team_invite: true,
  email_team_changes: true,
  email_product_updates: true,
  email_tips_guides: true,
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
  preloadedDigestEmailEnabled,
}: ProfileTabProps) {
  // null means "we do not know", not "everything is on". The parent only
  // calls setNotifPrefs when the GET succeeded, so falling back to
  // DEFAULT_PREFS (every flag true) rendered twenty switches in the on
  // position for a failed request: someone who had unsubscribed from
  // Product updates was shown as subscribed, and could re-save that guess
  // back over their real row. Same tri-state ProfileSecurityTab uses for
  // backupCodesRemaining.
  const initialPrefs = preloadedNotifPrefs
    ? { ...DEFAULT_PREFS, ...preloadedNotifPrefs }
    : null;
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs | null>(
    initialPrefs,
  );
  const [originalPrefs, setOriginalPrefs] = useState<NotificationPrefs | null>(
    initialPrefs,
  );

  // Posture digest opt-in (users.digest_email_enabled) -- unlike every
  // other category above, this defaults OFF and lives on `users`, not
  // `notification_preferences`, so it needs its own state/pendingChanges
  // key. Same discard/save shape as ProfilePrivacyTab's
  // scansPrivateByDefault toggle, and the same null tri-state: its own
  // fetch can fail independently of the twenty above.
  const [digestEmailEnabled, setDigestEmailEnabled] = useState<boolean | null>(
    preloadedDigestEmailEnabled ?? null,
  );
  const [originalDigestEmailEnabled, setOriginalDigestEmailEnabled] = useState<
    boolean | null
  >(preloadedDigestEmailEnabled ?? null);

  // Update state when preloaded data changes
  useEffect(() => {
    if (preloadedNotifPrefs) {
      const prefs = { ...DEFAULT_PREFS, ...preloadedNotifPrefs };
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local editable state from an async-loaded parent prop, gated by that dependency changing
      setNotifPrefs(prefs);
      setOriginalPrefs(prefs);
    }
  }, [preloadedNotifPrefs]);

  useEffect(() => {
    // Was `!== undefined`, which null passes: a failed posture-digest fetch
    // leaves the parent's value null, and the `?? false` below it then
    // rendered "we do not know" as "you are unsubscribed".
    if (typeof preloadedDigestEmailEnabled !== "boolean") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local editable state from an async-loaded parent prop, gated by that dependency changing
    setDigestEmailEnabled(preloadedDigestEmailEnabled);
    setOriginalDigestEmailEnabled(preloadedDigestEmailEnabled);
  }, [preloadedDigestEmailEnabled]);

  // Reset to original values when discardKey changes (discard was clicked)
  useEffect(() => {
    if (discardKey && discardKey > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets to original values when the parent's discard-changes signal (discardKey) increments, gated by that dependency
      setNotifPrefs(originalPrefs);
      setDigestEmailEnabled(originalDigestEmailEnabled);
    }
  }, [discardKey, originalPrefs, originalDigestEmailEnabled]);

  // Update original values when saveKey changes (save was successful)
  useEffect(() => {
    if (saveKey && saveKey > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- updates the "original" baseline when the parent's save-succeeded signal (saveKey) increments, gated by that dependency
      setOriginalPrefs(notifPrefs);
      setOriginalDigestEmailEnabled(digestEmailEnabled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveKey]);

  const handleToggle = (key: keyof NotificationPrefs, checked: boolean) => {
    // Unknown prefs render as the error panel below instead of switches, so
    // nothing can call this before they load. The guard makes that true for
    // the type checker as well.
    if (!originalPrefs) return;
    setNotifPrefs((prev) => (prev ? { ...prev, [key]: checked } : prev));
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

  const handleToggleDigestEmailEnabled = (checked: boolean) => {
    setDigestEmailEnabled(checked);
    if (checked !== originalDigestEmailEnabled) {
      setPendingChanges((prev) => ({ ...prev, digestEmailEnabled: checked }));
    } else {
      setPendingChanges((prev) => {
        const { digestEmailEnabled: _drop, ...rest } = prev;
        return rest;
      });
    }
  };

  // The posture digest is behind two independent gates and only one of them
  // had a control. lib/notifications/posture-digest.ts selects recipients on
  // users.digest_email_enabled (this toggle), then sends through
  // sendNotificationEmail({ type: "posture_digest" }), which re-checks the
  // notification_preferences column email_posture_digest. Nothing on this
  // page ever wrote that column, so a user whose /unsubscribe click (or an
  // unsubscribe_all) had cleared it saw this switch turn on and never
  // received a digest. One switch, both columns, and the displayed state is
  // the AND of the two so it can never claim to be on while a gate is shut.
  const handleTogglePostureDigest = (checked: boolean) => {
    handleToggleDigestEmailEnabled(checked);
    handleToggle("email_posture_digest", checked);
  };

  // The GET behind every switch below failed. A switch is a settled claim
  // about what we will email you, so none of them are drawn at all rather
  // than drawn from a default: the parent raises a banner naming this
  // section, but that banner clears itself after 8 seconds while whatever is
  // on screen stays there for good.
  if (!notifPrefs) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/50 p-5 sm:p-6 flex items-start gap-3">
        <AlertTriangle
          className="h-4 w-4 text-destructive shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Your email settings could not be loaded
          </p>
          <p className="text-sm text-muted-foreground mt-1 max-w-prose leading-relaxed">
            Nothing is shown here rather than a set of defaults, since the
            defaults would say you are subscribed to every category whether you
            are or not. Reload the page to try again.
          </p>
        </div>
      </div>
    );
  }

  const postureDigestOn =
    digestEmailEnabled === true && notifPrefs.email_posture_digest;

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
                  label: "Security alerts",
                  desc: "Unusual activity on your account, and anything that looks like someone else getting in.",
                  badge: "Recommended",
                },
                {
                  key: "email_new_login" as const,
                  icon: LogIn,
                  label: "New sign-ins",
                  desc: "A sign-in from a device or location we have not seen before.",
                  badge: "" as const,
                },
                {
                  key: "email_password_change" as const,
                  icon: Lock,
                  label: "Password changes",
                  desc: "Your password changed, or a reset was requested for it.",
                  badge: "" as const,
                },
                {
                  key: "email_2fa_change" as const,
                  icon: Fingerprint,
                  label: "Two-step verification changes",
                  desc: "Two-step verification turned on, turned off, or switched method.",
                  badge: "" as const,
                },
                {
                  key: "email_session_revoked" as const,
                  icon: MonitorSmartphone,
                  label: "Revoked sessions",
                  desc: "A signed-in session was ended, by you or by a sign-out everywhere.",
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
                  label: "Scan finished",
                  desc: "Every scan, as soon as it has a result.",
                },
                {
                  key: "email_critical_findings" as const,
                  icon: ShieldAlert,
                  label: "Critical findings",
                  desc: "The moment a scan turns up something rated critical, without waiting for the rest of the run.",
                },
                {
                  key: "email_regression_alert" as const,
                  icon: AlertCircle,
                  label: "New issues since last scan",
                  desc: "A critical or high finding on a target that did not have it last time.",
                },
                {
                  key: "email_schedules" as const,
                  icon: CalendarClock,
                  label: "Scheduled scans",
                  desc: "Results from the scans you set to run on a schedule.",
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
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <BarChart3
                    className="h-3.5 w-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium text-foreground">
                    Posture Digest
                  </p>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  A periodic summary across every site you've scanned: new
                  critical/high findings and whether your open count is trending
                  up or down.{" "}
                  {digestEmailEnabled === null
                    ? "We could not check whether you are subscribed to it, so no switch is shown. Reload the page to check again."
                    : "Off by default."}
                </p>
              </div>
              {/* Its opt-in lives on its own endpoint, so it can be unknown
                  while every other switch on this tab is real. Off by default
                  is exactly what a failed check used to render, which reads
                  as "you are unsubscribed" rather than "we do not know". */}
              {digestEmailEnabled === null ? (
                <span className="text-xs font-medium text-muted-foreground shrink-0">
                  Unknown
                </span>
              ) : (
                <Switch
                  checked={postureDigestOn}
                  onCheckedChange={handleTogglePostureDigest}
                  aria-label="Posture Digest"
                />
              )}
            </div>
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
                  label: "API key activity",
                  desc: "A key was created or revoked, or one of yours is close to expiring.",
                },
                {
                  key: "email_api_limit_warning" as const,
                  icon: Gauge,
                  label: "Approaching API limits",
                  desc: "Your API usage is close to a rate limit or the daily quota.",
                },
                {
                  key: "email_webhooks" as const,
                  icon: Webhook,
                  label: "Webhook changes",
                  desc: "A webhook was created, edited, or switched off.",
                },
                {
                  key: "email_webhook_failure" as const,
                  icon: XCircle,
                  label: "Webhook failures",
                  desc: "Deliveries to one of your endpoints keep failing.",
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
                  label: "Data exports",
                  desc: "Your export is built and ready to download.",
                },
                {
                  key: "email_account_deletion" as const,
                  icon: UserCog,
                  label: "Account deletion",
                  desc: "Deletion was requested on your account, and again when it runs.",
                },
                {
                  key: "email_team_invite" as const,
                  icon: Users,
                  label: "Team invitations",
                  desc: "Someone invited you to join their team.",
                },
                {
                  key: "email_team_changes" as const,
                  icon: Users,
                  label: "Team changes",
                  desc: "People joining or leaving a team you are in, and role changes.",
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

      {/* --- PRODUCT ---
          These two columns exist in notification_preferences and are accepted
          by PUT /api/v3/account/notifications, but the only place they could
          be changed was the token-gated /unsubscribe page reached from an
          email footer. So marketing email was manageable from an email link
          and nowhere else, and a user who unsubscribed could not opt back in
          from their own account. Mirrors app/unsubscribe/page.tsx's Product
          group. */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Product
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Release notes and occasional guidance. Never sales email.
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-0 divide-y divide-border/60">
            {(
              [
                {
                  key: "email_product_updates" as const,
                  icon: Sparkles,
                  label: "Product updates",
                  desc: "New features, improvements, and release notes.",
                },
                {
                  key: "email_tips_guides" as const,
                  icon: GraduationCap,
                  label: "Tips and guides",
                  desc: "Occasional tips on getting more out of VulnRadar.",
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
