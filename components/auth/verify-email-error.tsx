"use client";

import { XCircle } from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { APP_NAME } from "@/lib/config/constants";

interface VerifyEmailErrorProps {
  message: string;
}

export function VerifyEmailError({ message }: VerifyEmailErrorProps) {
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
            Verification Failed
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            We couldn&apos;t verify your email
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-8">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 rounded-2xl bg-destructive/10">
              <XCircle className="h-8 w-8 text-destructive" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {message}
            </p>
            <Button
              asChild
              variant="outline"
              className="w-full mt-2 border-border/40"
            >
              <Link href="/login">Back to Login</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
