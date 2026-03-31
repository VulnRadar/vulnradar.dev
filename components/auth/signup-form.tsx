"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import Script from "next/script"
import { Loader2, Eye, EyeOff, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { APP_NAME, TURNSTILE_ENABLED } from "@/lib/config/constants"
import { API } from "@/lib/config/client-constants"
import { getPasswordStrength } from "@/lib/auth/password-strength"
import { transitions } from "@/lib/ui/animations"

interface SignupFormProps {
  onSuccess: (email: string) => void
}

export function SignupForm({ onSuccess }: SignupFormProps) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
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
      const res = await fetch(API.AUTH.SIGNUP, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: name.trim(),
          turnstileToken: TURNSTILE_ENABLED ? turnstileToken : null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Signup failed.")
        setLoading(false)
        return
      }

      onSuccess(email)
    } catch {
      setError("Something went wrong. Please try again.")
      setLoading(false)
    }
  }

  const strengthColors = [
    "bg-destructive",
    "bg-orange-500",
    "bg-amber-500",
    "bg-lime-500",
    "bg-emerald-500",
  ]

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name" className="text-sm font-medium">Full Name</Label>
          <Input
            id="name"
            type="text"
            placeholder="Your Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="h-10 border-border/40"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email" className="text-sm font-medium">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-10 border-border/40"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password" className="text-sm font-medium">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-10 pr-10 border-border/40"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground ${transitions.colors}`}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {password && (
            <div className="space-y-1.5 mt-0.5">
              <div className="flex gap-1 h-1">
                {[0, 1, 2, 3, 4].map((idx) => (
                  <div
                    key={idx}
                    className={`h-full flex-1 rounded-full transition-colors duration-200 ${
                      strength.level >= idx ? strengthColors[idx] : "bg-muted"
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword" className="text-sm font-medium">Confirm Password</Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              placeholder="Repeat your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="h-10 border-border/40"
            />
            {confirmPassword && (
              <div className={`absolute right-3 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full ${
                confirmPassword === password ? "bg-emerald-500" : "bg-destructive"
              }`} />
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
            <p className="text-sm text-destructive flex items-center gap-2" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </p>
          </div>
        )}

        {TURNSTILE_ENABLED && <div ref={widgetRef} className="flex justify-center" />}

        <Button
          type="submit"
          disabled={loading || (TURNSTILE_ENABLED && !turnstileToken)}
          className="h-10 w-full mt-1"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating account...
            </>
          ) : (
            "Create Account"
          )}
        </Button>

        <p className="text-center text-sm text-muted-foreground mt-1">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </form>

      {TURNSTILE_ENABLED && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          onLoad={() => setScriptLoaded(true)}
        />
      )}
    </>
  )
}
