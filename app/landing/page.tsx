"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Shield, Zap, Users, Code, CheckCircle, Globe, BarChart3, ArrowRight, Terminal, Lock, Eye, Cpu } from "lucide-react"
import { Footer } from "@/components/scanner/footer"
import { APP_NAME, TOTAL_CHECKS_LABEL } from "@/lib/constants"
import { ThemedLogo } from "@/components/themed-logo"

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <ThemedLogo width={24} height={24} className="h-6 w-6" alt={`${APP_NAME} logo`} />
            <span className="font-semibold text-lg tracking-tight">{APP_NAME}</span>
          </Link>
          <div className="hidden md:flex items-center gap-6">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Docs
            </Link>
            <Link href="/demo" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Demo
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden">
          {/* Subtle grid background */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_110%)] opacity-40" />
          
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20 sm:pt-32 sm:pb-28">
            <div className="max-w-4xl mx-auto text-center">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-sm text-muted-foreground mb-8">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                {TOTAL_CHECKS_LABEL} vulnerability checks
              </div>
              
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
                Security scanning
                <br />
                <span className="text-muted-foreground">for modern web apps</span>
              </h1>
              
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
                Detect vulnerabilities in seconds. Get actionable insights. 
                Ship secure code with confidence.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/signup">
                  <Button size="lg" className="h-12 px-8 text-base gap-2">
                    Start Scanning Free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/demo">
                  <Button size="lg" variant="outline" className="h-12 px-8 text-base gap-2">
                    <Terminal className="h-4 w-4" />
                    Try Live Demo
                  </Button>
                </Link>
              </div>

              {/* Trust indicators */}
              <div className="mt-12 flex items-center justify-center gap-8 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>Free forever tier</span>
                </div>
                <div className="hidden sm:flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>Open source</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="border-y border-border bg-card/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
              <div className="text-center">
                <div className="text-4xl sm:text-5xl font-bold mb-2">{TOTAL_CHECKS_LABEL}</div>
                <p className="text-sm text-muted-foreground">Vulnerability Types</p>
              </div>
              <div className="text-center">
                <div className="text-4xl sm:text-5xl font-bold mb-2">{'<3s'}</div>
                <p className="text-sm text-muted-foreground">Average Scan Time</p>
              </div>
              <div className="text-center">
                <div className="text-4xl sm:text-5xl font-bold mb-2">99.9%</div>
                <p className="text-sm text-muted-foreground">Detection Accuracy</p>
              </div>
              <div className="text-center">
                <div className="text-4xl sm:text-5xl font-bold mb-2">24/7</div>
                <p className="text-sm text-muted-foreground">Monitoring Available</p>
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-24 sm:py-32">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                Everything you need to ship secure
              </h2>
              <p className="text-lg text-muted-foreground">
                A complete toolkit for identifying, understanding, and fixing security vulnerabilities.
              </p>
            </div>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Feature cards */}
              <div className="group p-6 rounded-xl border border-border bg-card hover:border-primary/30 transition-all duration-200">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Lightning Fast</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Complete security scans in under 3 seconds with our optimized scanning engine.
                </p>
              </div>

              <div className="group p-6 rounded-xl border border-border bg-card hover:border-primary/30 transition-all duration-200">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Eye className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Deep Analysis</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Detect XSS, SQL injection, CSRF, misconfigurations, and 50+ vulnerability types.
                </p>
              </div>

              <div className="group p-6 rounded-xl border border-border bg-card hover:border-primary/30 transition-all duration-200">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Code className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Developer First</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  API access, CI/CD integration, and webhooks for automated security testing.
                </p>
              </div>

              <div className="group p-6 rounded-xl border border-border bg-card hover:border-primary/30 transition-all duration-200">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Team Collaboration</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Invite team members, assign issues, and track remediation progress together.
                </p>
              </div>

              <div className="group p-6 rounded-xl border border-border bg-card hover:border-primary/30 transition-all duration-200">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Cpu className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Scheduled Scans</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Set up automated scans and get notified when new vulnerabilities are detected.
                </p>
              </div>

              <div className="group p-6 rounded-xl border border-border bg-card hover:border-primary/30 transition-all duration-200">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Lock className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Privacy Focused</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your data stays yours. We never store sensitive information from your scans.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-24 sm:py-32 border-y border-border bg-card/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                How it works
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Get started in minutes. No complex setup required.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-12 md:gap-8">
              <div className="relative text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground text-lg font-bold mb-6">
                  1
                </div>
                <h3 className="text-xl font-semibold mb-3">Enter your URL</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Simply paste the URL of the website or application you want to scan.
                </p>
                {/* Connector line */}
                <div className="hidden md:block absolute top-6 left-[60%] w-[80%] h-px bg-border" />
              </div>

              <div className="relative text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground text-lg font-bold mb-6">
                  2
                </div>
                <h3 className="text-xl font-semibold mb-3">We analyze</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Our engine performs comprehensive security checks across multiple categories.
                </p>
                <div className="hidden md:block absolute top-6 left-[60%] w-[80%] h-px bg-border" />
              </div>

              <div className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground text-lg font-bold mb-6">
                  3
                </div>
                <h3 className="text-xl font-semibold mb-3">Get actionable results</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Review detailed findings with severity ratings and fix recommendations.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section className="py-24 sm:py-32">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                Built for teams of all sizes
              </h2>
              <p className="text-lg text-muted-foreground">
                From solo developers to enterprise security teams.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              <div className="p-8 rounded-2xl border border-border bg-card">
                <Globe className="h-8 w-8 mb-6 text-muted-foreground" />
                <h3 className="text-xl font-semibold mb-3">Developers</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Catch vulnerabilities before they reach production. Integrate into your workflow.
                </p>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    Quick single-page scans
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    API & CLI access
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    Code fix suggestions
                  </li>
                </ul>
              </div>

              <div className="p-8 rounded-2xl border border-border bg-card">
                <Shield className="h-8 w-8 mb-6 text-muted-foreground" />
                <h3 className="text-xl font-semibold mb-3">Security Teams</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Comprehensive visibility across all your applications and domains.
                </p>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    Bulk scanning
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    Compliance reports
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    Trend analysis
                  </li>
                </ul>
              </div>

              <div className="p-8 rounded-2xl border border-border bg-card">
                <BarChart3 className="h-8 w-8 mb-6 text-muted-foreground" />
                <h3 className="text-xl font-semibold mb-3">DevOps</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Automate security as part of your deployment pipeline.
                </p>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    CI/CD integration
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    Webhook notifications
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    Scheduled monitoring
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="border-t border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="text-3xl sm:text-4xl font-bold mb-6">
                Ready to secure your applications?
              </h2>
              <p className="text-xl text-muted-foreground mb-10 leading-relaxed">
                Join thousands of developers shipping secure code with {APP_NAME}.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/signup">
                  <Button size="lg" className="h-12 px-8 text-base gap-2">
                    Get Started Free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/pricing">
                  <Button size="lg" variant="outline" className="h-12 px-8 text-base">
                    View Pricing
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
