"use client"

import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Zap, Users, Code, CheckCircle, Globe, BarChart3, ArrowRight } from "lucide-react"
import { Footer } from "@/components/scanner/footer"
import { APP_NAME, TOTAL_CHECKS_LABEL } from "@/lib/constants"

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Navigation */}
      <nav className="border-b border-border sticky top-0 z-50 bg-background/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/favicon.svg"
              alt={`${APP_NAME} logo`}
              width={20}
              height={20}
              className="h-5 w-5"
            />
            <span className="font-bold text-base tracking-tight">{APP_NAME}</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/demo">
              <Button variant="ghost" size="sm" className="text-xs">
                Demo
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="ghost" size="sm" className="text-xs">
                Login
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm" className="text-xs">Sign Up</Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-balance mb-6">
              Secure your web applications instantly
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground text-pretty mb-8 leading-relaxed">
              Professional vulnerability scanning for developers and security teams. Fast, accurate, and easy to use.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/signup">
                <Button size="lg" className="w-full sm:w-auto gap-2">
                  Start Free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/demo">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  Try Demo
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="bg-card/50 border-t border-b border-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">{TOTAL_CHECKS_LABEL}</div>
                <p className="text-sm text-muted-foreground">Vulnerability Types</p>
              </div>
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">{'<3s'}</div>
                <p className="text-sm text-muted-foreground">Average Scan Time</p>
              </div>
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">100%</div>
                <p className="text-sm text-muted-foreground">Open Source</p>
              </div>
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">Free</div>
                <p className="text-sm text-muted-foreground">Forever</p>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-balance mb-4">Key Features</h2>
            <p className="text-lg text-muted-foreground">Everything you need to keep your apps secure</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="p-6 border-border bg-card">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Lightning Fast</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Scan websites in seconds with our optimized scanning engine.</p>
            </Card>
            <Card className="p-6 border-border bg-card">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Code className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Smart Detection</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Advanced algorithms detect XSS, SQL injection, CSRF, and more.</p>
            </Card>
            <Card className="p-6 border-border bg-card">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Team Collaboration</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Invite team members, manage permissions, and share results.</p>
            </Card>
          </div>
        </section>

        {/* Why Choose Us */}
        <section className="bg-card/50 border-t border-b border-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
            <div className="mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-balance mb-4">Why Security Teams Choose Us</h2>
              <p className="text-lg text-muted-foreground">Built for developers, trusted by teams</p>
            </div>
            <div className="grid md:grid-cols-2 gap-8">
              <div className="flex gap-4">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-1">Accurate Detection</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">Advanced algorithms with minimal false positives mean you can trust the results.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-1">Real-time Insights</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">Get instant feedback on your security posture with detailed remediation steps.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-1">API & Webhooks</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">Integrate with your CI/CD pipeline for automated security testing.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-1">Team Management</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">Invite team members, set permissions, and collaborate seamlessly.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-balance mb-4">How It Works</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary text-sm font-bold mb-4">
                1
              </div>
              <h3 className="text-lg font-semibold mb-2">Enter URL</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Provide the website URL you want to scan.</p>
            </div>
            <div>
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary text-sm font-bold mb-4">
                2
              </div>
              <h3 className="text-lg font-semibold mb-2">{"Scan & Analyze"}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Our engine analyzes your site for vulnerabilities.</p>
            </div>
            <div>
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary text-sm font-bold mb-4">
                3
              </div>
              <h3 className="text-lg font-semibold mb-2">Get Results</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Review detailed findings and remediation guidance.</p>
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section className="bg-card/50 border-t border-b border-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
            <div className="mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-balance mb-4">For Everyone</h2>
              <p className="text-lg text-muted-foreground">{"Whether you're a solo developer or part of a large team"}</p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="p-6 border-border bg-background">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Globe className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Web Developers</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">Quickly identify and fix vulnerabilities before deployment.</p>
              </Card>
              <Card className="p-6 border-border bg-background">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <BarChart3 className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Security Teams</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">Manage security across multiple applications with detailed insights.</p>
              </Card>
              <Card className="p-6 border-border bg-background">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">DevOps Teams</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">Automate security scanning as part of your CI/CD pipeline.</p>
              </Card>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-balance mb-6">Ready to secure your website?</h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
              Join developers using {APP_NAME} to keep their applications safe.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/signup">
                <Button size="lg" className="gap-2">
                  Get Started Free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/demo">
                <Button size="lg" variant="outline">
                  Try the Demo
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
