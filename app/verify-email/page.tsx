"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Loader2, CheckCircle2, XCircle, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function VerifyEmailPage() {
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
        const res = await fetch("/api/auth/verify-email", {
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
      const res = await fetch("/api/auth/resend-verification", {
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
          <div className="flex justify-center mb-2">
            <Image
              src="/favicon.svg"
              alt="VulnRadar"
              width={48}
              height={48}
              className="rounded-lg"
            />
          </div>
          <CardTitle className="text-xl font-semibold text-foreground">
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
              <Loader2 className="h-12 w-12 text-primary animate-spin" />
            )}

            {status === "success" && (
              <>
                <CheckCircle2 className="h-12 w-12 text-green-500" />
                <p className="text-center text-sm text-muted-foreground">{message}</p>
                <p className="text-center text-xs text-muted-foreground">Redirecting to dashboard...</p>
              </>
            )}

            {status === "already-verified" && (
              <>
                <CheckCircle2 className="h-12 w-12 text-blue-500" />
                <p className="text-center text-sm text-muted-foreground">{message}</p>
                <Button asChild className="w-full mt-4">
                  <Link href="/login">Go to Login</Link>
                </Button>
              </>
            )}

            {status === "error" && (
              <>
                <XCircle className="h-12 w-12 text-red-500" />
                <p className="text-center text-sm text-muted-foreground">{message}</p>
                <Button asChild variant="outline" className="w-full mt-4">
                  <Link href="/login">Back to Login</Link>
                </Button>
              </>
            )}

            {status === "expired" && (
              <>
                <Mail className="h-12 w-12 text-yellow-500" />
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
                    <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
                    <p className="text-sm text-green-500">Verification email sent!</p>
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

