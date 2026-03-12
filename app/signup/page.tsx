"use client"

import React from "react"
import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import Script from "next/script"
import { ThemedLogo } from "@/components/themed-logo"
import { Loader2, Eye, EyeOff, Mail, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { APP_NAME, TURNSTILE_ENABLED } from "@/lib/constants"
import { API } from "@/lib/client-constants"
import { getPasswordStrength } from "@/lib/password-strength"

export default function SignupPage() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [signupSuccess, setSignupSuccess] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendMessage, setResendMessage] = useState("")
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const widgetRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!TURNSTILE_ENABLED || !scriptLoaded || !widgetRef.current || widgetIdRef.current) return
    const turnstile = (window as any).turnstile
    if (!turnstile) return
    try {
      widgetIdRef.current = turnstile.render(widgetRef.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: (token: string) => setTurnstileToken(token),
      })
    } catch {}
    return () => {
      if (widgetIdRef.current && turnstile) {
        try { turnstile.remove(widgetIdRef.current); widgetIdRef.current = null } catch {}
      }
    }
  }, [scriptLoaded])

  const strength = getPasswordStrength(password)

  // Cooldown timer for resend button
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCooldown])

  async function handleResendVerification() {
    if (resending || resendCooldown > 0) return
    setResending(true)
    setResendMessage("")
    
    try {
      const res = await fetch(API.AUTH.RESEND_VERIFICATION, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      
      const data = await res.json()
      
      if (res.ok) {
        setResendMessage("Verification email sent! Check your inbox.")
        setResendCooldown(60) // 60 second cooldown
      } else {
        setResendMessage(data.error || "Failed to resend email. Try again.")
      }
    } catch {
      setResendMessage("Something went wrong. Please try again.")
    } finally {
      setResending(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (!name.trim()) {
      setError("Name is required.")
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }

    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError("Please complete the captcha verification.")
      return
    }

    setLoading(true)

    try {
      const res = await fetch(API.AUTH.SIGNUP, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: name.trim(),
          turnstileToken: TURNSTILE_ENABLED ? turnstileToken : null
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Signup failed.")
        setLoading(false)
        return
      }

      // Show success message - user needs to verify email
      setSignupSuccess(true)
      setLoading(false)
    } catch {
      setError("Something went wrong. Please try again.")
      setLoading(false)
    }
  }

  // Show success screen after signup
  if (signupSuccess) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
          <Card className="w-full max-w-sm bg-card border-border">
            <CardHeader className="text-center space-y-2 pb-6 pt-8">
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-primary/10 rounded-full">
                  <Mail className="h-8 w-8 text-primary" />
                </div>
              </div>
              <CardTitle className="text-xl font-bold tracking-tight">Check your email</CardTitle>
              <CardDescription className="text-muted-foreground">
                We&apos;ve sent a verification link to <span className="font-medium text-foreground">{email}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pb-8">
              <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Click the link in your email to verify your account and start using {APP_NAME}.
                </p>
              </div>
              <div className="text-center space-y-2">
                <p className="text-xs text-muted-foreground">
                  Didn&apos;t receive the email? Check your spam folder or
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResendVerification}
                  disabled={resending || resendCooldown > 0}
                  className="text-primary hover:text-primary/80 h-auto p-0"
                >
                  {resending ? (
                    <>
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      Sending...
                    </>
                  ) : resendCooldown > 0 ? (
                    `Resend in ${resendCooldown}s`
                  ) : (
                    "Resend verification email"
                  )}
                </Button>
                {resendMessage && (
                  <p className={`text-xs ${resendMessage.includes("sent") ? "text-green-500" : "text-destructive"}`}>
                    {resendMessage}
                  </p>
                )}
              </div>
              <Button asChild variant="outline" className="w-full mt-4">
                <Link href="/login">Back to Login</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
    )
  }

  return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2.5 mb-8">
            <ThemedLogo width={28} height={28} className="h-7 w-7" alt={`${APP_NAME} logo`} />
            <span className="text-xl font-semibold text-foreground tracking-tight">{APP_NAME}</span>
          </div>

          <Card className="bg-card border-border">
            <CardHeader className="text-center pb-6 pt-8 px-6">
              <CardTitle className="text-xl font-semibold tracking-tight">Create an account</CardTitle>
              <CardDescription className="mt-2">Enter your details below to get started.</CardDescription>
            </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                    id="name"
                    type="text"
                    placeholder="Your Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="h-10"
                />
              </div>

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
                <Label htmlFor="password">Password</Label>
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
                {/* Password strength indicator */}
                {password && (
                    <div className="space-y-1.5 mt-1">
                      <div className="flex gap-1 h-1">
                        {[
                          { level: 0, color: "bg-red-600" },
                          { level: 1, color: "bg-orange-600" },
                          { level: 2, color: "bg-amber-500" },
                          { level: 3, color: "bg-lime-500" },
                          { level: 4, color: "bg-emerald-600" },
                        ].map((bar, idx) => (
                            <div
                                key={idx}
                                className={`h-full flex-1 rounded-full transition-colors duration-200 ${
                                    strength.level >= bar.level ? bar.color : "bg-muted"
                                }`}
                            />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground text-right">
                        Strength: <span className="font-medium text-foreground">{strength.label}</span>
                      </p>
                    </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Must be at least 8 characters.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Input
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="h-10"
                  />
                </div>
              </div>

              {error && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
                    <p className="text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  </div>
              )}

              {TURNSTILE_ENABLED && <div ref={widgetRef} className="flex justify-center" />}

              <Button
                  type="submit"
                  disabled={loading || (TURNSTILE_ENABLED && !turnstileToken)}
                  className="h-10 w-full mt-2"
              >
                {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                ) : (
                    "Sign Up"
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground mt-2">
                Already have an account?{" "}
                <Link href="/login" className="text-primary hover:underline font-medium">
                  Sign in
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
        </div>
        {TURNSTILE_ENABLED && (
            <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js"
                strategy="afterInteractive"
                onLoad={() => setScriptLoaded(true)}
            />
        )}
      </div>
  )
}
