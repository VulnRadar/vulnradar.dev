"use client";

import { Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { APP_NAME } from "@/lib/config/constants";

export function VerifyEmailLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm border-border/50 bg-card/95">
        <CardHeader className="text-center space-y-2 pb-6 pt-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <ThemedLogo
              width={32}
              height={32}
              className="h-8 w-8"
              alt={`${APP_NAME} logo`}
            />
            <span className="text-2xl font-bold text-foreground font-mono tracking-tight">
              {APP_NAME}
            </span>
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight">
            Email Verification
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            Verifying your email address...
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-8">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 rounded-2xl bg-primary/10">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
            </div>
            <p className="text-sm text-muted-foreground">
              Please wait while we verify your email
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
