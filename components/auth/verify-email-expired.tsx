"use client"

import { useState } from "react"
import { Mail, Loader2, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThemedLogo } from "@/components/shared/themed-logo"
import { APP_NAME } from "@/lib/config/constants"
import { API } from "@/lib/config/client-constants"

interface VerifyEmailExpiredProps {
  message: string
}

export function VerifyEmailExpired({ message }: VerifyEmailExpiredProps) {
  const [resendEmail, setResendEmail] = useState("")
  const [resending, setResending] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)
  const [error, setError] = useState("")

  async function handleResend() {
    if (!resendEmail) return
    setResending(true)
    setResendSuccess(false)
    setError("")

    try {
      const res = await fetch(API.AUTH.RESEND_VERIFICATION, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail }),
      })

      const data = await res.json()

      if (res.ok) {
        setResendSuccess(true)
      } else {
        setError(data.error || "Failed to resend verification email.")
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm border-border/50 bg-card/95">
        <CardHeader className="text-center space-y-2 pb-6 pt-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <ThemedLogo width={32} height={32} className="h-8 w-8" alt={`${APP_NAME} logo`} />
            <span className="text-2xl font-bold text-foreground font-mono tracking-tight">{APP_NAME}</span>
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight">
            Link Expired
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            Your verification link has expired
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-8">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 rounded-2xl bg-amber-500/10">
              <Mail className="h-8 w-8 text-amber-500" />
            </div>
            <p className="text-sm text-muted-foreground text-center">{message}</p>

            {!resendSuccess ? (
              <div className="w-full space-y-3 mt-2">
                <p className="text-center text-xs text-muted-foreground">
                  Enter your email to receive a new verification link:
                </p>
                <Input
                  type="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="border-border/40 bg-background/50"
                />
                {error && <p className="text-xs text-destructive text-center">{error}</p>}
                <Button
                  onClick={handleResend}
                  disabled={resending || !resendEmail}
                  className="w-full"
                >
                  {resending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Resend Verification Email"
                  )}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="p-3 rounded-2xl bg-emerald-500/10">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                </div>
                <p className="text-sm text-emerald-500 font-medium">Verification email sent!</p>
                <p className="text-xs text-muted-foreground">Check your inbox for the new link.</p>
              </div>
            )}

            <Button asChild variant="outline" className="w-full mt-2 border-border/40">
              <Link href="/login">Back to Login</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
