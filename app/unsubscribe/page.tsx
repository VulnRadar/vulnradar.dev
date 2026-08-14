"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { UnsubscribeSkeleton } from "@/components/auth/unsubscribe-skeleton";

type PrefKey =
  | "email_security"
  | "email_new_login"
  | "email_password_change"
  | "email_2fa_change"
  | "email_session_revoked"
  | "email_scan_complete"
  | "email_critical_findings"
  | "email_regression_alert"
  | "email_schedules"
  | "email_api_keys"
  | "email_api_limit_warning"
  | "email_webhooks"
  | "email_webhook_failure"
  | "email_data_requests"
  | "email_account_deletion"
  | "email_team_invite"
  | "email_team_changes"
  | "email_product_updates"
  | "email_tips_guides";

type EmailPrefs = Record<PrefKey, boolean>;

type PrefRow = {
  key: PrefKey;
  label: string;
  description: string;
};

type PrefGroup = {
  label: string;
  rows: PrefRow[];
};

const PREF_GROUPS: PrefGroup[] = [
  {
    label: "Security",
    rows: [
      {
        key: "email_security",
        label: "Security Alerts",
        description:
          "Critical account security events and compromise warnings.",
      },
      {
        key: "email_new_login",
        label: "Login Alerts",
        description: "When someone signs in from a new device or location.",
      },
      {
        key: "email_password_change",
        label: "Password Changes",
        description: "When your password is changed or a reset is requested.",
      },
      {
        key: "email_2fa_change",
        label: "2FA Changes",
        description: "When two-factor authentication is enabled or disabled.",
      },
      {
        key: "email_session_revoked",
        label: "Session Alerts",
        description: "When active sessions are revoked.",
      },
    ],
  },
  {
    label: "Scanning",
    rows: [
      {
        key: "email_scan_complete",
        label: "Scan Completed",
        description: "When a vulnerability scan finishes.",
      },
      {
        key: "email_critical_findings",
        label: "Critical Issues Found",
        description:
          "Immediate alert when critical vulnerabilities are detected.",
      },
      {
        key: "email_regression_alert",
        label: "Regression Alerts",
        description: "When new issues appear in a previously clean scan.",
      },
      {
        key: "email_schedules",
        label: "Scheduled Scans",
        description: "When your scheduled scans finish.",
      },
    ],
  },
  {
    label: "API & Integrations",
    rows: [
      {
        key: "email_api_keys",
        label: "API Key Activity",
        description: "When API keys are created or revoked.",
      },
      {
        key: "email_api_limit_warning",
        label: "API Limit Warnings",
        description: "When your API usage nears rate limits or quotas.",
      },
      {
        key: "email_webhooks",
        label: "Webhook Events",
        description: "When webhooks are created, modified, or disabled.",
      },
      {
        key: "email_webhook_failure",
        label: "Webhook Failures",
        description: "When webhook deliveries fail repeatedly.",
      },
    ],
  },
  {
    label: "Account",
    rows: [
      {
        key: "email_data_requests",
        label: "Data Export Updates",
        description: "When your data export is ready for download.",
      },
      {
        key: "email_account_deletion",
        label: "Account Deletion",
        description: "Confirmations when account deletion is requested.",
      },
      {
        key: "email_team_invite",
        label: "Team Invites",
        description: "When you are invited to join a team.",
      },
      {
        key: "email_team_changes",
        label: "Team Changes",
        description: "Membership changes and role updates in your teams.",
      },
    ],
  },
  {
    label: "Product",
    rows: [
      {
        key: "email_product_updates",
        label: "Product Updates",
        description: "New features, improvements, and release notes.",
      },
      {
        key: "email_tips_guides",
        label: "Tips & Guides",
        description: "Tips on getting the most out of VulnRadar.",
      },
    ],
  },
];

function redactEmail(email: string): string {
  const atIdx = email.indexOf("@");
  if (atIdx < 2) return email;
  return email.slice(0, 2) + "***" + email.slice(atIdx);
}

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [email, setEmail] = useState("");
  const [prefs, setPrefs] = useState<EmailPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [unsubscribedAll, setUnsubscribedAll] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the URL's token param (an external system) to decide initial state before fetch-on-mount below
      setInvalid(true);
      setLoading(false);
      return;
    }
    fetch(`/api/v3/account/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          setInvalid(true);
          return;
        }
        const data = (await res.json()) as { email: string; prefs: EmailPrefs };
        setEmail(data.email);
        setPrefs(data.prefs);
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  function savePrefs(updated: EmailPrefs) {
    if (!token) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        await fetch(
          `/api/v3/account/unsubscribe?token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prefs: updated }),
          },
        );
        setSavedAt(Date.now());
      } catch {
        /* ignore */
      } finally {
        setSaving(false);
      }
    }, 300);
  }

  function handleToggle(key: PrefKey, value: boolean) {
    if (!prefs) return;
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    setSaving(true); // disable all switches immediately
    savePrefs(updated);
  }

  async function handleUnsubscribeAll() {
    if (!token) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/v3/account/unsubscribe?token=${encodeURIComponent(token)}&action=unsubscribe_all`,
        { method: "POST" },
      );
      if (res.ok) {
        const data = (await res.json()) as { prefs: EmailPrefs };
        setPrefs(data.prefs);
        setUnsubscribedAll(true);
      }
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <UnsubscribeSkeleton />;
  }

  if (invalid) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Invalid unsubscribe link.
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            This link has expired or is not valid. Sign in to manage your email
            preferences from your profile.
          </p>
        </div>
        <Button asChild variant="outline" className="border-border/50">
          <Link href="/profile?tab=notifications">Go to profile</Link>
        </Button>
      </div>
    );
  }

  if (unsubscribedAll) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-emerald-500">
            Unsubscribed.
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            You have been unsubscribed from all optional emails for{" "}
            <span className="font-medium text-foreground">
              {redactEmail(email)}
            </span>
            .
          </p>
        </div>
        <p className="text-xs text-muted-foreground/60">
          You can re-enable notifications anytime from your{" "}
          <Link
            href="/profile?tab=notifications"
            className="text-primary hover:underline"
          >
            profile settings
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div
      className="space-y-8"
      style={{ animation: "fade-in 0.2s ease-out both" }}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Email preferences
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Managing preferences for{" "}
          <span className="font-medium text-foreground">
            {redactEmail(email)}
          </span>
          .
        </p>
      </div>

      <div className="space-y-6">
        {PREF_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {group.label}
            </p>
            <div className="divide-y divide-border/40 rounded-lg border border-border/50 overflow-hidden">
              {group.rows.map(({ key, label, description }) => (
                <div
                  key={key}
                  className="flex items-start justify-between gap-4 px-4 py-3 bg-card/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {description}
                    </p>
                  </div>
                  <Switch
                    checked={prefs?.[key] ?? true}
                    onCheckedChange={(val) => handleToggle(key, val)}
                    disabled={saving}
                    className="shrink-0 mt-0.5"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2">
        {savedAt ? (
          <p className="text-xs text-emerald-500">Saved.</p>
        ) : saving ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Saving...</span>
          </div>
        ) : (
          <span />
        )}

        <button
          type="button"
          onClick={handleUnsubscribeAll}
          disabled={saving}
          className="text-xs text-muted-foreground/60 hover:text-destructive transition-colors disabled:opacity-40"
        >
          Unsubscribe from all
        </button>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <AuthLayout>
      <Suspense fallback={<UnsubscribeSkeleton />}>
        <UnsubscribeContent />
      </Suspense>
    </AuthLayout>
  );
}
