"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import {
  UnsubscribePrefsSkeleton,
  UnsubscribeSkeleton,
} from "@/components/auth/unsubscribe-skeleton";
// The table lives in components/auth so the placeholder can count the same
// rows this renders. See components/auth/unsubscribe-prefs.ts.
import {
  PREF_GROUPS,
  type EmailPrefs,
  type PrefKey,
} from "@/components/auth/unsubscribe-prefs";

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last set of preferences the server actually acknowledged. Toggles are
  // optimistic, so on a failed save we roll back to this rather than leaving a
  // switch showing a state that was never stored.
  const serverPrefsRef = useRef<EmailPrefs | null>(null);

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
        serverPrefsRef.current = data.prefs;
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  function savePrefs(updated: EmailPrefs) {
    if (!token) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v3/account/unsubscribe?token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prefs: updated }),
          },
        );
        // A non-2xx means the preference was never stored. Showing "Saved."
        // anyway tells someone their unsubscribe took effect while the mail
        // keeps arriving, which on this screen is a compliance problem and not
        // just a UI one. Roll the switch back and say what happened instead.
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (serverPrefsRef.current) setPrefs(serverPrefsRef.current);
          setSavedAt(null);
          setSaveError(
            body?.error || "That change was not saved. Try again in a moment.",
          );
          return;
        }
        serverPrefsRef.current = updated;
        setSaveError(null);
        setSavedAt(Date.now());
      } catch {
        if (serverPrefsRef.current) setPrefs(serverPrefsRef.current);
        setSavedAt(null);
        setSaveError(
          "Could not reach the server, so that change was not saved. Check your connection and try again.",
        );
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
        serverPrefsRef.current = data.prefs;
        setSaveError(null);
        setUnsubscribedAll(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setSaveError(
        body?.error ||
          "Could not unsubscribe you. Nothing was changed, so please try again.",
      );
    } catch {
      setSaveError(
        "Could not reach the server, so nothing was changed. Check your connection and try again.",
      );
    } finally {
      setSaving(false);
    }
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
            <span className="font-medium text-foreground break-all">
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
      {/* Which screen this is never waited on the token: only the address it
          is managing did. So the heading stays put and the subtitle alone
          holds a placeholder, instead of the whole view being replaced by a
          skeleton and then replaced again. */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Email preferences
        </h1>
        {loading ? (
          <Skeleton className="mt-1.5 h-4 w-56" />
        ) : (
          <p className="text-sm text-muted-foreground mt-1.5">
            Managing preferences for{" "}
            <span className="font-medium text-foreground break-all">
              {redactEmail(email)}
            </span>
            .
          </p>
        )}
      </div>

      {loading ? (
        <UnsubscribePrefsSkeleton />
      ) : (
        <>
          <div className="space-y-6">
            {PREF_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {group.label}
                </p>
                <div className="divide-y divide-border/40 rounded-lg border border-border/50 overflow-hidden">
                  {group.rows.map(({ key, label, description }) => (
                    // The Switch itself is a 24px-tall target with the row's
                    // padding outside its hit area, which is well under the 44px
                    // touch minimum. The whole row is the target now, and the
                    // Switch stops swallowing pointer events so the two cannot
                    // both fire; it stays focusable, so Tab plus Space still works.
                    <div
                      key={key}
                      onClick={() => {
                        if (!saving) handleToggle(key, !(prefs?.[key] ?? true));
                      }}
                      className="flex items-start justify-between gap-4 px-4 py-3.5 bg-card/30 cursor-pointer transition-colors hover:bg-card/60"
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
                        aria-label={label}
                        className="shrink-0 mt-0.5 pointer-events-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-start justify-between gap-4 pt-2">
            {/* Check `saving` first: otherwise, once savedAt is set on the first
            save, the "Saving..." indicator never shows again on later saves. */}
            {saving ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Saving...</span>
              </div>
            ) : saveError ? (
              <p className="text-xs text-destructive">{saveError}</p>
            ) : savedAt ? (
              <p className="text-xs text-[hsl(var(--success))]">Saved.</p>
            ) : (
              <span />
            )}

            {/* Was a ~16px, 60%-opacity text target. It is the destructive action
            on this screen, so it gets a real 44px button. */}
            <button
              type="button"
              onClick={handleUnsubscribeAll}
              disabled={saving}
              className="shrink-0 inline-flex h-11 items-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              Unsubscribe from all
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    // 19 preference rows are a list, not a form, and AuthLayout's "wide"
    // variant exists for exactly this screen: at max-w-sm the rows were
    // crushed with roughly 1050px empty on either side at 1440px.
    <AuthLayout width="wide">
      <Suspense fallback={<UnsubscribeSkeleton />}>
        <UnsubscribeContent />
      </Suspense>
    </AuthLayout>
  );
}
