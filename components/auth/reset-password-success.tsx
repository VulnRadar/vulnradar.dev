"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

export function ResetPasswordSuccess() {
  return (
    <div className="flex flex-col items-center text-center gap-4">
      <div className="p-3 rounded-full bg-primary/10">
        <CheckCircle2 className="h-7 w-7 text-primary" />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          Password Reset Complete
        </h2>
        <p className="text-sm text-muted-foreground">
          Your password has been changed successfully. All existing sessions
          have been signed out.
        </p>
      </div>
      <Button asChild className="w-full h-10 mt-2">
        <Link href="/login">Go to Login</Link>
      </Button>
    </div>
  );
}
