"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2 } from "lucide-react";
import { API } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { transitions } from "@/lib/ui/animations";
import {
  AuthAlert,
  authFieldClass,
  authFocusRing,
} from "@/components/auth/auth-shell";

interface ForgotPasswordFormProps {
  onSuccess: (email: string) => void;
}

export function ForgotPasswordForm({ onSuccess }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const normalized = email.trim().toLowerCase();
    try {
      const res = await fetch(API.AUTH.FORGOT_PASSWORD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalized }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Without a fallback an empty body left the form silent and looking
        // broken.
        setError(
          data.error ||
            "That request was refused. Wait a minute and send it again.",
        );
        return;
      }
      onSuccess(normalized);
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
        <Label htmlFor="email">Email on the account</Label>
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
          autoFocus
          className={authFieldClass}
        />
      </div>

      {error && <AuthAlert>{error}</AuthAlert>}

      <Button
        type="submit"
        size="lg"
        disabled={loading || !email.trim()}
        className={cn("h-11 w-full mt-1", authFocusRing)}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Sending the link
          </>
        ) : (
          "Send reset link"
        )}
      </Button>

      <Link
        href="/login"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground w-fit mt-1",
          transitions.colors,
          authFocusRing,
        )}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to sign in
      </Link>
    </form>
  );
}
