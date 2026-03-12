"use client"

import React, { Suspense } from "react"
import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Loader2, Eye, EyeOff, Mail } from "lucide-react"
import { ThemedLogo } from "@/components/themed-logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { APP_NAME } from "@/lib/constants"
import { API } from "@/lib/client-constants"

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect") || "/dashboard"
  const discordError = searchParams.get("error")
  const discord2FA = searchParams.get("discord_2fa")
  const discord2FAMethod = searchParams.get("method")
  
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(() => {
    // Map Discord error codes to user-friendly messages
    if (discordError === "discord_not_linked") {
      return "This Discord account is not linked to any account. Please sign up first, then connect your Discord in Profile settings."
    }
    if (discordError === "discord_denied") {
      return "Discord authorization was cancelled."
    }
    if (discordError === "discord_expired") {
      return "Discord login session expired. Please try again."
    }
    if (discordError === "discord_failed") {
      return "Discord login failed. Please try again."
    }
    return ""
  })
  const [loading, setLoading] = useState(false)
  const [unverifiedEmail, setUnverifiedEmail] = useState(false)
  const [resendingVerification, setResendingVerification] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)

  // 2FA state - initialize from Discord callback if pending
  const [needs2FA, setNeeds2FA] = useState(discord2FA === "pending")
  const [twoFactorMethod, setTwoFactorMethod] = useState<string | null>(discord2FAMethod || null)
  const [pendingUserId, setPendingUserId] = useState<number | null>(null)
  const [isDiscord2FA, setIsDiscord2FA] = useState(discord2FA === "pending")
  const [totpCode, setTotpCode] = useState("")
  const [verifying2FA, setVerifying2FA] = useState(false)
  const [useBackupCode, setUseBackupCode] = useState(false)
  const [backupCodeInput, setBackupCodeInput] = useState("")
  const [rememberDevice, setRememberDevice] = useState(false)
  const [emailCodeSent, setEmailCodeSent] = useState(discord2FA === "pending" && discord2FAMethod === "email")
  const [resendingCode, setResendingCode] = useState(false)
  const [maskedEmail, setMaskedEmail] = useState("")

  async function handleResendVerification() {
    setResendingVerification(true)
    setResendSuccess(false)
    try {
      const res = await fetch(API.AUTH.RESEND_VERIFICATION, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setResendSuccess(true)
        setError("") // Clear the error when resend succeeds
      } else if (!res.ok) {
        setError(data.error || "Failed to send verification email.")
      }
    } catch {
      setError("Failed to send verification email. Please try again.")
    } finally {
      setResendingVerification(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setUnverifiedEmail(false)
    setResendSuccess(false)
    setLoading(true)

    try {
      const res = await fetch(API.AUTH.LOGIN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.unverified) {
          setUnverifiedEmail(true)
        }
        setError(data.error || "Login failed.")
        setLoading(false)
        return
      }

      // Check if 2FA is required
      if (data.requires2FA) {
        setNeeds2FA(true)
        setPendingUserId(data.userId)
        setTwoFactorMethod(data.twoFactorMethod || "app")
        // Email code is sent server-side by the login route
        if (data.twoFactorMethod === "email") {
          setEmailCodeSent(true)
          if (data.maskedEmail) setMaskedEmail(data.maskedEmail)
        }
        setLoading(false)
        return
      }

      router.push(redirectTo)
      router.refresh()
    } catch {
      setError("Something went wrong. Please try again.")
      setLoading(false)
    }
  }

  async function handle2FAVerify(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setVerifying2FA(true)

    try {
      // For Discord 2FA, we pass userId: 0 and the server reads from the cookie
      const effectiveUserId = isDiscord2FA ? 0 : pendingUserId
      const body = useBackupCode
        ? { userId: effectiveUserId, backupCode: backupCodeInput, rememberDevice }
        : { userId: effectiveUserId, code: totpCode, rememberDevice }
      const res = await fetch(API.AUTH.TWO_FA.VERIFY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Verification failed.")
        setVerifying2FA(false)
        return
      }

      router.push(redirectTo)
      router.refresh()
    } catch {
      setError("Something went wrong. Please try again.")
      setVerifying2FA(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
            <ThemedLogo width={28} height={28} className="h-7 w-7" alt={`${APP_NAME} logo`} />
          <span className="text-xl font-semibold text-foreground tracking-tight">{APP_NAME}</span>
        </div>
        
        <Card className="bg-card border-border">
          <CardHeader className="text-center pb-6 pt-8 px-6">
            <CardTitle className="text-xl font-semibold tracking-tight">
              {needs2FA
                ? useBackupCode ? "Use a Backup Code"
                : twoFactorMethod === "email" ? "Check Your Email"
                : "Two-Factor Authentication"
                : "Welcome back"}
            </CardTitle>
            <CardDescription className="mt-2">
              {needs2FA
                ? useBackupCode
                  ? "Enter one of your 8-character backup codes"
                  : twoFactorMethod === "email"
                    ? `We sent a 6-digit code to ${maskedEmail || "your email address"}`
                    : "Enter the 6-digit code from your authenticator app"
                : `Sign in to your ${APP_NAME} account`}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-8 px-6">
        {/* 2FA verification form */}
        {needs2FA ? (
          <form onSubmit={handle2FAVerify} className="flex flex-col gap-4">
            {useBackupCode ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="backup-code" className="text-sm">
                  Backup Code
                </Label>
                <Input
                  id="backup-code"
                  type="text"
                  placeholder="XXXX-XXXX"
                  maxLength={9}
                  value={backupCodeInput}
                  onChange={(e) => setBackupCodeInput(e.target.value.toUpperCase())}
                  required
                  autoFocus
                  autoComplete="off"
                  className="h-11 bg-card text-center text-lg tracking-widest font-mono"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="totp-code" className="text-sm">
                  Verification Code
                </Label>
                <Input
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={totpCode}
                  onChange={(e) =>
                    setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  className="h-11 bg-card text-center text-lg tracking-[0.3em] font-mono"
                />
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="remember-device"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="h-4 w-4 rounded border-border bg-card cursor-pointer"
              />
              <label htmlFor="remember-device" className="text-sm text-muted-foreground cursor-pointer">
                Trust this device for 30 days
              </label>
            </div>

            <Button
              type="submit"
              disabled={verifying2FA || (useBackupCode ? backupCodeInput.length < 8 : totpCode.length !== 6)}
              className="h-11 w-full mt-2"
            >
              {verifying2FA ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify & Sign in"
              )}
            </Button>

            <div className="flex flex-col items-center gap-2">
              {twoFactorMethod === "email" ? (
                <button
                  type="button"
                  disabled={resendingCode}
                  onClick={async () => {
                    setResendingCode(true)
                    setError("")
                    try {
                      const res = await fetch("/api/v2/auth/2fa/email-send", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                      })
                      const data = await res.json()
                      if (res.ok) {
                        setEmailCodeSent(true)
                        setTotpCode("")
                        if (data.maskedEmail) setMaskedEmail(data.maskedEmail)
                      } else {
                        setError(data.error || "Failed to resend code.")
                      }
                    } catch {
                      setError("Failed to resend code.")
                    } finally {
                      setResendingCode(false)
                    }
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {resendingCode ? "Sending..." : "Resend code"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setUseBackupCode(!useBackupCode)
                    setBackupCodeInput("")
                    setTotpCode("")
                    setRememberDevice(false)
                    setError("")
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {useBackupCode ? "Use Authenticator App" : "Use Backup Code"}
                </button>
              )}
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-10"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
                {unverifiedEmail && !resendSuccess && (
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendingVerification}
                    className="mt-2 text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    {resendingVerification ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Mail className="h-3 w-3" />
                        Resend verification email
                      </>
                    )}
                  </button>
                )}
                {resendSuccess && (
                  <p className="mt-2 text-sm text-green-500">
                    Verification email sent! Check your inbox.
                  </p>
                )}
              </div>
            )}

            <Button type="submit" disabled={loading} className="h-10 w-full mt-2">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>

            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-10 w-full"
              onClick={() => window.location.href = "/api/v2/auth/discord?action=login"}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
              Sign in with Discord
            </Button>

            <p className="text-center text-sm text-muted-foreground mt-2">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-primary hover:underline font-medium">
                Sign up
              </Link>
            </p>
          </form>
        )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
