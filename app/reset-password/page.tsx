"use client"

import { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { ThemedLogo } from "@/components/shared/themed-logo"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { APP_NAME } from "@/lib/config/constants"
import {
  ResetPasswordForm,
  ResetPasswordSuccess,
  ResetPasswordInvalid,
} from "@/components/auth"

function ResetContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const [success, setSuccess] = useState(false)

  const isInvalid = !token

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="flex items-center justify-center gap-2.5 mb-8">
        <ThemedLogo width={28} height={28} className="h-7 w-7" alt={`${APP_NAME} logo`} />
        <span className="text-xl font-semibold tracking-tight">{APP_NAME}</span>
      </div>

      <Card className="border-border/50 bg-card/95">
        <CardHeader className="text-center pb-2 pt-7 px-6">
          {!isInvalid && !success && (
            <>
              <CardTitle className="text-xl font-semibold tracking-tight">Set New Password</CardTitle>
              <CardDescription className="mt-1.5">
                Choose a strong, unique password for your account.
              </CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent className="pb-7 px-6">
          {isInvalid && <ResetPasswordInvalid />}
          {!isInvalid && success && <ResetPasswordSuccess />}
          {!isInvalid && !success && (
            <ResetPasswordForm token={token!} onSuccess={() => setSuccess(true)} />
          )}
        </CardContent>
      </Card>

      {!isInvalid && !success && (
        <p className="text-center text-xs text-muted-foreground mt-6">
          Need help?{" "}
          <Link href="/contact" className="text-primary hover:underline transition-colors">
            Contact support
          </Link>
        </p>
      )}
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8 relative overflow-hidden">
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10">
        <Suspense fallback={null}>
          <ResetContent />
        </Suspense>
      </div>
    </div>
  )
}
