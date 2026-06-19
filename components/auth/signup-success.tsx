"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/config/constants";
import { API } from "@/lib/config/client-constants";

interface SignupSuccessProps {
  email: string;
}

export function SignupSuccess({ email }: SignupSuccessProps) {
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMessage, setResendMessage] = useState("");

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function handleResend() {
    if (resending || resendCooldown > 0) return;
    setResending(true);
    setResendMessage("");
    try {
      const res = await fetch(API.AUTH.RESEND_VERIFICATION, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setResendMessage("Verification email sent! Check your inbox.");
        setResendCooldown(60);
      } else {
        setResendMessage(data.error || "Failed to resend. Try again.");
      }
    } catch {
      setResendMessage("Something went wrong. Please try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex flex-col items-center text-center gap-5">
      <div className="p-4 rounded-full bg-primary/10 border border-primary/20">
        <Mail className="h-8 w-8 text-primary" />
      </div>

      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="text-sm text-muted-foreground">
          We sent a verification link to{" "}
          <span className="font-medium text-foreground">{email}</span>
        </p>
      </div>

      <div className="w-full flex items-start gap-3 p-3.5 bg-muted/40 rounded-lg border border-border/40 text-left">
        <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <p className="text-sm text-muted-foreground leading-relaxed">
          Click the link in your email to verify your account and start using{" "}
          {APP_NAME}.
        </p>
      </div>

      <div className="w-full space-y-2">
        <p className="text-xs text-muted-foreground">
          {"Didn't receive it? Check your spam folder or"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleResend}
          disabled={resending || resendCooldown > 0}
          className="text-primary hover:text-primary/80 h-auto py-1 px-2"
        >
          {resending ? (
            <>
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              Sending...
            </>
          ) : resendCooldown > 0 ? (
            `Resend in ${resendCooldown}s`
          ) : (
            "Resend verification email"
          )}
        </Button>
        {resendMessage && (
          <p
            className={`text-xs ${resendMessage.includes("sent") ? "text-emerald-500" : "text-destructive"}`}
          >
            {resendMessage}
          </p>
        )}
      </div>

      <Button asChild variant="outline" className="w-full border-border/40">
        <Link href="/login">Back to Sign In</Link>
      </Button>
    </div>
  );
}
