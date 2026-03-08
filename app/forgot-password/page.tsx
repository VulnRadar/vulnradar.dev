"use client"

import React from "react"
import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Mail, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react"
import { APP_NAME } from "@/lib/constants"
import { API } from "@/lib/client-constants"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      const res = await fetch(API.AUTH.FORGOT_PASSWORD, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setSent(true)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
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
          {sent ? (
            <>
              <div className="flex justify-center mb-2">
                <div className="p-3 bg-emerald-500/10 rounded-full">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                </div>
              </div>
              <CardTitle className="text-xl font-bold tracking-tight">Check your email</CardTitle>
              <CardDescription>
                {"If an account with that email exists, we've sent a password reset link. The link expires in 1 hour."}
              </CardDescription>
            </>
          ) : (
            <>
              <CardTitle className="text-xl font-bold tracking-tight">Reset your password</CardTitle>
              <CardDescription>{"Enter your email and we'll send you a reset link."}</CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="pb-8">
          {!sent ? (
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

              {error && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
                  <p className="text-sm text-destructive flex items-center gap-2" role="alert">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {error}
                  </p>
                </div>
              )}

              <Button type="submit" disabled={loading || !email} className="h-10 w-full mt-2">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </Button>

              <Link
                href="/login"
                className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mt-2"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to login
              </Link>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                <Mail className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Be sure to check your spam folder if you {"don't"} see the email within a few minutes.
                </p>
              </div>

              <Link
                href="/login"
                className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to login
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
