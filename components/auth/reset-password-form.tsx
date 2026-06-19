"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Eye, EyeOff, Loader2 } from "lucide-react";
import { API } from "@/lib/config/client-constants";
import { getPasswordStrength } from "@/lib/auth/password-strength";

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

  const strength = getPasswordStrength(password);

  const strengthBars = [
    { level: 0, color: "bg-red-500" },
    { level: 1, color: "bg-orange-500" },
    { level: 2, color: "bg-amber-500" },
    { level: 3, color: "bg-lime-500" },
    { level: 4, color: "bg-emerald-500" },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
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
        setError(data.error || "Something went wrong.");
        return;
      }
      onSuccess();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* New Password */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password" className="text-sm font-medium">
          New Password
        </Label>
        <div className="relative">
          <Input
            id="password"
            type={showPass ? "text" : "password"}
            placeholder="Minimum 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="h-10 border-border/40 pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={showPass ? "Hide password" : "Show password"}
          >
            {showPass ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Strength meter */}
        {password && (
          <div className="space-y-1.5 mt-0.5">
            <div className="flex gap-1 h-1">
              {strengthBars.map((bar, idx) => (
                <div
                  key={idx}
                  className={`h-full flex-1 rounded-full transition-colors duration-200 ${
                    strength.level >= bar.level ? bar.color : "bg-muted"
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-right">
              Strength:{" "}
              <span className="font-medium text-foreground">
                {strength.label}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* Confirm Password */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm" className="text-sm font-medium">
          Confirm Password
        </Label>
        <Input
          id="confirm"
          type={showPass ? "text" : "password"}
          placeholder="Re-enter your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="h-10 border-border/40"
        />
        {confirm && password && confirm !== password && (
          <p className="text-xs text-destructive mt-0.5">
            Passwords do not match.
          </p>
        )}
      </div>

      {/* Error */}
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

      <Button
        type="submit"
        disabled={loading || !password || !confirm || password !== confirm}
        className="h-10 w-full mt-2"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Resetting...
          </>
        ) : (
          "Reset Password"
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Remember your password?{" "}
        <Link
          href="/login"
          className="text-primary hover:underline font-medium transition-colors"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
