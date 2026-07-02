"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type EmailPrefs = {
  security: boolean;
  account_changes: boolean;
  api_webhooks: boolean;
  teams: boolean;
  general: boolean;
};

const PREF_ROWS: {
  key: keyof EmailPrefs;
  label: string;
  description: string;
}[] = [
  {
    key: "security",
    label: "Security alerts",
    description: "New login notifications, failed login attempts.",
  },
  {
    key: "account_changes",
    label: "Account changes",
    description: "Password, email, and name change confirmations.",
  },
  {
    key: "api_webhooks",
    label: "API and webhooks",
    description: "API key created or deleted, webhook events.",
  },
  {
    key: "teams",
    label: "Team invitations",
    description: "When someone invites you to join a team.",
  },
  {
    key: "general",
    label: "General",
    description: "Newsletters, product announcements.",
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
      setSaving(true);
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
    }, 500);
  }

  function handleToggle(key: keyof EmailPrefs, value: boolean) {
    if (!prefs) return;
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
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
    return (
      <div className="flex items-center gap-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground">
          Loading preferences...
        </span>
      </div>
    );
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
            You have been unsubscribed from all emails for{" "}
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

      <div className="space-y-0 divide-y divide-border/40">
        {PREF_ROWS.map(({ key, label, description }) => (
          <div
            key={key}
            className="flex items-start justify-between gap-4 py-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{label}</p>
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

      <div className="flex items-center justify-between">
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

function LoadingFallback() {
  return (
    <div className="flex items-center gap-2.5">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
      <span className="text-sm text-muted-foreground">Loading...</span>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <AuthLayout>
      <Suspense fallback={<LoadingFallback />}>
        <UnsubscribeContent />
      </Suspense>
    </AuthLayout>
  );
}
