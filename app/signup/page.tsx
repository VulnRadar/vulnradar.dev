"use client"

import React from "react"
import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import Image from "next/image"
import Script from "next/script"
import { Loader2, Eye, EyeOff, Mail, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { APP_NAME, TURNSTILE_ENABLED } from "@/lib/constants"
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
      const res = await fetch("/api/auth/signup", {
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
              <p className="text-xs text-muted-foreground text-center">
                Didn&apos;t receive the email? Check your spam folder or{" "}
                <Link href="/login" className="text-primary hover:underline">
                  request a new link
                </Link>
              </p>
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
            <CardTitle className="text-xl font-bold tracking-tight">Create an account</CardTitle>
            <CardDescription>Enter your details below to create your account and start scanning.</CardDescription>
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