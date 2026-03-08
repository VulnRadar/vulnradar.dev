"use client"

import React, { useEffect, useState, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Loader2, CheckCircle2, XCircle, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { APP_NAME } from "@/lib/constants"
import { API } from "@/lib/client-constants"

export default function VerifyEmailClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const verificationAttempted = useRef(false)

  const [status, setStatus] = useState<"loading" | "success" | "error" | "expired" | "already-verified">("loading")
  const [message, setMessage] = useState("")
  const [resending, setResending] = useState(false)
  const [resendEmail, setResendEmail] = useState("")
  const [resendSuccess, setResendSuccess] = useState(false)

  useEffect(() => {
    if (!token) {
      setStatus("error")
      setMessage("No verification token provided.")
      return
    }

    // Prevent double-execution in React strict mode
    if (verificationAttempted.current) return
    verificationAttempted.current = true

    async function verify() {
      try {
        const res = await fetch(API.AUTH.VERIFY_EMAIL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })

        const data = await res.json()

        if (data.alreadyVerified) {
          setStatus("already-verified")
          setMessage(data.message)
          return
        }

        if (data.expired) {
          setStatus("expired")
          setMessage(data.error)
          return
        }

        if (!res.ok) {
          setStatus("error")
          setMessage(data.error || "Verification failed.")
          return
        }

        setStatus("success")
        setMessage(data.message)

        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
          router.push("/dashboard")
          router.refresh()
        }, 2000)
      } catch {
        setStatus("error")
        setMessage("Something went wrong. Please try again.")
      }
    }

    verify()
  }, [token, router])

  async function handleResend() {
    if (!resendEmail) return
    setResending(true)
    setResendSuccess(false)

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
        setMessage(data.error || "Failed to resend verification email.")
      }
    } catch {
      setMessage("Something went wrong. Please try again.")
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm bg-card border-border">
        <CardHeader className="text-center space-y-2 pb-6 pt-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Image
              src="/favicon.svg"
              alt={`${APP_NAME} logo`}
              width={32}
              height={32}
              className="h-8 w-8"
            />
            <span className="text-2xl font-bold text-foreground font-mono tracking-tight">{APP_NAME}</span>
          </div>
          <CardTitle className="text-xl font-bold tracking-tight">
            Email Verification
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            {status === "loading" && "Verifying your email address..."}
            {status === "success" && "Your email has been verified!"}
            {status === "error" && "Verification failed"}
            {status === "expired" && "Link expired"}
            {status === "already-verified" && "Already verified"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pb-8">
          <div className="flex flex-col items-center space-y-4">
            {status === "loading" && (
              <div className="p-3 bg-primary/10 rounded-full">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
              </div>
            )}

            {status === "success" && (
              <>
                <div className="p-3 bg-emerald-500/10 rounded-full">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                </div>
                <p className="text-center text-sm text-muted-foreground">{message}</p>
                <p className="text-center text-xs text-muted-foreground">Redirecting to dashboard...</p>
              </>
            )}

            {status === "already-verified" && (
              <>
                <div className="p-3 bg-primary/10 rounded-full">
                  <CheckCircle2 className="h-8 w-8 text-primary" />
                </div>
                <p className="text-center text-sm text-muted-foreground">{message}</p>
                <Button asChild className="w-full mt-4">
                  <Link href="/login">Go to Login</Link>
                </Button>
              </>
            )}

            {status === "error" && (
              <>
                <div className="p-3 bg-destructive/10 rounded-full">
                  <XCircle className="h-8 w-8 text-destructive" />
                </div>
                <p className="text-center text-sm text-muted-foreground">{message}</p>
                <Button asChild variant="outline" className="w-full mt-4">
                  <Link href="/login">Back to Login</Link>
                </Button>
              </>
            )}

            {status === "expired" && (
              <>
                <div className="p-3 bg-amber-500/10 rounded-full">
                  <Mail className="h-8 w-8 text-amber-500" />
                </div>
                <p className="text-center text-sm text-muted-foreground">{message}</p>

                {!resendSuccess ? (
                  <div className="w-full space-y-3 mt-4">
                    <p className="text-center text-xs text-muted-foreground">
                      Enter your email to receive a new verification link:
                    </p>
                    <input
                      type="email"
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
                    />
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
                  <div className="text-center space-y-2">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
                    <p className="text-sm text-emerald-500">Verification email sent!</p>
                    <p className="text-xs text-muted-foreground">Check your inbox for the new link.</p>
                  </div>
                )}

                <Button asChild variant="outline" className="w-full mt-2">
                  <Link href="/login">Back to Login</Link>
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

