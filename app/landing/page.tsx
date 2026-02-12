"use client"

import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Zap, Users, Code, CheckCircle, Globe, BarChart3 } from "lucide-react"
import { APP_NAME } from "@/lib/constants"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border sticky top-0 z-50 bg-background/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/favicon.png"
              alt={APP_NAME}
              width={24}
              height={24}
              className="h-6 w-6"
            />
            <span className="font-bold text-xl">{APP_NAME}</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Login
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Sign Up</Button>
            </Link>
          </div>
        </div>
      </nav>

      <main>
        {/* Hero Section */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
              Secure your web applications instantly
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground mb-8">
              Professional vulnerability scanning for developers and security teams. Fast, accurate, and easy to use.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/signup">
                <Button size="lg" className="w-full sm:w-auto">
                  Start Free
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  Sign In
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
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">75+</div>
                <p className="text-sm text-muted-foreground">Vulnerability Types</p>
              </div>
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">&lt;3s</div>
                <p className="text-sm text-muted-foreground">Average Scan Time</p>
              </div>
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">100%</div>
                <p className="text-sm text-muted-foreground">Accurate Results</p>
              </div>
              <div>
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">24/7</div>
                <p className="text-sm text-muted-foreground">Uptime Guarantee</p>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Key Features</h2>
            <p className="text-lg text-muted-foreground">Everything you need to keep your apps secure</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="p-6 border-border/40 bg-card/50">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Lightning Fast</h3>
              <p className="text-muted-foreground">Scan websites in seconds with our optimized scanning engine.</p>
            </Card>
            <Card className="p-6 border-border/40 bg-card/50">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Code className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Smart Detection</h3>
              <p className="text-muted-foreground">Advanced algorithms detect XSS, SQL injection, CSRF, and more.</p>
            </Card>
            <Card className="p-6 border-border/40 bg-card/50">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Team Collaboration</h3>
              <p className="text-muted-foreground">Invite team members, manage permissions, and share results.</p>
            </Card>
          </div>
        </section>

        {/* Why Choose Us */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Why Security Teams Choose Us</h2>
            <p className="text-lg text-muted-foreground">Built for developers, trusted by enterprises</p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="flex gap-4">
              <CheckCircle className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold mb-2">Accurate Detection</h3>
                <p className="text-muted-foreground">Advanced algorithms with minimal false positives mean you can trust the results.</p>
              </div>
            </div>
            <div className="flex gap-4">
              <CheckCircle className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold mb-2">Real-time Insights</h3>
                <p className="text-muted-foreground">Get instant feedback on your security posture with detailed remediation steps.</p>
              </div>
            </div>
            <div className="flex gap-4">
              <CheckCircle className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold mb-2">API & Webhooks</h3>
                <p className="text-muted-foreground">Integrate with your CI/CD pipeline for automated security testing.</p>
              </div>
            </div>
            <div className="flex gap-4">
              <CheckCircle className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold mb-2">Team Management</h3>
                <p className="text-muted-foreground">Invite team members, set permissions, and collaborate seamlessly.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section className="bg-card/50 border-t border-b border-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
            <div className="mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">For Everyone</h2>
              <p className="text-lg text-muted-foreground">Whether you're a solo developer or part of a large team</p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="p-6 border-border/40 bg-background">
                <Globe className="h-8 w-8 text-primary mb-4" />
                <h3 className="text-lg font-semibold mb-2">Web Developers</h3>
                <p className="text-sm text-muted-foreground">Quickly identify and fix vulnerabilities before deployment.</p>
              </Card>
              <Card className="p-6 border-border/40 bg-background">
                <BarChart3 className="h-8 w-8 text-primary mb-4" />
                <h3 className="text-lg font-semibold mb-2">Security Teams</h3>
                <p className="text-sm text-muted-foreground">Manage security across multiple applications with detailed insights.</p>
              </Card>
              <Card className="p-6 border-border/40 bg-background">
                <Users className="h-8 w-8 text-primary mb-4" />
                <h3 className="text-lg font-semibold mb-2">DevOps Teams</h3>
                <p className="text-sm text-muted-foreground">Automate security scanning as part of your CI/CD pipeline.</p>
              </Card>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="bg-card/50 border-t border-b border-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
            <div className="mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">How It Works</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <div>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/20 text-primary font-bold mb-4">
                  1
                </div>
                <h3 className="text-lg font-semibold mb-2">Enter URL</h3>
                <p className="text-muted-foreground">Provide the website URL you want to scan.</p>
              </div>
              <div>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/20 text-primary font-bold mb-4">
                  2
                </div>
                <h3 className="text-lg font-semibold mb-2">Scan & Analyze</h3>
                <p className="text-muted-foreground">Our engine analyzes your site for vulnerabilities.</p>
              </div>
              <div>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/20 text-primary font-bold mb-4">
                  3
                </div>
                <h3 className="text-lg font-semibold mb-2">Get Results</h3>
                <p className="text-muted-foreground">Review detailed findings and remediation guidance.</p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="text-center">
            <h2 className="text-3xl sm:text-4xl font-bold mb-6">Ready to secure your website?</h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              Join hundreds of developers using {APP_NAME} to keep their applications safe.
            </p>
            <Link href="/signup">
              <Button size="lg">
                Get Started Free
              </Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h3 className="font-semibold mb-4">Product</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/login" className="hover:text-foreground transition-colors">Features</Link></li>
                <li><Link href="/login" className="hover:text-foreground transition-colors">API</Link></li>
                <li><Link href="/login" className="hover:text-foreground transition-colors">Documentation</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Legal</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/legal/terms" className="hover:text-foreground transition-colors">Terms</Link></li>
                <li><Link href="/legal/privacy" className="hover:text-foreground transition-colors">Privacy</Link></li>
              </ul>
            </div>
            <div className="md:col-span-2">
              <h3 className="font-semibold mb-4">{APP_NAME}</h3>
              <p className="text-sm text-muted-foreground">Professional vulnerability scanning for web applications. Completely free, forever.</p>
            </div>
          </div>
          <div className="border-t border-border pt-8 flex flex-col sm:flex-row justify-between items-center text-sm text-muted-foreground">
              <p>&copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
