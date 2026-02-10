"use client"

import React from "react"

import { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Lock, CheckCircle2, AlertTriangle, Eye, EyeOff } from "lucide-react"

function ResetForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")

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
      <Card className="bg-card border-border">
        <CardContent className="py-12 flex flex-col items-center gap-3">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium text-foreground">Invalid Reset Link</p>
          <p className="text-xs text-muted-foreground text-center">This link is invalid or missing a token. Please request a new reset link.</p>
          <Link href="/forgot-password"><Button variant="outline" size="sm" className="bg-transparent mt-2">Request New Link</Button></Link>
        </CardContent>
      </Card>
    )
  }

  if (success) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-12 flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          </div>
          <p className="text-sm font-medium text-foreground">Password Reset Complete</p>
          <p className="text-xs text-muted-foreground text-center">Your password has been changed. All existing sessions have been logged out.</p>
          <Link href="/login"><Button size="sm" className="mt-2">Go to Login</Button></Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-xl font-bold">Set New Password</CardTitle>
        <CardDescription>Choose a strong, unique password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-foreground">New Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="password"
                type={showPass ? "text" : "password"}
                placeholder="Minimum 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="pl-10 pr-10"
              />
              <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm" className="text-sm font-medium text-foreground">Confirm Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="confirm"
                type={showPass ? "text" : "password"}
                placeholder="Re-enter your password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="pl-10"
              />
            </div>
          </div>

          {/* Password strength hints */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { test: password.length >= 8, label: "8+ chars" },
              { test: /[A-Z]/.test(password), label: "Uppercase" },
              { test: /[0-9]/.test(password), label: "Number" },
              { test: /[^A-Za-z0-9]/.test(password), label: "Special char" },
            ].map((rule) => (
              <span key={rule.label} className={`text-[10px] px-2 py-0.5 rounded-full border ${rule.test ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-muted text-muted-foreground border-border"}`}>
                {rule.label}
              </span>
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading || !password || !confirm} className="w-full">
            {loading ? "Resetting..." : "Reset Password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Image
            src="/favicon.svg"
            alt="VulnRadar logo"
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="text-2xl font-bold text-foreground font-mono tracking-tight">VulnRadar</span>
        </div>
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  )
}
