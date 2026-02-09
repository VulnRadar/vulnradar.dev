"use client"

import React from "react"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Radar, ArrowLeft, Mail, CheckCircle2, AlertTriangle, Copy, Check } from "lucide-react"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [resetLink, setResetLink] = useState<string | null>(null)
  const [has2FA, setHas2FA] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }

      setSent(true)
      if (data.resetToken) {
        setResetLink(`${window.location.origin}/reset-password?token=${data.resetToken}`)
      }
      if (data.has2FA) setHas2FA(true)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  function copyLink() {
    if (resetLink) {
      navigator.clipboard.writeText(resetLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Radar className="h-8 w-8 text-primary" />
          <span className="text-2xl font-bold text-foreground font-mono tracking-tight">VulnRadar</span>
        </div>

        <Card className="bg-card border-border">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl font-bold">Reset Your Password</CardTitle>
            <CardDescription>
              {sent ? "Check below for your reset link." : "Enter your email and we will generate a reset link."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!sent ? (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="email" className="text-sm font-medium text-foreground">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="pl-10"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                <Button type="submit" disabled={loading || !email} className="w-full">
                  {loading ? "Sending..." : "Generate Reset Link"}
                </Button>

                <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to login
                </Link>
              </form>
            ) : (
              <div className="flex flex-col gap-4">
                {has2FA ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                      <AlertTriangle className="h-6 w-6 text-amber-500" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">2FA is Enabled</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-xs">
                        This account has two-factor authentication enabled. For security reasons, password resets cannot be performed via email. Please contact support for assistance.
                      </p>
                    </div>
                    <Link href="/contact">
                      <Button variant="outline" size="sm" className="bg-transparent">Contact Support</Button>
                    </Link>
                  </div>
                ) : resetLink ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-sm text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Reset link generated successfully.
                    </div>

                    <div className="bg-muted/30 border border-border rounded-lg p-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Your Reset Link</p>
                      <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
                        In production this would be emailed to you. For now, use this link directly. It expires in 1 hour.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-[11px] text-foreground bg-background border border-border rounded px-2 py-1.5 font-mono break-all select-all">
                          {resetLink}
                        </code>
                        <Button variant="outline" size="sm" className="bg-transparent shrink-0 h-8 w-8 p-0" onClick={copyLink}>
                          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>

                    <Link href={resetLink} className="w-full">
                      <Button className="w-full">Go to Reset Page</Button>
                    </Link>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    If an account with that email exists, a reset link has been sent.
                  </div>
                )}

                <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to login
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
