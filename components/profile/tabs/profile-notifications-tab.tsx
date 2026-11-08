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
import { LeadingIcon } from "@/components/shared/leading-icon";
import {
  ALWAYS_ON_COLUMNS,
  DEFAULT_PREFERENCES,
  PREFERENCE_COPY,
  isSecurityColumn,
  type NotificationColumn,
} from "@/lib/notifications/columns";
import { useClientConfig } from "@/lib/hooks/use-client-config";

// Which columns the server refuses to turn off (ALWAYS_ON_COLUMNS), and what an
// account that never chose gets (DEFAULT_PREFERENCES), come from
// lib/notifications/columns.ts: the same declarations the routes read. They
// were typed out here, and the copy of the defaults said every flag was on
// while the schema starts Tips & Guides off.
//
// PUT /api/v3/account/notifications forces email_security to true whatever it
// was sent, and answers 200 because the other columns wrote fine. The switch
// for an always-on column is therefore disabled and the row says so, rather
// than moving and reporting "Saved" for a choice the account does not have.

// The words on each row come from the table /unsubscribe reads as well.
function withCopy<Row extends { readonly key: NotificationColumn }>(
  rows: readonly Row[],
) {
  return rows.map((row) => ({
    ...row,
    label: PREFERENCE_COPY[row.key].label,
    desc: PREFERENCE_COPY[row.key].description,
  }));
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
  preloadedDigestEmailEnabled,
}: ProfileTabProps) {
  // FEATURE_EMAIL_NOTIFICATIONS silences everything except security mail, so
  // with it off only the switches that still decide something are drawn.
  const { featureEmailNotifications } = useClientConfig();

  // null means "we do not know", not "everything is on". The parent only
  // calls setNotifPrefs when the GET succeeded, so falling back to the
  // defaults rendered twenty switches in their default position for a failed
  // request: someone who had unsubscribed from Product updates was shown as
  // subscribed, and could re-save that guess back over their real row. Same
  // tri-state ProfileSecurityTab uses for backupCodesRemaining.
  const initialPrefs = preloadedNotifPrefs
    ? { ...DEFAULT_PREFERENCES, ...preloadedNotifPrefs }
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
      const prefs = { ...DEFAULT_PREFERENCES, ...preloadedNotifPrefs };
      // oxlint-disable-next-line react/set-state-in-effect -- syncs local editable state from an async-loaded parent prop, gated by that dependency changing
      setNotifPrefs(prefs);
      setOriginalPrefs(prefs);
    }
  }, [preloadedNotifPrefs]);

  useEffect(() => {
    // Was `!== undefined`, which null passes: a failed posture-digest fetch
    // leaves the parent's value null, and the `?? false` below it then
    // rendered "we do not know" as "you are unsubscribed".
    if (typeof preloadedDigestEmailEnabled !== "boolean") return;
    // oxlint-disable-next-line react/set-state-in-effect -- syncs local editable state from an async-loaded parent prop, gated by that dependency changing
    setDigestEmailEnabled(preloadedDigestEmailEnabled);
    setOriginalDigestEmailEnabled(preloadedDigestEmailEnabled);
  }, [preloadedDigestEmailEnabled]);

  // Reset to original values when discardKey changes (discard was clicked)
  useEffect(() => {
    if (discardKey && discardKey > 0) {
      // oxlint-disable-next-line react/set-state-in-effect -- resets to original values when the parent's discard-changes signal (discardKey) increments, gated by that dependency
      setNotifPrefs(originalPrefs);
      setDigestEmailEnabled(originalDigestEmailEnabled);
    }
  }, [discardKey, originalPrefs, originalDigestEmailEnabled]);

  // Update original values when saveKey changes (save was successful)
  useEffect(() => {
    if (saveKey && saveKey > 0) {
      // oxlint-disable-next-line react/set-state-in-effect -- updates the "original" baseline when the parent's save-succeeded signal (saveKey) increments, gated by that dependency
      setOriginalPrefs(notifPrefs);
      setOriginalDigestEmailEnabled(digestEmailEnabled);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
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
      <div
        role="alert"
        className="rounded-xl border border-border/50 bg-card/50 p-5 sm:p-6 flex items-start gap-3"
      >
        <LeadingIcon
          icon={AlertTriangle}
          line="relaxed"
          className="text-destructive"
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
        {featureEmailNotifications
          ? "We only send what is checked below. Security alerts marked Always on stay on regardless, since they are how you find out about access you did not grant."
          : "This instance sends security email only, so these are the only alerts it has to offer. Those marked Always on stay on regardless, since they are how you find out about access you did not grant."}
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
            {withCopy([
              {
                key: "email_security" as const,
                icon: Shield,
                badge: "Always on",
              },
              {
                key: "email_new_login" as const,
                icon: LogIn,
                badge: "" as const,
              },
              {
                key: "email_password_change" as const,
                icon: Lock,
                badge: "" as const,
              },
              {
                key: "email_2fa_change" as const,
                icon: Fingerprint,
                badge: "" as const,
              },
              {
                key: "email_session_revoked" as const,
                icon: MonitorSmartphone,
                badge: "" as const,
              },
            ] as const).map(({ key, icon: Icon, label, desc, badge }) => (
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
                        className="text-[11px] px-1.5 py-0 uppercase font-semibold"
                      >
                        {badge}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                </div>
                <Switch
                  checked={notifPrefs[key] || ALWAYS_ON_COLUMNS.has(key)}
                  onCheckedChange={(checked) => handleToggle(key, checked)}
                  disabled={ALWAYS_ON_COLUMNS.has(key)}
                  aria-label={
                    ALWAYS_ON_COLUMNS.has(key) ? `${label} (always on)` : label
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {featureEmailNotifications && (
        <>
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
                {withCopy([
                  {
                    key: "email_scan_complete" as const,
                    icon: CheckCircle2,
                  },
                  {
                    key: "email_critical_findings" as const,
                    icon: ShieldAlert,
                  },
                  {
                    key: "email_regression_alert" as const,
                    icon: AlertCircle,
                  },
                  {
                    key: "email_schedules" as const,
                    icon: CalendarClock,
                  },
                ] as const).map(({ key, icon: Icon, label, desc }) => (
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
                      <p className="text-xs text-muted-foreground mt-1">
                        {desc}
                      </p>
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
                        {PREFERENCE_COPY.email_posture_digest.label}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {PREFERENCE_COPY.email_posture_digest.description}{" "}
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
                      aria-label={PREFERENCE_COPY.email_posture_digest.label}
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
                {withCopy([
                  {
                    key: "email_api_keys" as const,
                    icon: Key,
                  },
                  {
                    key: "email_api_limit_warning" as const,
                    icon: Gauge,
                  },
                  {
                    key: "email_webhooks" as const,
                    icon: Webhook,
                  },
                  {
                    key: "email_webhook_failure" as const,
                    icon: XCircle,
                  },
                ] as const).map(({ key, icon: Icon, label, desc }) => (
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
                      <p className="text-xs text-muted-foreground mt-1">
                        {desc}
                      </p>
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
        </>
      )}

      {/* --- ACCOUNT --- */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Account and teams
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {featureEmailNotifications
              ? "Data exports, deletion, and team membership."
              : "Account deletion."}
          </p>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-0 divide-y divide-border/60">
            {withCopy([
              {
                key: "email_data_requests" as const,
                icon: Download,
              },
              {
                key: "email_account_deletion" as const,
                icon: UserCog,
              },
              {
                key: "email_team_invite" as const,
                icon: Users,
              },
              {
                key: "email_team_changes" as const,
                icon: Users,
              },
            ] as const)
              .filter(
                ({ key }) => featureEmailNotifications || isSecurityColumn(key),
              )
              .map(({ key, icon: Icon, label, desc }) => (
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

      {featureEmailNotifications && (
        <>
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
                {withCopy([
                  {
                    key: "email_product_updates" as const,
                    icon: Sparkles,
                  },
                  {
                    key: "email_tips_guides" as const,
                    icon: GraduationCap,
                  },
                ] as const).map(({ key, icon: Icon, label, desc }) => (
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
                      <p className="text-xs text-muted-foreground mt-1">
                        {desc}
                      </p>
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
        </>
      )}
    </div>
  );
}
