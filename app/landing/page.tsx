"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Shield, Zap, Users, Code, CheckCircle, Globe, BarChart3, ArrowRight, Terminal, Lock, Eye, Cpu, Activity, Clock, Target } from "lucide-react"
import { Footer } from "@/components/scanner/footer"
import { APP_NAME, TOTAL_CHECKS_LABEL, BILLING_ENABLED, ROUTES } from "@/lib/constants"
import { ThemedLogo } from "@/components/themed-logo"
import { Badge } from "@/components/ui/badge"
import { backdrops } from "@/lib/animations"
import { cn } from "@/lib/utils"

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Navigation */}
      <nav className={cn("sticky top-0 z-50 border-b border-border/50", backdrops.header)}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <ThemedLogo width={26} height={26} className="h-6 w-6 transition-transform group-hover:scale-105" alt={`${APP_NAME} logo`} />
            <span className="font-semibold text-base tracking-tight">{APP_NAME}</span>
          </Link>
          
          <div className="hidden md:flex items-center gap-6">
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
          
          <div className="flex items-center gap-2">
            <Link href={ROUTES.LOGIN}>
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex h-8">Log in</Button>
            </Link>
            <Link href={ROUTES.SIGNUP}>
              <Button size="sm" className="h-8 gap-1.5">
                Get Started
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
            <div className="max-w-3xl mx-auto text-center">
              <Badge variant="outline" className="mb-5 gap-1.5 py-1 px-3 border-primary/30 bg-primary/5 text-xs">
                <Activity className="h-3 w-3 text-primary" />
                {TOTAL_CHECKS_LABEL} vulnerability checks
              </Badge>
              
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-5 text-balance">
                The complete platform for{" "}
                <span className="text-muted-foreground">web security</span>
              </h1>
              
              <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto mb-8 text-pretty">
                Detect vulnerabilities in seconds. Get actionable insights. Ship secure code with confidence.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href={ROUTES.SIGNUP}>
                  <Button size="lg" className="h-11 px-6 gap-2">
                    Start Scanning Free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/demo">
                  <Button size="lg" variant="outline" className="h-11 px-6 gap-2">
                    <Terminal className="h-4 w-4" />
                    Live Demo
                  </Button>
                </Link>
              </div>

              <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
                {["No credit card required", "Free forever tier", "Open source"].map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5 text-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section - Using admin UI pattern */}
        <section className="border-y border-border/50 bg-muted/20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { icon: Shield, value: TOTAL_CHECKS_LABEL, label: "Security Checks", color: "primary" },
                { icon: Zap, value: "<3s", label: "Scan Time", color: "primary" },
                { icon: Target, value: "99.9%", label: "Accuracy", color: "emerald" },
                { icon: Clock, value: "24/7", label: "Monitoring", color: "primary" },
              ].map((stat, i) => (
                <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors">
                  <div className={cn(
                    "p-2.5 rounded-lg shrink-0",
                    stat.color === "primary" ? "bg-primary/10" : "bg-emerald-500/10"
                  )}>
                    <stat.icon className={cn(
                      "h-4 w-4",
                      stat.color === "primary" ? "text-primary" : "text-emerald-500"
                    )} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl sm:text-2xl font-bold tracking-tight">{stat.value}</p>
                    <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{stat.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-16 sm:py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-10">
              <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">Features</p>
              <h2 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight">
                Everything you need to ship secure
              </h2>
              <p className="text-muted-foreground max-w-xl">
                A complete toolkit for identifying, understanding, and fixing security vulnerabilities.
              </p>
            </div>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { icon: Zap, title: "Lightning Fast", desc: "Complete security scans in under 3 seconds with our optimized engine." },
                { icon: Eye, title: "Deep Analysis", desc: "Detect XSS, SQL injection, CSRF, misconfigurations, and 50+ vulnerability types." },
                { icon: Code, title: "Developer First", desc: "API access, CI/CD integration, and webhooks for seamless automation." },
                { icon: Users, title: "Team Collaboration", desc: "Invite members, assign issues, and track remediation together." },
                { icon: Cpu, title: "Scheduled Scans", desc: "Automated monitoring with instant notifications for new vulnerabilities." },
                { icon: Lock, title: "Privacy Focused", desc: "Your data stays yours. We never store sensitive scan information." },
              ].map((feature, i) => (
                <div key={i} className="group p-5 rounded-xl border border-border/50 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-all">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                    <feature.icon className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-base font-semibold mb-1.5">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-16 sm:py-20 border-y border-border/50 bg-muted/20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-12">
              <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">How it works</p>
              <h2 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight">
                Get started in minutes
              </h2>
              <p className="text-muted-foreground max-w-lg mx-auto">
                No complex setup required. Start scanning immediately.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 lg:gap-10">
              {[
                { step: 1, title: "Enter your URL", desc: "Paste the URL of the website or application you want to scan." },
                { step: 2, title: "We analyze", desc: "Our engine performs comprehensive security checks across multiple categories." },
                { step: 3, title: "Get results", desc: "Review detailed findings with severity ratings and fix recommendations." },
              ].map((item, i) => (
                <div key={i} className="relative text-center">
                  <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-primary text-primary-foreground text-lg font-bold mb-5">
                    {item.step}
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  {i < 2 && (
                    <div className="hidden md:block absolute top-5 left-[58%] w-[84%] h-px bg-border/60" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section className="py-16 sm:py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="mb-10">
              <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">Use Cases</p>
              <h2 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight">
                Built for teams of all sizes
              </h2>
              <p className="text-muted-foreground">
                From solo developers to enterprise security teams.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              {[
                {
                  icon: Globe,
                  title: "Developers",
                  desc: "Catch vulnerabilities before they reach production.",
                  features: ["Quick single-page scans", "API & CLI access", "Code fix suggestions"],
                },
                {
                  icon: Shield,
                  title: "Security Teams",
                  desc: "Comprehensive visibility across all your applications.",
                  features: ["Bulk scanning", "Compliance reports", "Trend analysis"],
                },
                {
                  icon: BarChart3,
                  title: "DevOps",
                  desc: "Automate security in your deployment pipeline.",
                  features: ["CI/CD integration", "Webhook notifications", "Scheduled monitoring"],
                },
              ].map((useCase, i) => (
                <div key={i} className="p-6 rounded-xl border border-border/50 bg-card/50 hover:bg-card hover:border-border/60 transition-all">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-5">
                    <useCase.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{useCase.title}</h3>
                  <p className="text-sm text-muted-foreground mb-5">{useCase.desc}</p>
                  <ul className="space-y-2">
                    {useCase.features.map((feature, j) => (
                      <li key={j} className="flex items-center gap-2 text-sm">
                        <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="border-t border-border/50 bg-muted/20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
            <div className="max-w-2xl mx-auto text-center">
              <h2 className="text-2xl sm:text-3xl font-bold mb-4 tracking-tight">
                Ready to secure your applications?
              </h2>
              <p className="text-muted-foreground mb-8">
                Join thousands of developers shipping secure code with {APP_NAME}.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href={ROUTES.SIGNUP}>
                  <Button size="lg" className="h-11 px-6 gap-2">
                    Get Started Free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                {BILLING_ENABLED && (
                  <Link href={ROUTES.PRICING}>
                    <Button size="lg" variant="outline" className="h-11 px-6">
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
