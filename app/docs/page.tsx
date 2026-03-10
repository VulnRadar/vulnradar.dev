"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { BookOpen, Zap, Code2, Shield, Globe, Clock, Key, Terminal, FileCode, Layers } from "lucide-react"
import { APP_NAME, APP_URL, APP_VERSION, ENGINE_VERSION, TOTAL_CHECKS_LABEL } from "@/lib/constants"

export default function DocsPage() {
  return (
    <div className="space-y-10">
      {/* Hero Section */}
      <div className="border-b border-border pb-8">
        <Badge variant="outline" className="mb-4 text-primary border-primary/30">v{APP_VERSION}</Badge>
        <h1 className="text-4xl font-bold mb-3 text-balance">{APP_NAME} Documentation</h1>
        <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
          Complete guide to using {APP_NAME} for web vulnerability scanning. Learn how to integrate our API, 
          self-host the platform, and build custom security workflows.
        </p>
      </div>

      {/* Key Features Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="flex items-start gap-3 p-4 rounded-lg bg-card/50 border border-border/40">
          <Shield className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">{TOTAL_CHECKS_LABEL}</h3>
            <p className="text-xs text-muted-foreground">Comprehensive vulnerability detection engine</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-4 rounded-lg bg-card/50 border border-border/40">
          <Globe className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">Multi-Protocol Support</h3>
            <p className="text-xs text-muted-foreground">HTTP, HTTPS, WebSocket, FTP scanning</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-4 rounded-lg bg-card/50 border border-border/40">
          <Clock className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">Real-Time Results</h3>
            <p className="text-xs text-muted-foreground">Instant scan results with detailed findings</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-4 rounded-lg bg-card/50 border border-border/40">
          <Key className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">API Access</h3>
            <p className="text-xs text-muted-foreground">RESTful API with Bearer token auth</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-4 rounded-lg bg-card/50 border border-border/40">
          <Layers className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">Deep Crawl Mode</h3>
            <p className="text-xs text-muted-foreground">Scan entire sites with link discovery</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-4 rounded-lg bg-card/50 border border-border/40">
          <FileCode className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">Open Source</h3>
            <p className="text-xs text-muted-foreground">Self-host with full control</p>
          </div>
        </div>
      </div>

      {/* Main Navigation Cards */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-6 border-border/40 hover:border-primary/30 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">API Reference</h2>
              <p className="text-xs text-muted-foreground">v2 REST API</p>
            </div>
          </div>
          <p className="text-muted-foreground mb-4 text-sm">
            Complete API documentation with authentication, endpoints, code examples in cURL, JavaScript, and Python.
          </p>
          <ul className="text-xs text-muted-foreground space-y-1 mb-4">
            <li>- Bearer token authentication</li>
            <li>- Scan, history, and crawl endpoints</li>
            <li>- Rate limiting: 50 requests/day per API key</li>
            <li>- Detailed error handling</li>
          </ul>
          <Button asChild variant="outline" className="w-full">
            <Link href="/docs/api">View API Reference</Link>
          </Button>
        </Card>

        <Card className="p-6 border-border/40 hover:border-primary/30 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Code2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Setup Guide</h2>
              <p className="text-xs text-muted-foreground">Self-hosting</p>
            </div>
          </div>
          <p className="text-muted-foreground mb-4 text-sm">
            Step-by-step instructions for deploying {APP_NAME} on your own infrastructure with PostgreSQL.
          </p>
          <ul className="text-xs text-muted-foreground space-y-1 mb-4">
            <li>- Prerequisites and installation</li>
            <li>- Database and email configuration</li>
            <li>- Docker and Vercel deployment</li>
            <li>- Migration and version checking</li>
          </ul>
          <Button asChild variant="outline" className="w-full">
            <Link href="/docs/setup">View Setup Guide</Link>
          </Button>
        </Card>

        <Card className="p-6 border-border/40 hover:border-primary/30 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Terminal className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Developer Guide</h2>
              <p className="text-xs text-muted-foreground">SDKs & Integration</p>
            </div>
          </div>
          <p className="text-muted-foreground mb-4 text-sm">
            Build custom integrations, create SDKs, and access the Finding Types API for dynamic vulnerability data.
          </p>
          <ul className="text-xs text-muted-foreground space-y-1 mb-4">
            <li>- Finding Types endpoint</li>
            <li>- SDK development patterns</li>
            <li>- Official Python & TypeScript SDKs</li>
            <li>- Community contributions</li>
          </ul>
          <Button asChild variant="outline" className="w-full">
            <Link href="/docs/developers">View Developer Guide</Link>
          </Button>
        </Card>

        <Card className="p-6 border-border/40 bg-primary/5 hover:border-primary/30 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Quick Start</h2>
              <p className="text-xs text-muted-foreground">Get scanning in 2 minutes</p>
            </div>
          </div>
          <ol className="space-y-3 text-sm text-muted-foreground mb-4">
            <li className="flex gap-2">
              <span className="font-bold text-primary">1.</span>
              <span><strong className="text-foreground">Create Account</strong> - Sign up at {APP_URL.replace('https://', '')}</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-primary">2.</span>
              <span><strong className="text-foreground">Generate API Key</strong> - Profile → API Keys → Generate</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-primary">3.</span>
              <span><strong className="text-foreground">First Scan</strong> - POST to /api/v2/scan with your URL</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-primary">4.</span>
              <span><strong className="text-foreground">View Results</strong> - Detailed findings with remediation steps</span>
            </li>
          </ol>
          <div className="bg-secondary/50 p-3 rounded-lg">
            <p className="text-xs font-mono text-muted-foreground">
              curl -X POST &quot;{APP_URL}/api/v2/scan&quot; \<br />
              &nbsp;&nbsp;-H &quot;Authorization: Bearer YOUR_KEY&quot; \<br />
              &nbsp;&nbsp;-H &quot;Content-Type: application/json&quot; \<br />
              &nbsp;&nbsp;-d {'\'{\"url\": \"https://example.com\"}\''}
            </p>
          </div>
        </Card>
      </div>

      {/* Version Info */}
      <Card className="p-4 border-border/40 bg-card/30">
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span><strong>App Version:</strong> {APP_VERSION}</span>
            <span><strong>Engine:</strong> {ENGINE_VERSION}</span>
            <span><strong>API:</strong> v2 (v1 deprecated)</span>
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
    </div>
  )
}
