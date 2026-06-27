"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle } from "lucide-react";
import { API } from "@/lib/config/client-constants";

interface Login2FAFormProps {
  redirectTo: string;
  userId: number | null;
  method: string;
  _maskedEmail?: string;
  isDiscordAuth?: boolean;
}

export function Login2FAForm({
  redirectTo,
  userId,
  method,
  _maskedEmail,
  isDiscordAuth,
}: Login2FAFormProps) {
  const router = useRouter();
  const [totpCode, setTotpCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCodeInput, setBackupCodeInput] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);

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
        setError(data.error || "Verification failed.");
        setVerifying(false);
        return;
      }

      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setVerifying(false);
    }
  }

  async function handleResendEmailCode() {
    setResendingCode(true);
    setError("");
    try {
      const res = await fetch("/api/v3/auth/2fa/email-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to resend code.");
      } else {
        setTotpCode("");
      }
    } catch {
      setError("Failed to resend code.");
    } finally {
      setResendingCode(false);
    }
  }

  return (
    <form onSubmit={handleVerify} className="flex flex-col gap-4">
      {useBackupCode ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-code" className="text-sm font-medium">
            Backup Code
          </Label>
          <Input
            id="backup-code"
            type="text"
            placeholder="XXXX-XXXX"
            maxLength={9}
            value={backupCodeInput}
            onChange={(e) => setBackupCodeInput(e.target.value.toUpperCase())}
            required
            autoFocus
            autoComplete="off"
            className="h-11 text-center text-lg tracking-widest font-mono border-border/40"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="totp-code" className="text-sm font-medium">
            Verification Code
          </Label>
          <Input
            id="totp-code"
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
            className="h-11 text-center text-lg tracking-[0.3em] font-mono border-border/40"
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
          <p
            className="text-sm text-destructive flex items-center gap-2"
            role="alert"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="remember-device"
          checked={rememberDevice}
          onChange={(e) => setRememberDevice(e.target.checked)}
          className="h-4 w-4 rounded border-border bg-card cursor-pointer"
        />
        <label
          htmlFor="remember-device"
          className="text-sm text-muted-foreground cursor-pointer"
        >
          Trust this device for 30 days
        </label>
      </div>

      <Button
        type="submit"
        disabled={
          verifying ||
          (useBackupCode ? backupCodeInput.length < 8 : totpCode.length !== 6)
        }
        className="h-10 w-full mt-2"
      >
        {verifying ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Verifying...
          </>
        ) : (
          "Verify & Sign in"
        )}
      </Button>

      <div className="flex flex-col items-center gap-2 mt-1">
        {method === "email" ? (
          <button
            type="button"
            disabled={resendingCode}
            onClick={handleResendEmailCode}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {resendingCode ? "Sending..." : "Resend code"}
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
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {useBackupCode ? "Use Authenticator App" : "Use Backup Code"}
          </button>
        )}
      </div>
    </form>
  );
}
