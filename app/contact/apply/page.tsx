"use client"

import { useState, useEffect, useRef } from "react"
import Script from "next/script"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Users,
  Shield,
  HeadphonesIcon,
  Send,
  CheckCircle2,
  ArrowLeft,
  Info,
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { APP_NAME } from "@/lib/constants"

const ROLES = [
  {
    id: "support",
    label: "Support",
    icon: HeadphonesIcon,
    desc: "Help users with technical issues, answer questions, and provide guidance on using VulnRadar.",
    responsibilities: [
      "Respond to user support tickets and messages",
      "Help troubleshoot scanning issues",
      "Assist with account and API key questions",
      "Escalate bugs and security reports to the team",
    ],
  },
  {
    id: "moderator",
    label: "Moderator",
    icon: Shield,
    desc: "Monitor platform usage, enforce acceptable use policies, and help maintain community standards.",
    responsibilities: [
      "Review flagged scans and enforce acceptable use policy",
      "Monitor for abuse or misuse of the platform",
      "Assist with user reports and disputes",
      "Help maintain Discord community standards",
    ],
  },
]

export default function StaffApplyPage() {
  const [role, setRole] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [emailLocked, setEmailLocked] = useState(false)
  const [discord, setDiscord] = useState("")
  const [timezone, setTimezone] = useState("")
  const [experience, setExperience] = useState("")
  const [motivation, setMotivation] = useState("")
  const [availability, setAvailability] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const widgetRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  // Auto-fill email from logged-in user
  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch("/api/auth/me")
        if (res.ok) {
          const data = await res.json()
          if (data?.email) {
            setEmail(data.email)
            setEmailLocked(true)
          }
          if (data?.name) {
            setName(data.name)
          }
        }
      } catch { /* not logged in */ }
    }
    fetchUser()
  }, [])

  // Render Turnstile widget
  useEffect(() => {
    if (!scriptLoaded || !widgetRef.current || !role || widgetIdRef.current) return
    const turnstile = (window as any).turnstile
    if (!turnstile) return
    try {
      widgetIdRef.current = turnstile.render(widgetRef.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: (token: string) => setTurnstileToken(token),
      })
    } catch (err) {
      console.error("Failed to render Turnstile:", err)
    }
    return () => {
      if (widgetIdRef.current && turnstile) {
        try { turnstile.remove(widgetIdRef.current); widgetIdRef.current = null } catch {}
      }
    }
  }, [scriptLoaded, role])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!role) { setError("Please select a role."); return }
    if (!turnstileToken) { setError("Please complete the captcha verification."); return }
    setIsSubmitting(true)
    setError(null)

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          subject: `Staff Application: ${ROLES.find((r) => r.id === role)?.label}`,
          message: [
            `Role: ${ROLES.find((r) => r.id === role)?.label}`,
            `Discord: ${discord || "Not provided"}`,
            `Timezone: ${timezone || "Not provided"}`,
            `Availability: ${availability}`,
            "",
            "--- Experience ---",
            experience,
            "",
            "--- Motivation ---",
            motivation,
          ].join("\n"),
          category: "staff_application",
          turnstileToken,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error || "Unable to submit your application. Please try again.")
        return
      }
      setSubmitted(true)
    } catch {
      setError("Unable to submit your application. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 sm:py-10">
        <Link href="/contact" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Contact
        </Link>

        <div className="flex flex-col gap-2 mb-8">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Apply for Staff
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Interested in helping {APP_NAME} grow? We are looking for dedicated volunteers to join our team.
          </p>
        </div>

        {submitted ? (
          <Card className="bg-card border-border">
            <CardContent className="py-12 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">Application Submitted</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm leading-relaxed">
                  Thank you for your interest in joining the {APP_NAME} team. {"We'll"} review your application and reach out if {"it's"} a good fit.
                </p>
              </div>
              <div className="flex gap-3 mt-2">
                <Link href="/contact"><Button variant="outline" className="bg-transparent">Back to Contact</Button></Link>
                <Link href="/"><Button>Back to Scanner</Button></Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Info banner */}
            <div className="flex items-start gap-3 text-sm text-muted-foreground bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <span>Staff positions are voluntary. We value reliability, communication skills, and a genuine interest in web security. You must have an existing {APP_NAME} account to apply.</span>
            </div>

            {/* Role selection */}
            <div>
              <p className="text-sm font-medium text-foreground mb-3">Which role are you applying for?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ROLES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRole(r.id)}
                    className={cn(
                      "flex flex-col gap-3 p-4 rounded-xl border transition-all text-left",
                      role === r.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-muted/50 hover:border-primary/20"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <r.icon className={cn("h-5 w-5", role === r.id ? "text-primary" : "text-muted-foreground")} />
                      <span className="text-sm font-semibold text-foreground">{r.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{r.desc}</p>
                    <ul className="space-y-1">
                      {r.responsibilities.map((resp, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                          <span className="text-primary mt-0.5">{"--"}</span>
                          {resp}
                        </li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>
            </div>

            {/* Application form */}
            {role && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {ROLES.find((r) => r.id === role)?.label} Application
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="apply-name" className="text-sm font-medium text-foreground">Name</label>
                        <Input id="apply-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="apply-email" className="text-sm font-medium text-foreground">Email</label>
                        <Input id="apply-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required readOnly={emailLocked} className={emailLocked ? "opacity-60 cursor-not-allowed" : ""} />
                        {emailLocked && <p className="text-[11px] text-muted-foreground">Auto-filled from your account</p>}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="apply-discord" className="text-sm font-medium text-foreground">Discord Username <span className="text-muted-foreground font-normal">(optional)</span></label>
                        <Input id="apply-discord" value={discord} onChange={(e) => setDiscord(e.target.value)} placeholder="username" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="apply-timezone" className="text-sm font-medium text-foreground">Timezone <span className="text-muted-foreground font-normal">(optional)</span></label>
                        <Input id="apply-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. UTC-5, EST, CET" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="apply-availability" className="text-sm font-medium text-foreground">Availability</label>
                      <Input id="apply-availability" value={availability} onChange={(e) => setAvailability(e.target.value)} placeholder="e.g. 10-15 hours per week, evenings and weekends" required />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="apply-experience" className="text-sm font-medium text-foreground">Relevant Experience</label>
                      <textarea
                        id="apply-experience"
                        value={experience}
                        onChange={(e) => setExperience(e.target.value)}
                        placeholder={role === "support" ? "Any experience with user support, help desks, technical troubleshooting, web security, etc." : "Any experience with moderation, community management, policy enforcement, web security, etc."}
                        rows={4}
                        required
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="apply-motivation" className="text-sm font-medium text-foreground">Why do you want to join?</label>
                      <textarea
                        id="apply-motivation"
                        value={motivation}
                        onChange={(e) => setMotivation(e.target.value)}
                        placeholder="Tell us why you're interested in this role and what you'd bring to the team."
                        rows={4}
                        required
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed"
                      />
                    </div>

                    {error && (
                      <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                        {error}
                      </div>
                    )}

                    <Button type="submit" className="w-full sm:w-auto self-end gap-1.5" disabled={isSubmitting || !turnstileToken}>
                      <Send className="h-3.5 w-3.5" />{isSubmitting ? "Submitting..." : "Submit Application"}
                    </Button>

                    <div ref={widgetRef} className="flex justify-center" />
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
      <Footer />
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />
    </div>
  )
}
