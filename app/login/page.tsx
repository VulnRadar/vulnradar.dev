"use client"

import React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Loader2, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // 2FA state
  const [needs2FA, setNeeds2FA] = useState(false)
  const [pendingUserId, setPendingUserId] = useState<number | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const [verifying2FA, setVerifying2FA] = useState(false)
  const [useBackupCode, setUseBackupCode] = useState(false)
  const [backupCodeInput, setBackupCodeInput] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
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

      router.push("/")
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
        ? { userId: pendingUserId, backupCode: backupCodeInput }
        : { userId: pendingUserId, code: totpCode }
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

      router.push("/")
      router.refresh()
    } catch {
      setError("Something went wrong. Please try again.")
      setVerifying2FA(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm flex flex-col gap-8">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-0">
          <Image
            src="/favicon.svg"
            alt="VulnRadar logo"
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="text-2xl font-bold text-foreground font-mono tracking-tight">VulnRadar</span>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {needs2FA
                ? useBackupCode ? "Use a Backup Code" : "Two-Factor Authentication"
                : "Welcome back"}
            </h1>
            <p className="text-sm text-muted-foreground text-center">
              {needs2FA
                ? useBackupCode
                  ? "Enter one of your 8-character backup codes"
                  : "Enter the 6-digit code from your authenticator app"
                : "Sign in to your VulnRadar account"}
            </p>
          </div>
        </div>

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
                  setError("")
                  setTotpCode("")
                  setBackupCodeInput("")
                }}
                className="text-sm text-primary hover:underline text-center transition-colors"
              >
                {useBackupCode ? "Use authenticator code instead" : "Use a backup code instead"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNeeds2FA(false)
                  setPendingUserId(null)
                  setTotpCode("")
                  setBackupCodeInput("")
                  setUseBackupCode(false)
                  setError("")
                }}
                className="text-sm text-muted-foreground hover:text-foreground text-center transition-colors"
              >
                Back to login
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Regular login form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-sm">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="h-11 bg-card"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-sm">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="h-11 bg-card pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
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
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="h-11 w-full mt-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            {/* Footer */}
            <div className="flex flex-col items-center gap-2">
              <Link href="/forgot-password" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                Forgot your password?
              </Link>
              <p className="text-sm text-muted-foreground">
                {"Don't have an account? "}
                <Link
                  href="/signup"
                  className="text-primary hover:underline font-medium"
                >
                  Sign up
                </Link>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
