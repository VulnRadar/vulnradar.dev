"use client"

import React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Loader2, Eye, EyeOff, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { APP_NAME } from "@/lib/constants"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [unverifiedEmail, setUnverifiedEmail] = useState(false)
  const [resendingVerification, setResendingVerification] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)

  // 2FA state
  const [needs2FA, setNeeds2FA] = useState(false)
  const [pendingUserId, setPendingUserId] = useState<number | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const [verifying2FA, setVerifying2FA] = useState(false)
  const [useBackupCode, setUseBackupCode] = useState(false)
  const [backupCodeInput, setBackupCodeInput] = useState("")
  const [rememberDevice, setRememberDevice] = useState(false)

  async function handleResendVerification() {
    setResendingVerification(true)
    setResendSuccess(false)
    try {
      const res = await fetch("/api/auth/resend-verification", {
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
      const res = await fetch("/api/auth/login", {
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
        setLoading(false)
        return
      }

      router.push("/dashboard")
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
      const body = useBackupCode
        ? { userId: pendingUserId, backupCode: backupCodeInput, rememberDevice }
        : { userId: pendingUserId, code: totpCode, rememberDevice }
      const res = await fetch("/api/auth/2fa/verify", {
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

      router.push("/dashboard")
      router.refresh()
    } catch {
      setError("Something went wrong. Please try again.")
      setVerifying2FA(false)
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
            {needs2FA
              ? useBackupCode ? "Use a Backup Code" : "Two-Factor Authentication"
              : "Welcome back"}
          </CardTitle>
          <CardDescription>
            {needs2FA
              ? useBackupCode
                ? "Enter one of your 8-character backup codes"
                : "Enter the 6-digit code from your authenticator app"
              : `Sign in to your ${APP_NAME} account`}
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8">
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
  )
}
