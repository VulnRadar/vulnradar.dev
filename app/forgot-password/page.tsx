"use client";

import { useState } from "react";
import Link from "next/link";
import { ThemedLogo } from "@/components/shared/themed-logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { APP_NAME } from "@/lib/config/constants";
import { transitions } from "@/lib/ui/animations";
import { ForgotPasswordForm, ForgotPasswordSuccess } from "@/components/auth";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* Background glow orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm relative z-10 animate-fade-in">
        {/* Logo */}
        <Link
          href="/"
          className={`flex items-center justify-center gap-2.5 mb-8 group ${transitions.default}`}
        >
          <ThemedLogo
            width={28}
            height={28}
            className="h-7 w-7 transition-transform group-hover:scale-105"
            alt={`${APP_NAME} logo`}
          />
          <span className="text-xl font-semibold text-foreground tracking-tight">
            {APP_NAME}
          </span>
        </Link>

        <Card className="border-border/50 bg-card/95 backdrop-blur-sm shadow-xl">
          <CardHeader className="text-center space-y-2 pb-4 pt-8">
            {sent ? (
              <>
                <div className="flex justify-center mb-2">
                  <div className="p-3 bg-emerald-500/10 rounded-full">
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                  </div>
                </div>
                <CardTitle className="text-xl font-semibold tracking-tight">
                  Check your email
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  {
                    "If an account with that email exists, we've sent a password reset link. The link expires in 1 hour."
                  }
                </CardDescription>
              </>
            ) : (
              <>
                <CardTitle className="text-xl font-semibold tracking-tight">
                  Reset your password
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  {"Enter your email and we'll send you a reset link."}
                </CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent className="pb-8">
            {sent ? (
              <ForgotPasswordSuccess />
            ) : (
              <ForgotPasswordForm onSuccess={() => setSent(true)} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
