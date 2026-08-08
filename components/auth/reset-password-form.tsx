"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { API } from "@/lib/config/client-constants";
import { PASSWORD_MIN_LENGTH } from "@/lib/config/constants";
import {
  analyzePassword,
  checkPasswordRequirements,
  passwordRequirementsMet,
} from "@/lib/auth/password-strength";
import { cn } from "@/lib/ui/utils";
import { transitions } from "@/lib/ui/animations";
import {
  AuthAlert,
  authFieldClass,
  authFocusRing,
  PasswordStrengthMeter,
} from "@/components/auth/auth-shell";

// This page only has the reset token, not the target account's email or
// name, so those two personal-info checks can't run client-side. The
// checklist hides them here; the server still enforces the full set once
// the token resolves to a user row.
const RESET_OMIT_REQUIREMENT_IDS = ["no-email", "no-name"];

interface ResetPasswordFormProps {
  token: string;
  onSuccess: () => void;
}

export function ResetPasswordForm({
  token,
  onSuccess,
}: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const analysis = analyzePassword(password);
  const strength = analysis.strength;
  const weakHint =
    password && analysis.score < 3
      ? analysis.feedback.warnings[0] || analysis.feedback.suggestions[0]
      : undefined;
  const requirements = checkPasswordRequirements(password);
  const requirementsMet = passwordRequirementsMet(requirements);
  const confirmMatches = confirm.length > 0 && confirm === password;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two passwords are different. Retype the second one.");
      return;
    }
    if (!requirementsMet) {
      setError(
        "That password does not meet every requirement below yet. Check the list under the password field.",
      );
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(API.AUTH.RESET_PASSWORD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "That password could not be set.");
        return;
      }
      onSuccess();
    } catch {
      setError(
        "Could not reach the server. Check your connection, then retry.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPass ? "text" : "password"}
            autoComplete="new-password"
            placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            minLength={PASSWORD_MIN_LENGTH}
            aria-describedby={password ? "password-strength" : undefined}
            className={cn(authFieldClass, "pr-11")}
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            className={cn(
              "absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-md",
              "flex items-center justify-center text-muted-foreground hover:text-foreground",
              transitions.colors,
              authFocusRing,
            )}
            aria-label={showPass ? "Hide password" : "Show password"}
            aria-pressed={showPass}
          >
            {showPass ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {password && (
          <PasswordStrengthMeter
            id="password-strength"
            password={password}
            level={strength.level}
            label={strength.label}
            hint={weakHint}
            omitIds={RESET_OMIT_REQUIREMENT_IDS}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">Retype new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type={showPass ? "text" : "password"}
          autoComplete="new-password"
          placeholder="The same password again"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          aria-describedby="confirm-status"
          className={authFieldClass}
        />
        <p
          id="confirm-status"
          aria-live="polite"
          className={cn(
            "text-xs flex items-center gap-1.5 min-h-[1rem]",
            confirmMatches ? "text-primary" : "text-muted-foreground",
          )}
        >
          {confirm.length === 0 ? null : confirmMatches ? (
            <>
              <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
              Both passwords match.
            </>
          ) : (
            <>
              <X className="h-3 w-3 shrink-0" aria-hidden="true" />
              Not the same yet.
            </>
          )}
        </p>
      </div>

      {error && (
        <AuthAlert
          action={
            <Link
              href="/forgot-password"
              className={cn(
                "inline-block rounded text-sm font-medium text-foreground hover:text-primary",
                transitions.colors,
                authFocusRing,
              )}
            >
              Request a fresh reset link
            </Link>
          }
        >
          {error}
        </AuthAlert>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={
          loading ||
          !password ||
          !confirm ||
          password !== confirm ||
          !requirementsMet
        }
        className={cn("h-11 w-full mt-1", authFocusRing)}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Saving the new password
          </>
        ) : (
          "Save new password"
        )}
      </Button>

      <p className="text-sm text-muted-foreground">
        Remembered it after all?{" "}
        <Link
          href="/login"
          className={cn(
            "text-primary font-medium rounded hover:underline underline-offset-4",
            authFocusRing,
          )}
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
