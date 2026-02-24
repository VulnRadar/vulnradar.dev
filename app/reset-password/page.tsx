"use client"

import React, { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle2, AlertTriangle, Eye, EyeOff, Loader2 } from "lucide-react"
import { APP_NAME } from "@/lib/constants"
import { getPasswordStrength } from "@/lib/password-strength"

function ResetForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")

  const strength = getPasswordStrength(password)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (password !== confirm) { setError("Passwords do not match."); return }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return }
    setLoading(true)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setSuccess(true)
    } catch {
      setError("Something went wrong.")
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <Card className="w-full max-w-sm bg-card border-border">
        <CardHeader className="text-center space-y-2 pb-6 pt-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Image src="/favicon.svg" alt={`${APP_NAME} logo`} width={32} height={32} className="h-8 w-8" />
            <span className="text-2xl font-bold text-foreground font-mono tracking-tight">{APP_NAME}</span>
          </div>
          <div className="flex justify-center mb-2">
            <div className="p-3 bg-amber-500/10 rounded-full">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
            </div>
          </div>
          <CardTitle className="text-xl font-bold tracking-tight">Invalid Reset Link</CardTitle>
          <CardDescription>This link is invalid or missing a token. Please request a new reset link.</CardDescription>
        </CardHeader>
        <CardContent className="pb-8 flex flex-col items-center">
          <Button asChild variant="outline" size="sm" className="bg-transparent">
            <Link href="/forgot-password">Request New Link</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (success) {
    return (
      <Card className="w-full max-w-sm bg-card border-border">
        <CardHeader className="text-center space-y-2 pb-6 pt-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Image src="/favicon.svg" alt={`${APP_NAME} logo`} width={32} height={32} className="h-8 w-8" />
            <span className="text-2xl font-bold text-foreground font-mono tracking-tight">{APP_NAME}</span>
          </div>
          <div className="flex justify-center mb-2">
            <div className="p-3 bg-emerald-500/10 rounded-full">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
          </div>
          <CardTitle className="text-xl font-bold tracking-tight">Password Reset Complete</CardTitle>
          <CardDescription>Your password has been changed. All existing sessions have been logged out.</CardDescription>
        </CardHeader>
        <CardContent className="pb-8 flex flex-col items-center">
          <Button asChild size="sm">
            <Link href="/login">Go to Login</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-sm bg-card border-border">
      <CardHeader className="text-center space-y-2 pb-6 pt-8">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Image src="/favicon.svg" alt={`${APP_NAME} logo`} width={32} height={32} className="h-8 w-8" />
          <span className="text-2xl font-bold text-foreground font-mono tracking-tight">{APP_NAME}</span>
        </div>
        <CardTitle className="text-xl font-bold tracking-tight">Set New Password</CardTitle>
        <CardDescription>Choose a strong, unique password for your account.</CardDescription>
      </CardHeader>
      <CardContent className="pb-8">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">New Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPass ? "text" : "password"}
                placeholder="Minimum 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="h-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {/* Password strength indicator - matching signup page */}
            {password && (
              <div className="space-y-1.5 mt-1">
                <div className="flex gap-1 h-1">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <div
                      key={level}
                      className={`h-full flex-1 rounded-full transition-colors duration-200 ${
                        strength.level >= level ? strength.color : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground text-right">
                  Strength: <span className="font-medium text-foreground">{strength.label}</span>
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm">Confirm Password</Label>
            <Input
              id="confirm"
              type={showPass ? "text" : "password"}
              placeholder="Re-enter your password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="h-10"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
              <p className="text-sm text-destructive flex items-center gap-2" role="alert">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </p>
            </div>
          )}

          <Button type="submit" disabled={loading || !password || !confirm} className="h-10 w-full mt-2">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Resetting...
              </>
            ) : (
              "Reset Password"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </div>
  )
}
