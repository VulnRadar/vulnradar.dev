"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { BookOpen, Zap, Code2, Shield, Globe, Clock, Key, Terminal, FileCode, Layers, ArrowRight, CheckCircle, Copy, Check } from "lucide-react"
import { APP_NAME, APP_URL, APP_VERSION, ENGINE_VERSION, TOTAL_CHECKS_LABEL } from "@/lib/constants"
import { useEffect, useRef, useState } from "react"
import { useDocsContext, type TocItem } from "./layout"

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "features", label: "Features" },
  { id: "quick-start", label: "Quick Start" },
  { id: "documentation", label: "Documentation" },
  { id: "support", label: "Support" },
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  return (
    <button
      onClick={copy}
      className="absolute top-3 right-3 p-1.5 rounded-md bg-secondary/50 hover:bg-secondary transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  )
}

export default function DocsPage() {
  const { setActiveSection, setTocItems } = useDocsContext()
  const observerRef = useRef<IntersectionObserver | null>(null)

  // Set ToC items on mount
  useEffect(() => {
    setTocItems(tocItems)
    return () => setTocItems([])
  }, [setTocItems])

  // Intersection observer for active section tracking
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        })
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    )

    tocItems.forEach((item) => {
      const el = document.getElementById(item.id)
      if (el) observerRef.current?.observe(el)
    })

    return () => observerRef.current?.disconnect()
  }, [setActiveSection])

  const curlExample = `curl -X POST "${APP_URL}/api/v2/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com"}'`

  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <section id="overview" className="scroll-mt-24">
        <Badge variant="outline" className="mb-4 text-primary border-primary/30">v{APP_VERSION}</Badge>
        <h1 className="text-4xl font-bold tracking-tight mb-4">{APP_NAME} Documentation</h1>
        <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
          Complete guide to using {APP_NAME} for web vulnerability scanning. Learn how to integrate our API, 
          self-host the platform, and build custom security workflows.
        </p>

        {/* Quick Stats */}
        <div className="grid sm:grid-cols-4 gap-4 mt-8">
          <div className="p-4 rounded-lg bg-card border border-border/40">
            <div className="text-2xl font-bold text-primary mb-1">110+</div>
            <div className="text-xs text-muted-foreground">Security Checks</div>
          </div>
          <div className="p-4 rounded-lg bg-card border border-border/40">
            <div className="text-2xl font-bold text-primary mb-1">v2</div>
            <div className="text-xs text-muted-foreground">API Version</div>
          </div>
          <div className="p-4 rounded-lg bg-card border border-border/40">
            <div className="text-2xl font-bold text-primary mb-1">6</div>
            <div className="text-xs text-muted-foreground">Protocols</div>
          </div>
          <div className="p-4 rounded-lg bg-card border border-border/40">
            <div className="text-2xl font-bold text-primary mb-1">MIT</div>
            <div className="text-xs text-muted-foreground">License</div>
          </div>
        </div>
      </section>

      {/* Key Features */}
      <section id="features" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Platform Features</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: Shield, title: TOTAL_CHECKS_LABEL, description: "Comprehensive vulnerability detection engine" },
            { icon: Globe, title: "Multi-Protocol Support", description: "HTTP, HTTPS, WebSocket, FTP scanning" },
            { icon: Clock, title: "Real-Time Results", description: "Instant scan results with detailed findings" },
            { icon: Key, title: "API Access", description: "RESTful API with Bearer token authentication" },
            { icon: Layers, title: "Deep Crawl Mode", description: "Scan entire sites with automatic link discovery" },
            { icon: FileCode, title: "Open Source", description: "MIT licensed - self-host with full control" },
          ].map((feature, i) => (
            <div key={i} className="flex items-start gap-3 p-4 rounded-lg bg-card/50 border border-border/40 transition-colors hover:border-border/60">
              <feature.icon className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-sm">{feature.title}</h3>
                <p className="text-xs text-muted-foreground">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Start */}
      <section id="quick-start" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Quick Start</h2>
        <p className="text-muted-foreground">Get scanning in under 2 minutes.</p>

        <Card className="p-6 border-border/40 bg-primary/5">
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Steps */}
            <div className="space-y-6">
              {[
                { step: 1, title: "Create Account", description: `Sign up at ${APP_URL.replace('https://', '')}` },
                { step: 2, title: "Generate API Key", description: "Profile → API Keys → Generate New Key" },
                { step: 3, title: "Make Your First Scan", description: "POST to /api/v2/scan with your target URL" },
                { step: 4, title: "View Results", description: "Detailed findings with severity and remediation steps" },
              ].map((item) => (
                <div key={item.step} className="flex gap-4">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex-shrink-0">
                    {item.step}
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm">{item.title}</h4>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Code Example */}
            <div className="relative">
              <div className="text-xs font-medium text-muted-foreground mb-2">Example Request</div>
              <pre className="bg-secondary/50 p-4 rounded-lg overflow-x-auto text-sm border border-border/40">
                <code>{curlExample}</code>
              </pre>
              <CopyButton text={curlExample} />
            </div>
          </div>
        </Card>
      </section>

      {/* Documentation Navigation */}
      <section id="documentation" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Documentation</h2>
        
        <div className="grid md:grid-cols-2 gap-6">
          {/* API Reference */}
          <Card className="p-6 border-border/40 hover:border-primary/30 transition-all duration-200 group">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold">API Reference</h3>
                <p className="text-xs text-muted-foreground">v2 REST API</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Complete API documentation with authentication, endpoints, code examples in cURL, JavaScript, and Python.
            </p>
            <ul className="text-xs text-muted-foreground space-y-1.5 mb-4">
              {[
                "Bearer token authentication",
                "Scan, history, and crawl endpoints",
                "Rate limiting (50 req/day per key)",
                "Detailed error handling",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2">
                  <CheckCircle className="h-3 w-3 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Link href="/docs/api" className="flex items-center justify-center gap-2">
                View API Reference
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Card>

          {/* Setup Guide */}
          <Card className="p-6 border-border/40 hover:border-primary/30 transition-all duration-200 group">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <Code2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Setup Guide</h3>
                <p className="text-xs text-muted-foreground">Self-hosting</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Step-by-step instructions for deploying {APP_NAME} on your own infrastructure with PostgreSQL.
            </p>
            <ul className="text-xs text-muted-foreground space-y-1.5 mb-4">
              {[
                "Prerequisites and installation",
                "Database and email configuration",
                "Docker and Vercel deployment",
                "Migration and version checking",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2">
                  <CheckCircle className="h-3 w-3 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Link href="/docs/setup" className="flex items-center justify-center gap-2">
                View Setup Guide
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Card>

          {/* Developer Guide */}
          <Card className="p-6 border-border/40 hover:border-primary/30 transition-all duration-200 group">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <Terminal className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Developer Guide</h3>
                <p className="text-xs text-muted-foreground">SDKs & Integration</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Build custom integrations, create SDKs, and access the Finding Types API for dynamic vulnerability data.
            </p>
            <ul className="text-xs text-muted-foreground space-y-1.5 mb-4">
              {[
                "Finding Types endpoint",
                "SDK development patterns",
                "Official Python & TypeScript SDKs",
                "Community contributions",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2">
                  <CheckCircle className="h-3 w-3 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Link href="/docs/developers" className="flex items-center justify-center gap-2">
                View Developer Guide
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Card>

          {/* Changelog */}
          <Card className="p-6 border-border/40 hover:border-primary/30 transition-all duration-200 group">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Changelog</h3>
                <p className="text-xs text-muted-foreground">Version History</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Track all updates, new features, bug fixes, and improvements across {APP_NAME} versions.
            </p>
            <ul className="text-xs text-muted-foreground space-y-1.5 mb-4">
              {[
                "Release notes and migration guides",
                "Breaking changes highlighted",
                "Feature announcements",
                "Security advisories",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2">
                  <CheckCircle className="h-3 w-3 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Link href="/changelog" className="flex items-center justify-center gap-2">
                View Changelog
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Card>
        </div>
      </section>

      {/* Support */}
      <section id="support" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Support</h2>
        
        <Card className="p-6 border-border/40">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold mb-1">Need Help?</h3>
              <p className="text-sm text-muted-foreground">
                Have questions or need assistance? Reach out through our contact form or check the community resources.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <Link href="/contact">Contact Support</Link>
              </Button>
              <Button asChild variant="outline">
                <a href="https://github.com/VulnRadar/vulnradar.dev" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>
              </Button>
            </div>
          </div>
        </Card>

        {/* Version Info */}
        <Card className="p-4 border-border/40 bg-card/30">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span><strong>App Version:</strong> {APP_VERSION}</span>
              <span><strong>Engine:</strong> {ENGINE_VERSION}</span>
              <span><strong>API:</strong> v2</span>
            </div>
            <a 
              href={`${APP_URL}/api/version`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Check version status →
            </a>
          </div>
        </Card>
      </section>
    </div>
  )
}
