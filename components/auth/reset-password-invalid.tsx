"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

export function ResetPasswordInvalid() {
  return (
    <div className="flex flex-col items-center text-center gap-4">
      <div className="p-3 rounded-full bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Invalid Reset Link</h2>
        <p className="text-sm text-muted-foreground">
          This link is invalid or has expired. Please request a new password reset link.
        </p>
      </div>
      <Button asChild variant="outline" className="w-full h-10 mt-2">
        <Link href="/forgot-password">Request New Link</Link>
      </Button>
    </div>
  )
}
