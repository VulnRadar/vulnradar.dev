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
import { SignupForm } from "@/components/auth/signup-form";
import { SignupSuccess } from "@/components/auth/signup-success";
import { APP_NAME } from "@/lib/config/constants";
import { transitions } from "@/lib/ui/animations";

export default function SignupPage() {
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8 relative overflow-hidden">
      {/* Background glow orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
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

        <Card className="bg-card/95 backdrop-blur-sm border-border/50 shadow-xl">
          {!successEmail ? (
            <>
              <CardHeader className="text-center pb-5 pt-7 px-6">
                <CardTitle className="text-xl font-semibold tracking-tight">
                  Create an account
                </CardTitle>
                <CardDescription className="mt-1.5">
                  Enter your details below to get started.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-7">
                <SignupForm onSuccess={(email) => setSuccessEmail(email)} />
              </CardContent>
            </>
          ) : (
            <CardContent className="px-6 py-8">
              <SignupSuccess email={successEmail} />
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
