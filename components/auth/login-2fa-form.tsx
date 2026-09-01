"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import {
  API,
  DEVICE_TRUST_DURATION,
  TOTP_CODE_VALIDITY,
} from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { transitions } from "@/lib/ui/animations";
import {
  AuthAlert,
  authFieldClass,
  authFocusRing,
} from "@/components/auth/auth-shell";
import { refreshAuthCache } from "@/components/providers/auth-provider";

const TRUST_DAYS = Math.round(DEVICE_TRUST_DURATION / 86400);

interface Login2FAFormProps {
  redirectTo: string;
  userId: number | null;
  method: string;
  _maskedEmail?: string;
  // True whenever the pending login came from a full-page redirect (the
  // existing Discord account-linking login, or a Google/GitHub/Discord
  // OAuth sign-in) rather than the password login form's fetch response.
  // Both cases carry the real userId in a server-set cookie instead of
  // client state, so the submit below sends a 0 sentinel and lets the
  // server resolve it from that cookie (see
  // app/api/v3/auth/2fa/verify/route.ts).
  isDiscordAuth?: boolean;
  onCancel?: () => void;
}

export function Login2FAForm({
  redirectTo,
  userId,
  method,
  _maskedEmail,
  isDiscordAuth,
  onCancel,
}: Login2FAFormProps) {
  const router = useRouter();
  const [totpCode, setTotpCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCodeInput, setBackupCodeInput] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);
  const [resent, setResent] = useState(false);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setVerifying(true);

    try {
      const effectiveUserId = isDiscordAuth ? 0 : userId;
      const body = useBackupCode
        ? {
            userId: effectiveUserId,
            backupCode: backupCodeInput,
            rememberDevice,
          }
        : { userId: effectiveUserId, code: totpCode, rememberDevice };

      const res = await fetch(API.AUTH.TWO_FA.VERIFY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(
          data.error ||
            (useBackupCode
              ? "That backup code was not accepted. Each one works once only."
              : `That code was not accepted. Codes roll every ${TOTP_CODE_VALIDITY} seconds, so read the current one from your app.`),
        );
        setVerifying(false);
        return;
      }

      refreshAuthCache();
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError(
        "Could not reach the server. Check your connection, then retry.",
      );
      setVerifying(false);
    }
  }

  async function handleResendEmailCode() {
    setResendingCode(true);
    setError("");
    setResent(false);
    try {
      const res = await fetch("/api/v3/auth/2fa/email-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error ||
            "That code could not be sent. Wait a minute and try again.",
        );
      } else {
        setTotpCode("");
        setResent(true);
      }
    } catch {
      setError("That code could not be sent. Check your connection and retry.");
    } finally {
      setResendingCode(false);
    }
  }

  const canSubmit = useBackupCode
    ? backupCodeInput.length === 23
    : totpCode.length === 6;

  return (
    <form onSubmit={handleVerify} className="flex flex-col gap-4" noValidate>
      {useBackupCode ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-code">Backup code</Label>
          <Input
            id="backup-code"
            name="backup-code"
            type="text"
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            maxLength={23}
            value={backupCodeInput}
            onChange={(e) => setBackupCodeInput(e.target.value.toUpperCase())}
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="backup-code-hint"
            className={cn(
              authFieldClass,
              "text-center text-base tracking-widest font-mono",
            )}
          />
          <p id="backup-code-hint" className="text-xs text-muted-foreground">
            One of the codes you saved when you turned on two-factor auth. Each
            code works once.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="totp-code">6-digit code</Label>
          <Input
            id="totp-code"
            name="totp-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            value={totpCode}
            onChange={(e) =>
              setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            required
            autoFocus
            autoComplete="one-time-code"
            className={cn(
              authFieldClass,
              "text-center text-lg tracking-[0.3em] font-mono",
            )}
          />
        </div>
      )}

      {error && <AuthAlert>{error}</AuthAlert>}

      {resent && !error && (
        <AuthAlert tone="info">
          New code sent. The previous one no longer works.
        </AuthAlert>
      )}

      <label
        htmlFor="remember-device"
        className="flex items-start gap-2.5 cursor-pointer group"
      >
        <input
          type="checkbox"
          id="remember-device"
          checked={rememberDevice}
          onChange={(e) => setRememberDevice(e.target.checked)}
          className={cn(
            "h-4 w-4 mt-0.5 shrink-0 rounded border-border bg-background cursor-pointer accent-primary",
            authFocusRing,
          )}
        />
        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
          Skip this step on this device for {TRUST_DAYS} days
        </span>
      </label>

      <Button
        type="submit"
        size="lg"
        disabled={verifying || !canSubmit}
        className={cn("h-11 w-full mt-1", authFocusRing)}
      >
        {verifying ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Signing in
          </>
        ) : (
          "Sign in"
        )}
      </Button>

      <div className="flex flex-col items-start gap-2.5 mt-1 text-sm">
        {method === "email" ? (
          <button
            type="button"
            disabled={resendingCode}
            onClick={handleResendEmailCode}
            className={cn(
              "rounded text-muted-foreground hover:text-foreground disabled:opacity-50",
              transitions.colors,
              authFocusRing,
            )}
          >
            {resendingCode ? "Sending a new code" : "Send a new code"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setUseBackupCode(!useBackupCode);
              setBackupCodeInput("");
              setTotpCode("");
              setRememberDevice(false);
              setError("");
            }}
            className={cn(
              "rounded text-muted-foreground hover:text-foreground",
              transitions.colors,
              authFocusRing,
            )}
          >
            {useBackupCode
              ? "Use my authenticator app instead"
              : "Lost your authenticator? Use a backup code"}
          </button>
        )}

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              "rounded text-muted-foreground hover:text-foreground",
              transitions.colors,
              authFocusRing,
            )}
          >
            Start over with a different account
          </button>
        )}
      </div>
    </form>
  );
}
