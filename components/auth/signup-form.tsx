"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Eye, EyeOff, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  API,
  PASSWORD_MIN_LENGTH,
  TURNSTILE_ENABLED,
} from "@/lib/config/client-constants";
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
  authPillClass,
  PasswordStrengthMeter,
} from "@/components/auth/auth-shell";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { TurnstileWidget } from "@/components/shared/turnstile-widget";

interface SignupFormProps {
  onSuccess: (email: string) => void;
  initialError?: string;
}

export function SignupForm({ onSuccess, initialError }: SignupFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(initialError || "");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const passwordContext = { email, name };
  const analysis = analyzePassword(password);
  const strength = analysis.strength;
  // The endpoint rejects anything scoring under 3 even when it is long
  // enough, so say so here rather than after a round trip.
  const weakHint =
    password && analysis.score < 3
      ? analysis.feedback.warnings[0] || analysis.feedback.suggestions[0]
      : undefined;
  const requirements = checkPasswordRequirements(password, passwordContext);
  const requirementsMet = passwordRequirementsMet(requirements);
  const confirmMatches =
    confirmPassword.length > 0 && confirmPassword === password;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError(
        "Add a name. It is what shows on shared reports and team lists.",
      );
      return;
    }
    if (password !== confirmPassword) {
      setError("The two passwords are different. Retype the second one.");
      return;
    }
    if (!requirementsMet) {
      setError(
        "That password does not meet every requirement below yet. Check the list under the password field.",
      );
      return;
    }
    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError("Finish the captcha below, then create the account.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(API.AUTH.SIGNUP, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: name.trim(),
          turnstileToken: TURNSTILE_ENABLED ? turnstileToken : null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "That account could not be created.");
        setLoading(false);
        return;
      }

      onSuccess(email);
    } catch {
      setError(
        "Could not reach the server. Check your connection, then retry.",
      );
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Your name</Label>
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          aria-describedby="name-hint"
          className={authFieldClass}
        />
        <p id="name-hint" className="text-xs text-muted-foreground">
          Shown on shared reports and to anyone on your team.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-describedby="email-hint"
          className={authFieldClass}
        />
        <p id="email-hint" className="text-xs text-muted-foreground">
          We send one verification link here before the account works.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={PASSWORD_MIN_LENGTH}
            aria-describedby={password ? "password-strength" : undefined}
            className={cn(authFieldClass, "pr-11")}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className={cn(
              "absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-md",
              "flex items-center justify-center text-muted-foreground hover:text-foreground",
              transitions.colors,
              authFocusRing,
            )}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? (
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
            context={passwordContext}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmPassword">Retype password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          placeholder="The same password again"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          aria-describedby="confirm-status"
          className={authFieldClass}
        />
        <p
          id="confirm-status"
          aria-live="polite"
          className={cn(
            "text-xs flex items-center gap-1.5 min-h-4",
            confirmMatches ? "text-primary" : "text-muted-foreground",
          )}
        >
          {confirmPassword.length === 0 ? null : confirmMatches ? (
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

      {error && <AuthAlert>{error}</AuthAlert>}

      <TurnstileWidget onVerify={setTurnstileToken} />

      <Button
        type="submit"
        size="lg"
        disabled={
          loading ||
          !name.trim() ||
          !email.trim() ||
          !requirementsMet ||
          !confirmMatches ||
          (TURNSTILE_ENABLED && !turnstileToken)
        }
        className={cn("h-11 w-full", authFocusRing)}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Creating account
          </>
        ) : (
          "Create account"
        )}
      </Button>

      <OAuthButtons actionLabel="Sign up" intent="signup" />

      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
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

      <Link href="/" className={authPillClass}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to landing
      </Link>
    </form>
  );
}
