"use client"

import Link from "next/link"
import Script from "next/script"
import { Shield, Zap, Users, Code, ArrowRight, CheckCircle, Mail, Github, Download, Key, GitCompare, Webhook, Calendar, TrendingUp, Heart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import Image from "next/image"
import { APP_VERSION } from "@/lib/version"
import { useState, useEffect, useRef } from "react"

export default function LandingPage() {
  const [emailForm, setEmailForm] = useState({ email: "", message: "" })
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const widgetRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  // Render Turnstile widget after script loads
  useEffect(() => {
    if (!scriptLoaded || !widgetRef.current || widgetIdRef.current) return

    const turnstile = (window as any).turnstile
    if (!turnstile) return

    try {
      widgetIdRef.current = turnstile.render(widgetRef.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: (token: string) => {
          setTurnstileToken(token)
        },
      })
    } catch (err) {
      console.error("Failed to render Turnstile:", err)
    }

    return () => {
      if (widgetIdRef.current && turnstile) {
        try {
          turnstile.remove(widgetIdRef.current)
          widgetIdRef.current = null
        } catch {}
      }
    }
  }, [scriptLoaded])

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!turnstileToken) {
      setEmailStatus("error")
      return
    }

    setEmailStatus("sending")

    try {
      const response = await fetch("/api/landing-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailForm.email,
          message: emailForm.message,
          turnstileToken,
        }),
      })

      if (!response.ok) {
        setEmailStatus("error")
        return
      }

      setEmailStatus("sent")
      setEmailForm({ email: "", message: "" })
      setTurnstileToken(null)

      // Reset Turnstile widget
      const turnstile = (window as any).turnstile
      if (turnstile && widgetIdRef.current) {
        try {
          turnstile.reset(widgetIdRef.current)
        } catch {}
      }

      setTimeout(() => setEmailStatus("idle"), 3000)
    } catch {
      setEmailStatus("error")
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Cloudflare Turnstile Script */}
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />

      {/* Header */}
      <header className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="relative w-6 h-6 sm:w-8 sm:h-8">
              <Image src="/favicon.svg" alt="VulnRadar" fill className="object-contain" />
            </div>
            <span className="text-lg sm:text-xl font-bold font-mono tracking-tight">VulnRadar</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link href="/login">
              <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Login</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm" className="gap-2 text-xs sm:text-sm">
                Get Started
                <ArrowRight className="h-3 w-3 sm:h-4 sm:w-4" />
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-background pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20 lg:py-32 relative">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs sm:text-sm font-medium mb-4 sm:mb-6">
              <Shield className="h-3 w-3 sm:h-4 sm:w-4" />
              Professional Security Scanning
            </div>
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4 sm:mb-6 bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
              Find vulnerabilities before attackers do
            </h1>
            <p className="text-base sm:text-xl text-muted-foreground mb-6 sm:mb-8 leading-relaxed px-4">
              Scan your websites for 75+ security vulnerabilities in seconds. Get detailed reports with actionable fixes and collaborate with your team.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 px-4">
              <Link href="/signup" className="w-full sm:w-auto">
                <Button size="lg" className="gap-2 px-6 sm:px-8 w-full sm:w-auto">
                  Start Scanning Free
                  <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              </Link>
              <Link href="/login" className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="gap-2 bg-transparent w-full sm:w-auto">
                  View Live Demo
                </Button>
              </Link>
            </div>

            {/* Trust Indicators */}
            <div className="mt-12 sm:mt-16 flex flex-wrap items-center justify-center gap-6 sm:gap-12 text-xs sm:text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" />
                <span>No credit card required</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" />
                <span>Free forever</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" />
                <span>Open source</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-y border-border/40 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 text-center">
            <div>
              <div className="text-3xl sm:text-4xl font-bold mb-2">75+</div>
              <div className="text-xs sm:text-sm text-muted-foreground">Security Checks</div>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-bold mb-2">&lt;3s</div>
              <div className="text-xs sm:text-sm text-muted-foreground">Average Scan Time</div>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-bold mb-2">100%</div>
              <div className="text-xs sm:text-sm text-muted-foreground">Free to Use</div>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-bold mb-2">24/7</div>
              <div className="text-xs sm:text-sm text-muted-foreground">Always Available</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        <div className="text-center mb-12 sm:mb-16">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4">Everything you need to secure your web apps</h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto px-4">
            Comprehensive security scanning with enterprise-grade features
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
          <Card className="p-4 sm:p-6 border-border/40 bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 sm:mb-4">
              <Zap className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold mb-2">Lightning Fast Scans</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Get comprehensive security reports in seconds, not hours. Our optimized scanner checks 75+ vulnerability types instantly.
            </p>
          </Card>

          <Card className="p-4 sm:p-6 border-border/40 bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 sm:mb-4">
              <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold mb-2">Smart Detection</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Advanced algorithms detect XSS, CSRF, SQL injection, and more with minimal false positives using context-aware analysis.
            </p>
          </Card>

          <Card className="p-4 sm:p-6 border-border/40 bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 sm:mb-4">
              <Users className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold mb-2">Team Collaboration</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Share scans, track history, and collaborate on fixes. Role-based access control for teams of any size.
            </p>
          </Card>

          <Card className="p-4 sm:p-6 border-border/40 bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 sm:mb-4">
              <Code className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold mb-2">Fix Guidance</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Get detailed explanations and code examples for every vulnerability. Learn how to fix issues properly.
            </p>
          </Card>

          <Card className="p-4 sm:p-6 border-border/40 bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 sm:mb-4">
              <Download className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold mb-2">Export Reports</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Download professional PDF or JSON reports to share with stakeholders or integrate into your workflow.
            </p>
          </Card>

          <Card className="p-4 sm:p-6 border-border/40 bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 sm:mb-4">
              <Key className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold mb-2">API Access</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Integrate security scanning into your CI/CD pipeline with our powerful REST API and webhook support.
            </p>
          </Card>

          <Card className="p-4 sm:p-6 border-border/40 bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 sm:mb-4">
              <GitCompare className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold mb-2">Compare Scans</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Track security improvements over time with side-by-side scan comparisons and trend analysis.
            </p>
          </Card>

          <Card className="p-4 sm:p-6 border-border/40 bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 sm:mb-4">
              <Calendar className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold mb-2">Scheduled Scans</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Set up daily, weekly, or monthly recurring scans. Get notified automatically when issues are found.
            </p>
          </Card>

          <Card className="p-4 sm:p-6 border-border/40 bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 sm:mb-4">
              <Webhook className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold mb-2">Webhooks</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Integrate with Discord, Slack, or custom webhooks. Get instant notifications when scans complete.
            </p>
          </Card>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-y border-border/40 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4">How It Works</h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto px-4">
              Get started with security scanning in three simple steps
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 sm:gap-8 lg:gap-12">
            <div className="text-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 sm:mb-6">
                <span className="text-2xl sm:text-3xl font-bold text-primary">1</span>
              </div>
              <h3 className="text-lg sm:text-xl font-semibold mb-2 sm:mb-3">Enter URL</h3>
              <p className="text-sm sm:text-base text-muted-foreground">
                Simply paste the website URL you want to scan. No configuration needed.
              </p>
            </div>

            <div className="text-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 sm:mb-6">
                <span className="text-2xl sm:text-3xl font-bold text-primary">2</span>
              </div>
              <h3 className="text-lg sm:text-xl font-semibold mb-2 sm:mb-3">Scan & Analyze</h3>
              <p className="text-sm sm:text-base text-muted-foreground">
                Our scanner checks 75+ vulnerability types in seconds using advanced detection.
              </p>
            </div>

            <div className="text-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 sm:mb-6">
                <span className="text-2xl sm:text-3xl font-bold text-primary">3</span>
              </div>
              <h3 className="text-lg sm:text-xl font-semibold mb-2 sm:mb-3">Fix & Monitor</h3>
              <p className="text-sm sm:text-base text-muted-foreground">
                Get actionable fixes, track progress, and set up automated monitoring.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Vulnerability Coverage */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        <div className="text-center mb-12 sm:mb-16">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4">Comprehensive Security Coverage</h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto px-4">
            We scan for all major web vulnerabilities and security misconfigurations
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {[
            "Cross-Site Scripting (XSS)",
            "SQL Injection Patterns",
            "Cross-Site Request Forgery (CSRF)",
            "Command Injection",
            "XML External Entity (XXE)",
            "Server-Side Request Forgery (SSRF)",
            "Path Traversal",
            "Insecure Deserialization",
            "Security Headers Missing",
            "Content Security Policy",
            "Clickjacking Protection",
            "SSL/TLS Configuration",
            "Cookie Security",
            "Information Disclosure",
            "Outdated Libraries",
            "Authentication Issues",
            "Access Control Flaws",
            "Rate Limiting Missing",
            "GraphQL Introspection",
            "Prototype Pollution",
            "Mixed Content",
            "Email Exposure",
          ].map((vuln) => (
            <div key={vuln} className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border border-border/40 bg-card/30">
              <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-primary flex-shrink-0" />
              <span className="text-xs sm:text-sm font-medium">{vuln}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Use Cases */}
      <section className="border-y border-border/40 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4">Built for Modern Teams</h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto px-4">
              Whether you're a developer, security professional, or business owner
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 sm:gap-8">
            <Card className="p-5 sm:p-6 border-border/40 bg-card/50 backdrop-blur">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Code className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-semibold mb-2">Developers</h3>
                  <p className="text-sm sm:text-base text-muted-foreground">
                    Catch security issues early in development. Integrate with CI/CD pipelines and get instant feedback on pull requests.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-5 sm:p-6 border-border/40 bg-card/50 backdrop-blur">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-semibold mb-2">Security Teams</h3>
                  <p className="text-sm sm:text-base text-muted-foreground">
                    Automate vulnerability assessments across multiple applications. Generate compliance reports and track remediation.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-5 sm:p-6 border-border/40 bg-card/50 backdrop-blur">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Users className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-semibold mb-2">Agencies</h3>
                  <p className="text-sm sm:text-base text-muted-foreground">
                    Provide security audits for clients. White-label reports and manage multiple projects with team collaboration.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-5 sm:p-6 border-border/40 bg-card/50 backdrop-blur">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-semibold mb-2">Businesses</h3>
                  <p className="text-sm sm:text-base text-muted-foreground">
                    Ensure your web applications meet security standards. Protect customer data and maintain compliance.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Security Commitment */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        <div className="text-center mb-12 sm:mb-16">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4">Security You Can Trust</h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto px-4">
            We practice what we preach. Your data is protected with industry-standard security.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="text-center p-4 sm:p-6">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <Shield className="h-6 w-6 sm:h-7 sm:w-7 text-emerald-500" />
            </div>
            <h3 className="font-semibold mb-1 sm:mb-2 text-sm sm:text-base">Encrypted Data</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">All data encrypted in transit and at rest using TLS 1.3</p>
          </div>

          <div className="text-center p-4 sm:p-6">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <Key className="h-6 w-6 sm:h-7 sm:w-7 text-emerald-500" />
            </div>
            <h3 className="font-semibold mb-1 sm:mb-2 text-sm sm:text-base">Two-Factor Auth</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">Protect your account with TOTP-based 2FA</p>
          </div>

          <div className="text-center p-4 sm:p-6">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <Users className="h-6 w-6 sm:h-7 sm:w-7 text-emerald-500" />
            </div>
            <h3 className="font-semibold mb-1 sm:mb-2 text-sm sm:text-base">Private by Default</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">Your scans are private unless you choose to share</p>
          </div>

          <div className="text-center p-4 sm:p-6">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <Code className="h-6 w-6 sm:h-7 sm:w-7 text-emerald-500" />
            </div>
            <h3 className="font-semibold mb-1 sm:mb-2 text-sm sm:text-base">Open Source</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">Fully auditable code - no hidden backdoors</p>
          </div>
        </div>
      </section>


      {/* Open Source Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        <Card className="p-6 sm:p-10 border-border/40 bg-gradient-to-br from-primary/5 via-card/50 to-cyan-500/5 backdrop-blur relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative flex flex-col lg:flex-row items-center gap-6 sm:gap-8">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Github className="h-8 w-8 sm:h-10 sm:w-10 text-primary" />
            </div>
            <div className="flex-1 text-center lg:text-left">
              <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold mb-2 sm:mb-3">100% Open Source</h2>
              <p className="text-sm sm:text-base text-muted-foreground max-w-2xl">
                VulnRadar is completely open source. Inspect the code, contribute features, report issues, or self-host your own instance. Transparency and community are at our core.
              </p>
            </div>
            <a
              href="https://github.com/RejectModders/VulnRadar"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0"
            >
              <Button size="lg" variant="outline" className="gap-2 bg-transparent">
                <Github className="h-5 w-5" />
                View on GitHub
              </Button>
            </a>
          </div>
        </Card>
      </section>

      {/* FAQ Section */}
      <section className="border-y border-border/40 bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4">Frequently Asked Questions</h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto px-4">
              Got questions? We've got answers.
            </p>
          </div>

          <div className="space-y-4 sm:space-y-6">
            {[
              {
                q: "Is VulnRadar really free?",
                a: "Yes! VulnRadar is 100% free to use with no hidden costs. We're open source and community-driven. You can use all features without paying anything."
              },
              {
                q: "What types of vulnerabilities do you detect?",
                a: "We scan for 75+ vulnerability types including XSS, SQL injection, CSRF, security header misconfigurations, SSL/TLS issues, information disclosure, and many more. Check our documentation for the full list."
              },
              {
                q: "Can I scan any website?",
                a: "You can scan websites you own or have explicit permission to test. Scanning websites without authorization may violate laws and our acceptable use policy."
              },
              {
                q: "How long does a scan take?",
                a: "Most scans complete in under 3 seconds. Complex sites with many resources may take slightly longer, but we optimize for speed without sacrificing thoroughness."
              },
              {
                q: "Can I integrate VulnRadar with my CI/CD pipeline?",
                a: "Absolutely! We provide a REST API with full documentation. You can also use webhooks to get notified when scans complete. API keys can be managed from your profile."
              },
              {
                q: "Is my scan data private?",
                a: "Yes. Your scan results are private by default. You can choose to share specific scans via shareable links, but nothing is public unless you explicitly share it."
              },
            ].map((faq, i) => (
              <Card key={i} className="p-4 sm:p-6 border-border/40 bg-card/50 backdrop-blur">
                <h3 className="text-base sm:text-lg font-semibold mb-2 text-foreground">{faq.q}</h3>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{faq.a}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Email Contact Section */}
      <section id="contact" className="bg-background">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
          <div className="text-center mb-8 sm:mb-12">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 sm:mb-6">
              <Mail className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4">Get in Touch</h2>
            <p className="text-base sm:text-lg text-muted-foreground px-4">
              Have questions? Want to learn more? Send us a message and we'll get back to you shortly.
            </p>
          </div>

          <Card className="p-6 sm:p-8 border-border/40 bg-card/50 backdrop-blur">
            <form onSubmit={handleEmailSubmit} className="space-y-4 sm:space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-2">
                  Email Address
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={emailForm.email}
                  onChange={(e) => setEmailForm({ ...emailForm, email: e.target.value })}
                  required
                  className="w-full"
                  disabled={emailStatus === "sending"}
                />
              </div>

              <div>
                <label htmlFor="message" className="block text-sm font-medium mb-2">
                  Message
                </label>
                <Textarea
                  id="message"
                  placeholder="Tell us what you're interested in..."
                  value={emailForm.message}
                  onChange={(e) => setEmailForm({ ...emailForm, message: e.target.value })}
                  required
                  rows={4}
                  className="w-full resize-none"
                  disabled={emailStatus === "sending"}
                />
              </div>

              {/* Turnstile Widget */}
              <div className="flex justify-center">
                <div ref={widgetRef} />
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full gap-2"
                disabled={!turnstileToken || emailStatus === "sending" || emailStatus === "sent"}
              >
                {emailStatus === "sending" ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                    Sending...
                  </>
                ) : emailStatus === "sent" ? (
                  <>
                    <CheckCircle className="h-5 w-5" />
                    Message Sent!
                  </>
                ) : (
                  <>
                    Send Message
                    <ArrowRight className="h-5 w-5" />
                  </>
                )}
              </Button>

              {emailStatus === "sent" && (
                <p className="text-sm text-center text-muted-foreground">
                  Thanks for reaching out! We'll respond within 24 hours.
                </p>
              )}

              {emailStatus === "error" && (
                <p className="text-sm text-center text-destructive">
                  Failed to send message. Please try again or email us directly at support@vulnradar.dev
                </p>
              )}
            </form>
          </Card>

          <div className="mt-8 sm:mt-12 text-center">
            <p className="text-sm text-muted-foreground mb-4">Or reach us directly at:</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6">
              <a
                href="mailto:support@vulnradar.dev"
                className="flex items-center gap-2 text-primary hover:underline text-sm sm:text-base"
              >
                <Mail className="h-4 w-4" />
                support@vulnradar.dev
              </a>
              <a
                href="https://github.com/RejectModders"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-primary hover:underline text-sm sm:text-base"
              >
                <Github className="h-4 w-4" />
                GitHub
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Support Section */}
      <section className="border-y border-border/40 bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
          <div className="text-center">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-pink-500/10 flex items-center justify-center mx-auto mb-4 sm:mb-6">
              <Heart className="h-6 w-6 sm:h-8 sm:w-8 text-pink-500" />
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4">Support VulnRadar</h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-6 sm:mb-8 px-4">
              VulnRadar is free and open source. If you find it useful, consider supporting development to help us add new features and keep the project running.
            </p>
            <div className="flex items-center justify-center">
              <a
                href="/donate"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="lg" className="gap-2 bg-[#FFDD00] hover:bg-[#FFDD00]/90 text-black font-semibold">
                  <Heart className="h-5 w-5" />
                  Buy Me a Coffee
                </Button>
              </a>
            </div>
            <p className="mt-6 text-xs sm:text-sm text-muted-foreground">
              Every contribution helps keep VulnRadar free for everyone.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-cyan-500/10 to-background pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20 relative">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4">Ready to secure your website?</h2>
            <p className="text-base sm:text-lg text-muted-foreground mb-6 sm:mb-8 px-4">
              Join developers and security teams using VulnRadar to find and fix vulnerabilities faster.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 px-4">
              <Link href="/signup" className="w-full sm:w-auto">
                <Button size="lg" className="gap-2 px-6 sm:px-8 w-full sm:w-auto">
                  Get Started Free
                  <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              </Link>
              <Link href="/login" className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="bg-transparent w-full sm:w-auto">
                  View Demo
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8">
            <div>
              <h3 className="font-semibold mb-3 sm:mb-4 text-sm sm:text-base">Product</h3>
              <ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
                <li><Link href="/login" className="hover:text-foreground transition-colors">Demo</Link></li>
                <li><Link href="/login" className="hover:text-foreground transition-colors">Changelog</Link></li>
                <li><Link href="/login" className="hover:text-foreground transition-colors">Documentation</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-3 sm:mb-4 text-sm sm:text-base">Community</h3>
              <ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
                <li><a href="https://github.com/RejectModders/VulnRadar" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitHub</a></li>
                <li><Link href="/donate" className="hover:text-foreground transition-colors">Support Us</Link></li>
                <li><a href="#contact" className="hover:text-foreground transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-3 sm:mb-4 text-sm sm:text-base">Legal</h3>
              <ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
                <li><Link href="/legal/privacy" className="hover:text-foreground transition-colors">Privacy</Link></li>
                <li><Link href="/legal/terms" className="hover:text-foreground transition-colors">Terms</Link></li>
                <li><Link href="/legal/acceptable-use" className="hover:text-foreground transition-colors">Acceptable Use</Link></li>
                <li><Link href="/legal/disclaimer" className="hover:text-foreground transition-colors">Disclaimer</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-3 sm:mb-4 text-sm sm:text-base">VulnRadar</h3>
              <p className="text-xs sm:text-sm text-muted-foreground mb-3">
                Professional web vulnerability scanning for modern teams.
              </p>
              <Link
                href="/donate"
                className="inline-flex items-center gap-1.5 text-xs text-yellow-500 hover:text-yellow-400 transition-colors"
              >
                <Heart className="h-3 w-3" />
                Support the project
              </Link>
            </div>
          </div>
          <div className="border-t border-border/40 mt-6 sm:mt-8 pt-6 sm:pt-8 text-center text-xs sm:text-sm text-muted-foreground">
            <p>© {new Date().getFullYear()} VulnRadar. All rights reserved. v{APP_VERSION}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

