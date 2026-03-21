"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Shield, Zap, Users, Code, CheckCircle, Globe, BarChart3, ArrowRight, Terminal, Lock, Eye, Cpu, Sparkles, ExternalLink } from "lucide-react"
import { Footer } from "@/components/scanner/footer"
import { APP_NAME, TOTAL_CHECKS_LABEL, BILLING_ENABLED, ROUTES } from "@/lib/constants"
import { ThemedLogo } from "@/components/themed-logo"
import { Badge } from "@/components/ui/badge"

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 relative flex items-center">
          {/* Logo - left */}
          <Link href="/" className="flex items-center gap-2.5 z-10 group">
            <ThemedLogo width={28} height={28} className="h-7 w-7 transition-transform group-hover:scale-105" alt={`${APP_NAME} logo`} />
            <span className="font-bold text-lg tracking-tight">{APP_NAME}</span>
          </Link>
          
          {/* Center nav - absolutely centered */}
          <div className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
            {BILLING_ENABLED && (
              <Link href={ROUTES.PRICING} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Pricing
              </Link>
            )}
            <Link href={ROUTES.DOCS} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Docs
            </Link>
            <Link href="/demo" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Demo
            </Link>
          </div>
          
          {/* Right side - pushed to end */}
          <div className="flex items-center gap-3 ml-auto z-10">
            <Link href={ROUTES.LOGIN}>
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex">Log in</Button>
            </Link>
            <Link href={ROUTES.SIGNUP}>
              <Button size="sm" className="gap-1.5">
                Get Started
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero Section - Clean, bold, minimal */}
        <section className="relative overflow-hidden">
          {/* Subtle gradient orb background */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
          </div>
          
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 sm:pt-28 sm:pb-32">
            <div className="max-w-4xl mx-auto text-center">
              {/* Badge */}
              <Badge variant="outline" className="mb-6 gap-2 py-1.5 px-4 border-primary/30 bg-primary/5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-sm">{TOTAL_CHECKS_LABEL} vulnerability checks</span>
              </Badge>
              
              <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight mb-6 text-balance leading-[1.1]">
                The complete platform for{" "}
                <span className="text-muted-foreground">web security</span>
              </h1>
              
              <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed text-pretty">
                Detect vulnerabilities in seconds. Get actionable insights. 
                Ship secure code with confidence.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href={ROUTES.SIGNUP}>
                  <Button size="lg" className="h-12 px-8 text-base gap-2 shadow-lg shadow-primary/25">
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
              <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>Free forever tier</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>Open source</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section - Refined cards */}
        <section className="border-y border-border bg-muted/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
              {[
                { value: TOTAL_CHECKS_LABEL, label: "Security Checks", desc: "Comprehensive coverage" },
                { value: "<3s", label: "Scan Time", desc: "Lightning fast results" },
                { value: "99.9%", label: "Accuracy", desc: "Minimal false positives" },
                { value: "24/7", label: "Monitoring", desc: "Always watching" },
              ].map((stat, i) => (
                <div key={i} className="relative group">
                  <div className="text-center p-6 rounded-xl border border-border/50 bg-card/50 transition-all duration-300 hover:border-primary/30 hover:bg-card">
                    <div className="text-3xl sm:text-4xl font-bold mb-1 text-foreground">{stat.value}</div>
                    <p className="text-sm font-medium text-foreground/80">{stat.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">{stat.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features Grid - Clean, modern cards */}
        <section className="py-20 sm:py-28">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mb-12">
              <Badge variant="secondary" className="mb-4">Features</Badge>
              <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
                Everything you need to ship secure
              </h2>
              <p className="text-lg text-muted-foreground">
                A complete toolkit for identifying, understanding, and fixing security vulnerabilities.
              </p>
            </div>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
              {[
                { icon: Zap, title: "Lightning Fast", desc: "Complete security scans in under 3 seconds with our optimized engine." },
                { icon: Eye, title: "Deep Analysis", desc: "Detect XSS, SQL injection, CSRF, misconfigurations, and 50+ types." },
                { icon: Code, title: "Developer First", desc: "API access, CI/CD integration, and webhooks for automation." },
                { icon: Users, title: "Team Collaboration", desc: "Invite members, assign issues, and track remediation together." },
                { icon: Cpu, title: "Scheduled Scans", desc: "Automated monitoring with notifications for new vulnerabilities." },
                { icon: Lock, title: "Privacy Focused", desc: "Your data stays yours. We never store sensitive scan information." },
              ].map((feature, i) => (
                <div key={i} className="group p-6 rounded-xl border border-border/50 bg-card/30 hover:bg-card hover:border-border transition-all duration-300">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works - Horizontal flow */}
        <section className="py-20 sm:py-28 border-y border-border bg-muted/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <Badge variant="secondary" className="mb-4">How it works</Badge>
              <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
                Get started in minutes
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                No complex setup required. Start scanning immediately.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
              {[
                { step: 1, title: "Enter your URL", desc: "Simply paste the URL of the website or application you want to scan." },
                { step: 2, title: "We analyze", desc: "Our engine performs comprehensive security checks across multiple categories." },
                { step: 3, title: "Get results", desc: "Review detailed findings with severity ratings and fix recommendations." },
              ].map((item, i) => (
                <div key={i} className="relative text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary text-primary-foreground text-xl font-bold mb-6 shadow-lg shadow-primary/25">
                    {item.step}
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
                  {/* Connector line - hidden on mobile */}
                  {i < 2 && (
                    <div className="hidden md:block absolute top-7 left-[60%] w-[80%] h-px bg-border" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Use Cases - Clean cards */}
        <section className="py-20 sm:py-28">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mb-12">
              <Badge variant="secondary" className="mb-4">Use Cases</Badge>
              <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
                Built for teams of all sizes
              </h2>
              <p className="text-lg text-muted-foreground">
                From solo developers to enterprise security teams.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  icon: Globe,
                  title: "Developers",
                  desc: "Catch vulnerabilities before they reach production. Integrate into your workflow.",
                  features: ["Quick single-page scans", "API & CLI access", "Code fix suggestions"],
                },
                {
                  icon: Shield,
                  title: "Security Teams",
                  desc: "Comprehensive visibility across all your applications and domains.",
                  features: ["Bulk scanning", "Compliance reports", "Trend analysis"],
                },
                {
                  icon: BarChart3,
                  title: "DevOps",
                  desc: "Automate security as part of your deployment pipeline.",
                  features: ["CI/CD integration", "Webhook notifications", "Scheduled monitoring"],
                },
              ].map((useCase, i) => (
                <div key={i} className="p-8 rounded-2xl border border-border bg-card">
                  <useCase.icon className="h-8 w-8 mb-6 text-primary" />
                  <h3 className="text-xl font-semibold mb-3">{useCase.title}</h3>
                  <p className="text-muted-foreground leading-relaxed mb-6">{useCase.desc}</p>
                  <ul className="space-y-2.5">
                    {useCase.features.map((feature, j) => (
                      <li key={j} className="flex items-center gap-2.5 text-sm">
                        <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section - Bold, clean */}
        <section className="border-t border-border bg-muted/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="text-3xl sm:text-4xl font-bold mb-6 tracking-tight">
                Ready to secure your applications?
              </h2>
              <p className="text-xl text-muted-foreground mb-10 leading-relaxed">
                Join thousands of developers shipping secure code with {APP_NAME}.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href={ROUTES.SIGNUP}>
                  <Button size="lg" className="h-12 px-8 text-base gap-2 shadow-lg shadow-primary/25">
                    Get Started Free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                {BILLING_ENABLED && (
                  <Link href={ROUTES.PRICING}>
                    <Button size="lg" variant="outline" className="h-12 px-8 text-base">
                      View Pricing
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
