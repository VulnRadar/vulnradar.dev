"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { API } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { transitions } from "@/lib/ui/animations";
import {
  AuthAlert,
  authFieldClass,
  authFocusRing,
} from "@/components/auth/auth-shell";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { refreshAuthCache } from "@/components/providers/auth-provider";

interface LoginFormProps {
  redirectTo: string;
  initialError?: string;
  onRequires2FA: (userId: number, method: string, maskedEmail?: string) => void;
}

export function LoginForm({
  redirectTo,
  initialError,
  onRequires2FA,
}: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(initialError || "");
  const [loading, setLoading] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  async function handleResendVerification() {
    setResendingVerification(true);
    setResendSuccess(false);
    try {
      const res = await fetch(API.AUTH.RESEND_VERIFICATION, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResendSuccess(true);
        setError("");
      } else if (!res.ok) {
        setError(
          data.error ||
            "That verification email could not be sent. Wait a minute and try again.",
        );
      }
    } catch {
      setError(
        "That verification email could not be sent. Check your connection and try again.",
      );
    } finally {
      setResendingVerification(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setUnverifiedEmail(false);
    setResendSuccess(false);
    setLoading(true);

    try {
      const res = await fetch(API.AUTH.LOGIN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.unverified) {
          setUnverifiedEmail(true);
        }
        setError(data.error || "That email and password did not match.");
        setLoading(false);
        return;
      }

      if (data.requires2FA) {
        onRequires2FA(
          data.userId,
          data.twoFactorMethod || "app",
          data.maskedEmail,
        );
        setLoading(false);
        return;
      }

      refreshAuthCache();
      router.push(redirectTo);
      router.refresh();
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
          className={authFieldClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className={cn(
              "text-xs text-muted-foreground hover:text-primary rounded",
              transitions.colors,
              authFocusRing,
            )}
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
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
      </div>

      {error && (
        <AuthAlert
          action={
            unverifiedEmail && !resendSuccess ? (
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resendingVerification}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded text-sm font-medium text-foreground",
                  "hover:text-primary disabled:opacity-60",
                  transitions.colors,
                  authFocusRing,
                )}
              >
                {resendingVerification ? (
                  <>
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                    Sending
                  </>
                ) : (
                  <>
                    <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                    Send the verification email again
                  </>
                )}
              </button>
            ) : null
          }
        >
          {error}
        </AuthAlert>
      )}

      {resendSuccess && (
        <AuthAlert tone="info">
          Verification email sent. Open the link in it, then sign in.
        </AuthAlert>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={loading}
        className={cn("h-11 w-full mt-1", authFocusRing)}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Signing in
          </>
        ) : (
          "Sign in"
        )}
      </Button>

      <OAuthButtons actionLabel="Sign in" />

      <p className="text-sm text-muted-foreground mt-2">
        No account yet?{" "}
        <Link
          href="/signup"
          className={cn(
            "text-primary font-medium rounded hover:underline underline-offset-4",
            authFocusRing,
          )}
        >
          Create one
        </Link>
      </p>

      <Link
        href="/"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground w-fit",
          transitions.colors,
          authFocusRing,
        )}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to landing
      </Link>
    </form>
  );
}
