"use client";

import { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Copy,
  Download,
  KeyRound,
  Check,
  Loader2,
  LogOut,
  ShieldOff,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { copyToClipboard } from "@/lib/ui/clipboard";
import { API, ROUTES, APP_NAME, APP_SLUG } from "@/lib/config/client-constants";
import { downloadBlob } from "@/lib/ui/download";
import {
  refreshAuthCache,
  clearAuthCache,
} from "@/components/providers/auth-provider";
import type { ProfileTabProps } from "@/components/profile/types";
import { InlineAlert } from "@/components/shared/inline-alert";

// The API issues this many backup codes per set. Kept as one named value so
// the copy and the progress readout cannot drift apart.
const BACKUP_CODE_SET_SIZE = 8;

type EnrolStep = "scan" | "verify";

// Shapes returned by GET /api/v3/auth/sessions and GET
// /api/v3/auth/trusted-devices. Neither ever includes the real session id
// or device fingerprint -- see the routes for why -- so there is nothing
// here a leaked response could be replayed as.
interface SessionItem {
  id: string;
  ipAddress: string | null;
  // IPv4 captured out-of-band when the session's own connection was IPv6.
  ipv4Address: string | null;
  device: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

interface TrustedDeviceItem {
  id: number;
  deviceName: string | null;
  ipAddress: string | null;
  device: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Section shell: a left-aligned heading with prose, then the content. */
function Section({
  title,
  blurb,
  aside,
  children,
}: {
  title: string;
  blurb: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{blurb}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Inline status pill driven by semantic tokens, readable in both themes. */
function StatusPill({
  tone,
  children,
}: {
  tone: "on" | "off";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shrink-0",
        tone === "on"
          ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/30"
          : "bg-muted text-muted-foreground border-border",
      )}
    >
      {tone === "on" ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function ProfileSecurityTab(props: ProfileTabProps) {
  const { user, setError, setSuccess, onTabChange } = props;

  // Password change state
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // 2FA state
  const [totpEnabled, setTotpEnabled] = useState(user?.totpEnabled || false);
  const [twoFactorMethod, setTwoFactorMethod] = useState<string | null>(
    user?.twoFactorMethod || null,
  );
  // Keep the parent's `user` in sync with the live 2FA state. This tab remounts
  // on every profile-tab switch and re-seeds the two states above from the
  // `user` prop, so without pushing changes up the parent's stale `user` would
  // make a just-toggled 2FA status silently revert on the next tab switch (a
  // false security all-clear). onUserPatch is a stable ref, so this only fires
  // when the 2FA state actually changes.
  const { onUserPatch } = props;
  useEffect(() => {
    onUserPatch?.({ totpEnabled, twoFactorMethod });
  }, [totpEnabled, twoFactorMethod, onUserPatch]);
  const [setting2FA, setSetting2FA] = useState(false);
  const [enrolStep, setEnrolStep] = useState<EnrolStep>("scan");
  const [startingSetup, setStartingSetup] = useState(false);
  const [verifying2FA, setVerifying2FA] = useState(false);
  const [enrolError, setEnrolError] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpVerifyCode, setTotpVerifyCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  // null = not confirmed yet (either still loading or the check failed).
  // Defaulting this to 0 would read as "no codes left" before the real
  // count arrives, which falsely tells people to regenerate.
  const [backupCodesRemaining, setBackupCodesRemaining] = useState<
    number | null
  >(null);
  const [backupCodesCheckFailed, setBackupCodesCheckFailed] = useState(false);
  const [codesCopied, setCodesCopied] = useState(false);
  const [codesDownloaded, setCodesDownloaded] = useState(false);
  const [showRegenerateBackup, setShowRegenerateBackup] = useState(false);
  const [regenPassword, setRegenPassword] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [showDisable2FA, setShowDisable2FA] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disabling2FA, setDisabling2FA] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);
  const [showEnableEmail2FA, setShowEnableEmail2FA] = useState(false);
  const [email2FAPassword, setEmail2FAPassword] = useState("");
  const [togglingEmail2FA, setTogglingEmail2FA] = useState(false);
  const [emailEnableError, setEmailEnableError] = useState<string | null>(null);
  const [setup2FAPassword, setSetup2FAPassword] = useState("");

  // Session state
  const [forceLoggingOut, setForceLoggingOut] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Active sessions + trusted devices
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(
    null,
  );
  const [trustedDevices, setTrustedDevices] = useState<TrustedDeviceItem[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [revokingDeviceId, setRevokingDeviceId] = useState<number | null>(null);

  const codeInputRef = useRef<HTMLInputElement>(null);
  const backupPanelRef = useRef<HTMLDivElement>(null);

  // Fetch backup codes remaining count on mount when 2FA is enabled
  useEffect(() => {
    if (totpEnabled && twoFactorMethod === "app") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears any stale failure flag before the fresh fetch-on-mount below runs
      setBackupCodesCheckFailed(false);
      fetch(API.AUTH.TWO_FA.BACKUP_CODES)
        .then((res) => res.json())
        .then((data) => {
          if (typeof data.remaining === "number") {
            setBackupCodesRemaining(data.remaining);
          } else {
            setBackupCodesCheckFailed(true);
          }
        })
        .catch(() => {
          // Say the check failed instead of leaving a number on screen that
          // was never confirmed - a stale "0 left" would be worse than none.
          setBackupCodesCheckFailed(true);
        });
    }
  }, [totpEnabled, twoFactorMethod]);

  // Load the caller's own active sessions on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(API.AUTH.SESSIONS);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && Array.isArray(data.sessions)) {
          setSessions(data.sessions);
        } else {
          setSessionsError("Could not load your sessions.");
        }
      } catch {
        if (!cancelled) setSessionsError("Could not load your sessions.");
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load trusted devices on mount. Best-effort: an account that has never
  // used 2FA has none, and a failed fetch just leaves the section hidden
  // rather than surfacing an error for a feature the user may not use.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(API.AUTH.TRUSTED_DEVICES);
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data.devices)) {
          setTrustedDevices(data.devices);
        }
      } catch {
        // Section stays hidden below (devicesLoading + empty list).
      } finally {
        if (!cancelled) setDevicesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRevokeSession(id: string) {
    setRevokingSessionId(id);
    try {
      const res = await fetch(API.AUTH.SESSION_REVOKE(id), {
        method: "DELETE",
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        setSuccess("Session signed out.");
      } else {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(
          data.error || "We could not sign out that session. Try again.",
        );
      }
    } catch {
      setError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function handleRevokeDevice(id: number) {
    setRevokingDeviceId(id);
    try {
      const res = await fetch(API.AUTH.TRUSTED_DEVICE_REVOKE(id), {
        method: "DELETE",
      });
      if (res.ok) {
        setTrustedDevices((prev) => prev.filter((d) => d.id !== id));
        setSuccess(
          "Device removed. It will need to pass two-step verification again next time.",
        );
      } else {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(data.error || "We could not remove that device. Try again.");
      }
    } catch {
      setError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setRevokingDeviceId(null);
    }
  }

  // Move focus to the code field when the verify step appears, and to the
  // backup codes when they are issued, so the flow reads in order.
  useEffect(() => {
    if (setting2FA && enrolStep === "verify") codeInputRef.current?.focus();
  }, [setting2FA, enrolStep]);

  useEffect(() => {
    if (backupCodes.length > 0) backupPanelRef.current?.focus();
  }, [backupCodes.length]);

  // False only for an OAuth-only account (Google/GitHub/Discord sign-up)
  // that has never set a password. It has no "current password" to enter,
  // so the form below skips that field and the server-side re-auth gate
  // (app/api/v3/auth/update/route.ts) skips checking one.
  const hasPassword = user?.hasPassword ?? true;

  async function handleChangePassword() {
    setPasswordError(null);
    if (hasPassword && !currentPassword) {
      setPasswordError("Enter your current password to change it.");
      return;
    }
    if (!newPassword || !confirmNewPassword) {
      setPasswordError(
        hasPassword
          ? "Fill in all three fields to change your password."
          : "Fill in both password fields to set one.",
      );
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError(
        "The two new password fields do not match. Retype them and try again.",
      );
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError(
        "Your new password needs at least 8 characters. Add a few more.",
      );
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch(API.AUTH.UPDATE, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: hasPassword ? currentPassword : undefined,
          newPassword,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(hasPassword ? "Password updated." : "Password set.");
        setShowPasswordForm(false);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
      } else {
        setPasswordError(
          data.error || "We could not save your password. Try again.",
        );
      }
    } catch {
      setPasswordError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleForceLogout() {
    setForceLoggingOut(true);
    try {
      const res = await fetch(API.AUTH.SESSIONS, { method: "DELETE" });
      if (res.ok) {
        // Tear down the cached logged-in state (localStorage vr_auth_cache,
        // the injected auth-only CSS, SWR's in-memory me) right away, the
        // same way the header logout does. Without this the redirect below
        // lands on a page whose pre-React blocking script still reads the
        // stale cache and flashes a signed-in shell for an account whose
        // sessions were just revoked.
        clearAuthCache();
        setSuccess("All sessions signed out. Redirecting to sign in.");
        setShowLogoutModal(false);
        setTimeout(() => (window.location.href = "/login"), 2000);
      } else {
        setError("We could not sign out your other sessions. Try again.");
      }
    } catch {
      setError(
        "We could not reach the server. Check your connection and try again.",
      );
    } finally {
      setForceLoggingOut(false);
    }
  }

  function resetEnrolment() {
    setSetting2FA(false);
    setEnrolStep("scan");
    setEnrolError(null);
    setTotpUri("");
    setTotpSecret("");
    setTotpVerifyCode("");
    setSetup2FAPassword("");
  }

  function downloadBackupCodes() {
    const blob = new Blob(
      [
        `${APP_NAME} 2FA Backup Codes\n${"=".repeat(30)}\n\n${backupCodes.join("\n")}\n\nEach code can only be used once.`,
      ],
      { type: "text/plain" },
    );
    downloadBlob(blob, `${APP_SLUG}-backup-codes.txt`);
    setCodesDownloaded(true);
  }

  const appActive = totpEnabled && twoFactorMethod === "app";
  const emailActive = totpEnabled && twoFactorMethod === "email";
  const codesSaved = codesCopied || codesDownloaded;

  /* ── The freshly issued backup codes take over the whole tab. They are shown
     once, so nothing else competes with them for attention. ── */
  if (backupCodes.length > 0) {
    return (
      <div
        ref={backupPanelRef}
        tabIndex={-1}
        // a11y (SC 2.4.7): this panel is focused by script the moment backup
        // codes are revealed, and `outline-hidden` killed the native outline
        // while the global :focus-visible rule in app/globals.css explicitly
        // skips [tabindex="-1"], so the keyboard user was moved somewhere
        // with no indication of where. focus: (not focus-visible:) because
        // the focus here is programmatic, which the :focus-visible heuristic
        // does not always honour.
        className="rounded-xl border border-primary/30 bg-primary/4 p-5 sm:p-6 flex flex-col gap-5 focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-ring"
      >
        <div className="flex items-start gap-3">
          <KeyRound
            className="h-5 w-5 text-primary shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Save these backup codes now
            </h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              This is the only time they are shown. Each code signs you in once
              if you lose your authenticator app. Without them, losing your
              phone means losing your account.
            </p>
          </div>
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-card p-4 font-mono text-sm">
          {backupCodes.map((code, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-foreground select-all"
            >
              <span
                className="text-xs text-muted-foreground tabular-nums w-4 shrink-0"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="truncate">{code}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            size="lg"
            className="h-11 px-6 gap-2"
            onClick={async () => {
              if (await copyToClipboard(backupCodes.join("\n"))) {
                setCodesCopied(true);
              }
            }}
          >
            {codesCopied ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
            {codesCopied ? "Copied to clipboard" : "Copy all codes"}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-11 px-6 gap-2"
            onClick={downloadBackupCodes}
          >
            {codesDownloaded ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {codesDownloaded ? "Downloaded" : "Download as .txt"}
          </Button>
        </div>

        <div
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {codesSaved
            ? "Stored somewhere safe? You can close this now."
            : "Copy or download the codes to continue."}
        </div>

        <div className="border-t border-border/50 pt-4">
          <Button
            variant={codesSaved ? "default" : "outline"}
            onClick={() => {
              setBackupCodes([]);
              setCodesCopied(false);
              setCodesDownloaded(false);
            }}
            className="gap-2"
          >
            {codesSaved ? "Done, I saved them" : "Skip, I will not save them"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Sign-in summary: one line of prose, not a row of stat cards. */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        {hasPassword
          ? "Your account is protected by a password"
          : "You sign in through an outside provider, with no password on file"}
        {appActive
          ? " and a code from your authenticator app."
          : emailActive
            ? " and a code emailed to you at sign-in."
            : hasPassword
              ? ". Two-step verification is off, so a stolen password is enough to get in."
              : "."}
      </p>

      {/* ─────────── Password ─────────── */}
      <Section
        title="Password"
        blurb={
          hasPassword
            ? "Used every time you sign in."
            : "Not set. You signed up with an outside provider, so add one if you also want to sign in with a password."
        }
      >
        {!showPasswordForm ? (
          <Card className="border-border/50 bg-card/50">
            <CardContent className="flex items-center justify-between gap-4 py-5">
              <p className="text-sm text-foreground">
                {hasPassword
                  ? "Your password is set."
                  : "No password on file yet."}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 shrink-0"
                onClick={() => setShowPasswordForm(true)}
              >
                {hasPassword ? "Change password" : "Set a password"}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5 flex flex-col gap-4">
            {passwordError && (
              <InlineAlert tone="error">{passwordError}</InlineAlert>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {hasPassword && (
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <Label htmlFor="sec-current-pw">Current password</Label>
                  <Input
                    id="sec-current-pw"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="h-10"
                  />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="sec-new-pw">New password</Label>
                <Input
                  id="sec-new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-10"
                  aria-describedby="sec-new-pw-hint"
                />
                <p
                  id="sec-new-pw-hint"
                  className="text-xs text-muted-foreground"
                >
                  At least 8 characters.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="sec-confirm-new-pw">Confirm new password</Label>
                <Input
                  id="sec-confirm-new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="h-10"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleChangePassword();
                  }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={handleChangePassword} disabled={savingPassword}>
                {savingPassword ? (
                  <>
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    {hasPassword ? "Updating..." : "Saving..."}
                  </>
                ) : hasPassword ? (
                  "Update password"
                ) : (
                  "Set password"
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowPasswordForm(false);
                  setPasswordError(null);
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmNewPassword("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Section>

      {/* ─────────── Two-step verification ─────────── */}
      <Section
        title="Two-step verification"
        blurb={
          totpEnabled
            ? "A second code is required after your password."
            : "Ask for a second code after the password, so a leaked password is not enough."
        }
        aside={
          <StatusPill tone={totpEnabled ? "on" : "off"}>
            {appActive
              ? "Authenticator app"
              : emailActive
                ? "Email codes"
                : "Off"}
          </StatusPill>
        }
      >
        <div className="flex flex-col gap-3">
          {/* ── Authenticator app ── */}
          <div
            className={cn(
              "rounded-xl border p-4 sm:p-5 flex flex-col gap-4",
              appActive
                ? "border-primary/25 bg-primary/4"
                : "border-border bg-card",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  Authenticator app
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  A rotating 6-digit code from Google Authenticator, Authy,
                  1Password, or similar. Works offline.
                </p>
              </div>
              {appActive ? (
                <StatusPill tone="on">Active</StatusPill>
              ) : (
                (!totpEnabled || emailActive) &&
                !setting2FA && (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 shrink-0"
                    disabled={emailActive || startingSetup}
                    onClick={async () => {
                      setStartingSetup(true);
                      setEnrolError(null);
                      try {
                        const res = await fetch(API.AUTH.TWO_FA.SETUP);
                        const data = await res.json();
                        if (res.ok) {
                          setTotpUri(data.uri);
                          setTotpSecret(data.secret);
                          setEnrolStep("scan");
                          setSetting2FA(true);
                        } else {
                          setError(
                            data.error ||
                              "We could not start setup. Try again in a moment.",
                          );
                        }
                      } catch {
                        setError(
                          "We could not reach the server. Check your connection and try again.",
                        );
                      } finally {
                        setStartingSetup(false);
                      }
                    }}
                  >
                    {startingSetup && (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    {emailActive
                      ? "Turn off email codes first"
                      : "Set up authenticator app"}
                  </Button>
                )
              )}
            </div>

            {/* App 2FA active: backup codes + turn off */}
            {appActive && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      Backup codes
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {backupCodesRemaining === null ? (
                        backupCodesCheckFailed ? (
                          "Could not check how many are left. Reload the page to check again."
                        ) : (
                          "Checking how many are left..."
                        )
                      ) : (
                        <>
                          {backupCodesRemaining} of {BACKUP_CODE_SET_SIZE} left.
                          {backupCodesRemaining <= 2 && backupCodesRemaining > 0
                            ? " Generate a new set soon."
                            : ""}
                          {backupCodesRemaining === 0
                            ? " Generate a new set to keep a way back in."
                            : ""}
                        </>
                      )}
                    </p>
                  </div>
                  {!showRegenerateBackup && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => setShowRegenerateBackup(true)}
                    >
                      New codes
                    </Button>
                  )}
                </div>

                {showRegenerateBackup && (
                  <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                    <div>
                      <Label htmlFor="regen-backup-password">
                        Confirm your password to generate new codes
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Your {BACKUP_CODE_SET_SIZE} current codes stop working
                        the moment new ones are issued.
                      </p>
                    </div>
                    <Input
                      id="regen-backup-password"
                      type="password"
                      autoComplete="current-password"
                      value={regenPassword}
                      onChange={(e) => setRegenPassword(e.target.value)}
                      className="h-10 max-w-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        disabled={!regenPassword || regenerating}
                        onClick={async () => {
                          setRegenerating(true);
                          try {
                            const res = await fetch(
                              API.AUTH.TWO_FA.BACKUP_CODES,
                              {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  password: regenPassword,
                                }),
                              },
                            );
                            const data = await res.json();
                            if (res.ok) {
                              setBackupCodes(data.backupCodes);
                              setBackupCodesRemaining(data.backupCodes.length);
                              setShowRegenerateBackup(false);
                              setRegenPassword("");
                              setCodesCopied(false);
                              setCodesDownloaded(false);
                              setSuccess("New backup codes generated.");
                            } else {
                              setError(
                                data.error ||
                                  "We could not generate new codes. Check your password and try again.",
                              );
                            }
                          } catch {
                            setError(
                              "We could not reach the server. Check your connection and try again.",
                            );
                          } finally {
                            setRegenerating(false);
                          }
                        }}
                      >
                        {regenerating ? (
                          <>
                            <Loader2
                              className="mr-2 h-4 w-4 animate-spin"
                              aria-hidden="true"
                            />
                            Generating...
                          </>
                        ) : (
                          "Generate new codes"
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setShowRegenerateBackup(false);
                          setRegenPassword("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {!showDisable2FA ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowDisable2FA(true);
                      setDisableError(null);
                    }}
                    className="self-start text-sm text-muted-foreground hover:text-destructive underline underline-offset-4 transition-colors rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Turn off the authenticator app
                  </button>
                ) : (
                  <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Turn off two-step verification?
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Your authenticator entry and all {BACKUP_CODE_SET_SIZE}{" "}
                        backup codes are deleted. After this, your password
                        alone signs you in.
                      </p>
                    </div>
                    {disableError && (
                      <p
                        role="alert"
                        className="text-sm text-destructive font-medium"
                      >
                        {disableError}
                      </p>
                    )}
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="disable-app-2fa-password">
                        Confirm your password
                      </Label>
                      <Input
                        id="disable-app-2fa-password"
                        type="password"
                        autoComplete="current-password"
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        className="h-10 max-w-sm"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        disabled={!disablePassword || disabling2FA}
                        onClick={async () => {
                          setDisabling2FA(true);
                          setDisableError(null);
                          try {
                            const res = await fetch(API.AUTH.TWO_FA.DISABLE, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                password: disablePassword,
                              }),
                            });
                            const data = await res.json();
                            if (res.ok) {
                              setTotpEnabled(false);
                              setTwoFactorMethod(null);
                              setShowDisable2FA(false);
                              setDisablePassword("");
                              // totpEnabled/twoFactorMethod are part of
                              // MeResponse -- see refreshAuthCache's other
                              // call sites in this file for why this needs
                              // telling to the app-wide useAuth() cache too.
                              refreshAuthCache();
                              setSuccess(
                                "Authenticator app turned off. Your password is now the only thing protecting this account.",
                              );
                            } else {
                              setDisableError(
                                data.error ||
                                  "That password was not accepted. Try again.",
                              );
                            }
                          } catch {
                            setDisableError(
                              "We could not reach the server. Check your connection and try again.",
                            );
                          } finally {
                            setDisabling2FA(false);
                          }
                        }}
                      >
                        {disabling2FA ? (
                          <>
                            <Loader2
                              className="mr-2 h-4 w-4 animate-spin"
                              aria-hidden="true"
                            />
                            Turning off...
                          </>
                        ) : (
                          "Turn off"
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setShowDisable2FA(false);
                          setDisablePassword("");
                          setDisableError(null);
                        }}
                      >
                        Keep it on
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Enrolment: two deliberate steps. The trigger button lives in
                the box header above; this appears once that starts. */}
            {(!totpEnabled || emailActive) && setting2FA && (
              <div className="flex flex-col gap-4">
                {/* Step rail */}
                <ol className="flex items-center gap-2 text-xs">
                  {(
                    [
                      ["scan", "Scan"],
                      ["verify", "Verify"],
                    ] as const
                  ).map(([id, label], i) => {
                    const done = enrolStep === "verify" && id === "scan";
                    const current = enrolStep === id;
                    return (
                      <li key={id} className="flex items-center gap-2">
                        {i > 0 && (
                          <ChevronRight
                            className="h-3.5 w-3.5 text-muted-foreground/50"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          aria-current={current ? "step" : undefined}
                          className={cn(
                            "font-medium",
                            current
                              ? "text-primary"
                              : done
                                ? "text-foreground"
                                : "text-muted-foreground",
                          )}
                        >
                          {i + 1}. {label}
                        </span>
                      </li>
                    );
                  })}
                </ol>

                {enrolStep === "scan" ? (
                  <div className="rounded-lg border border-border bg-card p-4 sm:p-5 flex flex-col sm:flex-row gap-5">
                    {/* The QR quiet zone must stay white in both themes for
                        scanners to read it reliably. */}
                    <div className="mx-auto sm:mx-0 shrink-0 rounded-lg border border-border bg-white p-3">
                      <QRCodeSVG
                        value={totpUri}
                        size={160}
                        level="M"
                        includeMargin={false}
                      />
                    </div>
                    <div className="flex flex-col gap-3 min-w-0">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          Scan this with your authenticator app
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          Open the app, add an account, and point the camera
                          here. It will start showing a 6-digit code for{" "}
                          {APP_NAME}.
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 min-w-0">
                        <span className="text-xs text-muted-foreground">
                          Cannot scan? Type this key instead:
                        </span>
                        <code className="rounded border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-primary break-all select-all">
                          {totpSecret}
                        </code>
                      </div>
                      <Button
                        className="self-start gap-2 mt-1"
                        onClick={() => {
                          setEnrolStep("verify");
                          setEnrolError(null);
                        }}
                      >
                        I have added it
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-card p-4 sm:p-5 flex flex-col gap-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Prove the app is working
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Enter the current code from your app, then confirm your
                        password.
                      </p>
                    </div>

                    {enrolError && (
                      <InlineAlert tone="error">{enrolError}</InlineAlert>
                    )}

                    <div className="flex flex-col sm:flex-row gap-4">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="setup-2fa-code">6-digit code</Label>
                        <Input
                          id="setup-2fa-code"
                          ref={codeInputRef}
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          placeholder="000000"
                          value={totpVerifyCode}
                          onChange={(e) =>
                            setTotpVerifyCode(
                              e.target.value.replace(/\D/g, "").slice(0, 6),
                            )
                          }
                          className="h-10 w-[180px] text-center text-lg tracking-[0.3em] font-mono"
                        />
                      </div>
                      <div className="flex flex-col gap-2 flex-1 min-w-0">
                        <Label htmlFor="setup-2fa-password">
                          Your password
                        </Label>
                        <Input
                          id="setup-2fa-password"
                          type="password"
                          autoComplete="current-password"
                          value={setup2FAPassword}
                          onChange={(e) => setSetup2FAPassword(e.target.value)}
                          className="h-10 sm:max-w-[260px]"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        disabled={
                          totpVerifyCode.length !== 6 ||
                          !setup2FAPassword ||
                          verifying2FA
                        }
                        onClick={async () => {
                          setVerifying2FA(true);
                          setEnrolError(null);
                          try {
                            const res = await fetch(API.AUTH.TWO_FA.SETUP, {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                code: totpVerifyCode,
                                currentPassword: setup2FAPassword,
                              }),
                            });
                            const data = await res.json();
                            if (res.ok) {
                              setTotpEnabled(true);
                              setTwoFactorMethod("app");
                              setSetting2FA(false);
                              setEnrolStep("scan");
                              setTotpUri("");
                              setTotpSecret("");
                              setTotpVerifyCode("");
                              setSetup2FAPassword("");
                              setCodesCopied(false);
                              setCodesDownloaded(false);
                              setBackupCodes(data.backupCodes || []);
                              setBackupCodesRemaining(
                                data.backupCodes?.length || 0,
                              );
                              refreshAuthCache();
                              setSuccess(
                                "Authenticator app is on. Save your backup codes.",
                              );
                            } else {
                              setEnrolError(
                                data.error ||
                                  "That code did not match. Codes expire every 30 seconds, so try the current one.",
                              );
                            }
                          } catch {
                            setEnrolError(
                              "We could not reach the server. Check your connection and try again.",
                            );
                          } finally {
                            setVerifying2FA(false);
                          }
                        }}
                      >
                        {verifying2FA ? (
                          <>
                            <Loader2
                              className="mr-2 h-4 w-4 animate-spin"
                              aria-hidden="true"
                            />
                            Verifying...
                          </>
                        ) : (
                          "Verify and turn on"
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEnrolStep("scan");
                          setEnrolError(null);
                        }}
                      >
                        Back to the QR code
                      </Button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={resetEnrolment}
                  className="self-start text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Cancel setup
                </button>
              </div>
            )}
          </div>

          {/* ── Email codes ── */}
          <div
            className={cn(
              "rounded-xl border p-4 sm:p-5 flex flex-col gap-4",
              emailActive
                ? "border-primary/25 bg-primary/4"
                : "border-border bg-card",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  Email codes
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  We send a 6-digit code to {user?.email || "your inbox"} at
                  every sign-in. Simpler to set up, but only as safe as your
                  email account.
                </p>
              </div>
              {emailActive ? (
                <StatusPill tone="on">Active</StatusPill>
              ) : (
                (!totpEnabled || appActive) &&
                !showEnableEmail2FA && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 shrink-0"
                    disabled={appActive}
                    onClick={() => {
                      if (appActive) return;
                      setEmailEnableError(null);
                      setShowEnableEmail2FA(true);
                    }}
                  >
                    {appActive
                      ? "Turn off the authenticator app first"
                      : "Turn on email codes"}
                  </Button>
                )
              )}
            </div>

            {emailActive && (
              <>
                {!showDisable2FA ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowDisable2FA(true);
                      setDisableError(null);
                    }}
                    className="self-start text-sm text-muted-foreground hover:text-destructive underline underline-offset-4 transition-colors rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Turn off email codes
                  </button>
                ) : (
                  <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Turn off two-step verification?
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        We stop emailing sign-in codes. After this, your
                        password alone signs you in.
                      </p>
                    </div>
                    {disableError && (
                      <p
                        role="alert"
                        className="text-sm text-destructive font-medium"
                      >
                        {disableError}
                      </p>
                    )}
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="disable-email-2fa-password">
                        Confirm your password
                      </Label>
                      <Input
                        id="disable-email-2fa-password"
                        type="password"
                        autoComplete="current-password"
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        className="h-10 max-w-sm"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        disabled={!disablePassword || disabling2FA}
                        onClick={async () => {
                          setDisabling2FA(true);
                          setDisableError(null);
                          try {
                            const res = await fetch(
                              API.AUTH.TWO_FA.EMAIL_SETUP,
                              {
                                method: "DELETE",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  password: disablePassword,
                                }),
                              },
                            );
                            const data = await res.json();
                            if (res.ok) {
                              setTotpEnabled(false);
                              setTwoFactorMethod(null);
                              setShowDisable2FA(false);
                              setDisablePassword("");
                              refreshAuthCache();
                              setSuccess(
                                "Email codes turned off. Your password is now the only thing protecting this account.",
                              );
                            } else {
                              setDisableError(
                                data.error ||
                                  "That password was not accepted. Try again.",
                              );
                            }
                          } catch {
                            setDisableError(
                              "We could not reach the server. Check your connection and try again.",
                            );
                          } finally {
                            setDisabling2FA(false);
                          }
                        }}
                      >
                        {disabling2FA ? (
                          <>
                            <Loader2
                              className="mr-2 h-4 w-4 animate-spin"
                              aria-hidden="true"
                            />
                            Turning off...
                          </>
                        ) : (
                          "Turn off"
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setShowDisable2FA(false);
                          setDisablePassword("");
                          setDisableError(null);
                        }}
                      >
                        Keep it on
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {(!totpEnabled || appActive) && showEnableEmail2FA && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
                {emailEnableError && (
                  <p
                    role="alert"
                    className="text-sm text-destructive font-medium"
                  >
                    {emailEnableError}
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="enable-email-2fa-password">
                    Confirm your password to turn on email codes
                  </Label>
                  <Input
                    id="enable-email-2fa-password"
                    type="password"
                    autoComplete="current-password"
                    value={email2FAPassword}
                    onChange={(e) => setEmail2FAPassword(e.target.value)}
                    className="h-10 max-w-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={!email2FAPassword.trim() || togglingEmail2FA}
                    onClick={async () => {
                      setTogglingEmail2FA(true);
                      setEmailEnableError(null);
                      try {
                        const res = await fetch(API.AUTH.TWO_FA.EMAIL_SETUP, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            password: email2FAPassword.trim(),
                          }),
                        });
                        const data = await res.json();
                        if (res.ok) {
                          setTotpEnabled(true);
                          setTwoFactorMethod("email");
                          setEmail2FAPassword("");
                          setShowEnableEmail2FA(false);
                          refreshAuthCache();
                          setSuccess("Email codes are on.");
                        } else {
                          setEmailEnableError(
                            data.error ||
                              "That password was not accepted. Try again.",
                          );
                        }
                      } catch {
                        setEmailEnableError(
                          "We could not reach the server. Check your connection and try again.",
                        );
                      } finally {
                        setTogglingEmail2FA(false);
                      }
                    }}
                  >
                    {togglingEmail2FA ? (
                      <>
                        <Loader2
                          className="mr-2 h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        Turning on...
                      </>
                    ) : (
                      "Turn on email codes"
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowEnableEmail2FA(false);
                      setEmail2FAPassword("");
                      setEmailEnableError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ─────────── Active sessions ─────────── */}
      {/* "Sign out everywhere" used to be its own danger-zone panel at the
          very bottom of this tab, below trusted devices and sign-in alerts.
          It is a session action, so it belongs on the section that lists
          sessions: someone who has just spotted a device they do not
          recognize is looking here, not 600px further down. The destructive
          outline plus the confirmation dialog still mark it as the drastic
          option. */}
      <Section
        title="Active sessions"
        blurb="Every device currently signed in. If you don't recognize one, sign it out. Signing out everywhere ends this session too."
        aside={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setShowLogoutModal(true)}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Sign out everywhere
          </Button>
        }
      >
        {sessionsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading sessions...
          </div>
        ) : sessionsError ? (
          <p className="text-sm text-muted-foreground">{sessionsError}</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active sessions found.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">
                      {s.device}
                    </span>
                    {s.isCurrent && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
                        This device
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {/* Prefer the captured IPv4 (more actionable); fall back to
                        the connection IP so a failed or absent capture never
                        leaves this blank. */}
                    {s.ipv4Address || s.ipAddress
                      ? `${s.ipv4Address || s.ipAddress} · `
                      : ""}
                    Signed in {formatDateTime(s.createdAt)}
                  </p>
                </div>
                {!s.isCurrent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevokeSession(s.id)}
                    disabled={revokingSessionId === s.id}
                    className="text-muted-foreground hover:text-destructive h-8 gap-1.5 shrink-0"
                    aria-label={`Sign out the session on ${s.device}`}
                  >
                    {revokingSessionId === s.id ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ─────────── Trusted devices ─────────── */}
      {(devicesLoading || trustedDevices.length > 0) && (
        <Section
          title="Trusted devices"
          blurb="Devices that skip the two-step code because they already proved it once. Remove one to require the code again next time."
        >
          {devicesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading trusted devices...
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {trustedDevices.map((d) => (
                <li
                  key={d.id}
                  className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">
                        {d.deviceName || d.device}
                      </span>
                      {d.isCurrent && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
                          This device
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {d.ipAddress ? `${d.ipAddress} · ` : ""}
                      Last used {formatDateTime(d.lastUsedAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevokeDevice(d.id)}
                    disabled={revokingDeviceId === d.id}
                    className="text-muted-foreground hover:text-destructive h-8 gap-1.5 shrink-0"
                    aria-label={`Remove trusted device ${d.deviceName || d.device}`}
                  >
                    {revokingDeviceId === d.id ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* ─────────── Sign-in alerts ───────────
          A pointer to another tab, not a setting. It used to be a full
          Section plus a Card, which gave a signpost the same visual weight
          as password and 2FA and added a fifth identical bordered box to the
          stack. One line of prose with an inline link says the same thing. */}
      <p className="text-sm text-muted-foreground leading-relaxed border-t border-border/50 pt-6">
        Emails about new sign-ins, password changes and revoked sessions are set
        up on the{" "}
        <a
          href={`${ROUTES.PROFILE}?tab=notifications`}
          onClick={(e) => {
            if (!e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              onTabChange("notifications");
            }
          }}
          className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-2 rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          Notifications tab
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        .
      </p>

      {/* Sign out everywhere confirmation */}
      <Dialog open={showLogoutModal} onOpenChange={setShowLogoutModal}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className="h-5 w-5 text-destructive shrink-0"
                aria-hidden="true"
              />
              Sign out everywhere?
            </DialogTitle>
            <DialogDescription>
              This ends every session for {user?.email || "your account"},
              including the one you are using now. You will land on the sign-in
              page and need your password again on every device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowLogoutModal(false)}
              disabled={forceLoggingOut}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleForceLogout}
              disabled={forceLoggingOut}
              className="gap-2"
            >
              {forceLoggingOut ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Signing out...
                </>
              ) : (
                <>
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out everywhere
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
