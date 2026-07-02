"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API } from "@/lib/config/client-constants";

interface VerifyEmailExpiredProps {
  message: string;
}

export function VerifyEmailExpired({ message }: VerifyEmailExpiredProps) {
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleResend() {
    if (!resendEmail) return;
    setResending(true);
    setResendSuccess(false);
    setError("");

    try {
      const res = await fetch(API.AUTH.RESEND_VERIFICATION, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail }),
      });

      const data = await res.json();
      if (res.ok) {
        setResendSuccess(true);
      } else {
        setError(data.error || "Failed to resend verification email.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setResending(false);
    }
  }

  if (resendSuccess) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-emerald-500">
            Email sent.
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Check your inbox for the new verification link.
          </p>
        </div>
        <Button asChild variant="outline" className="w-full border-border/50">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Link expired.</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{message}</p>
      </div>

      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Enter your email to get a new link:
        </p>
        <Input
          type="email"
          value={resendEmail}
          onChange={(e) => setResendEmail(e.target.value)}
          placeholder="name@example.com"
          className="border-border/50"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          onClick={handleResend}
          disabled={resending || !resendEmail}
          className="w-full"
        >
          {resending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            "Resend verification email"
          )}
        </Button>
      </div>

      <Button asChild variant="ghost" className="w-full">
        <Link href="/login">Back to sign in</Link>
      </Button>
    </div>
  );
}
