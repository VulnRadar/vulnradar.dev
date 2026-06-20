"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, Mail, AlertTriangle } from "lucide-react";
import { API } from "@/lib/config/client-constants";
import { transitions } from "@/lib/ui/animations";

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
        setError(data.error || "Failed to send verification email.");
      }
    } catch {
      setError("Failed to send verification email. Please try again.");
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
        setError(data.error || "Login failed.");
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

      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email" className="text-sm font-medium">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="h-10 border-border/40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="text-sm font-medium">
            Password
          </Label>
          <Link
            href="/forgot-password"
            className={`text-xs text-muted-foreground hover:text-primary ${transitions.colors}`}
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-10 pr-10 border-border/40"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
          <p
            className="text-sm text-destructive flex items-center gap-2"
            role="alert"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </p>
          {unverifiedEmail && !resendSuccess && (
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={resendingVerification}
              className="mt-2 text-sm text-primary hover:underline flex items-center gap-1"
            >
              {resendingVerification ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="h-3 w-3" />
                  Resend verification email
                </>
              )}
            </button>
          )}
          {resendSuccess && (
            <p className="mt-2 text-sm text-green-500">
              Verification email sent! Check your inbox.
            </p>
          )}
        </div>
      )}

      <Button type="submit" disabled={loading} className="h-10 w-full mt-2">
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Signing in...
          </>
        ) : (
          "Sign In"
        )}
      </Button>

      <div className="relative my-2">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border/40" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">
            Or continue with
          </span>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        className="h-10 w-full border-border/40"
        onClick={() =>
          (window.location.href = "/api/v2/auth/discord?action=login")
        }
      >
        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
        Sign in with Discord
      </Button>

      <p className="text-center text-sm text-muted-foreground mt-2">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="text-primary hover:underline font-medium"
        >
          Sign up
        </Link>
      </p>
    </form>
  );
}
