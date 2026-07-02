"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ForgotPasswordForm } from "@/components/auth";
import { AuthLayout } from "@/components/auth/auth-layout";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  return (
    <AuthLayout>
      <div style={{ animation: "fade-in 0.2s ease-out both" }}>
        {sent ? (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-emerald-500">
                Reset link sent.
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                If an account with that email exists, we sent a reset link. It
                expires in 1 hour.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Check your spam folder if it doesn&apos;t arrive within a few
              minutes.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mt-2"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-7">
              <h1 className="text-2xl font-semibold tracking-tight">
                Reset your password
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                Enter your email and we&apos;ll send a reset link.
              </p>
            </div>
            <ForgotPasswordForm onSuccess={() => setSent(true)} />
          </>
        )}
      </div>
    </AuthLayout>
  );
}
