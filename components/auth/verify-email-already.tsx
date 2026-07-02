"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

interface VerifyEmailAlreadyProps {
  message: string;
}

export function VerifyEmailAlready({ message }: VerifyEmailAlreadyProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Already verified.
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">{message}</p>
      </div>
      <Button asChild className="w-full">
        <Link href="/login">Sign in</Link>
      </Button>
    </div>
  );
}
