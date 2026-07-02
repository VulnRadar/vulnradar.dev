"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

interface VerifyEmailErrorProps {
  message: string;
}

export function VerifyEmailError({ message }: VerifyEmailErrorProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Verification failed.
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">{message}</p>
      </div>
      <Button asChild variant="outline" className="w-full border-border/50">
        <Link href="/login">Back to sign in</Link>
      </Button>
    </div>
  );
}
