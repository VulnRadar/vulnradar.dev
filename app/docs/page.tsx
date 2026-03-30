"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Shield, Globe, Clock, Key, Layers, FileCode, Zap, Code2, Terminal, BookOpen, ArrowRight, CheckCircle } from "lucide-react"
import { APP_NAME, APP_URL, APP_VERSION, ENGINE_VERSION, TOTAL_CHECKS_LABEL } from "@/lib/config/constants"
import { useDocsContext, type TocItem } from "./layout"
import {
  DocsHero,
  DocsSection,
  DocsFeatureGrid,
  DocsSteps,
  CodeBlock,
  CopyButton,
  type Feature,
  type Step,
} from "@/components/docs"

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "features", label: "Features" },
  { id: "quick-start", label: "Quick Start" },
  { id: "documentation", label: "Documentation" },
  { id: "support", label: "Support" },
]

const platformFeatures: Feature[] = [
  { icon: Shield, title: TOTAL_CHECKS_LABEL, description: "Comprehensive vulnerability detection engine" },
  { icon: Globe, title: "Multi-Protocol Support", description: "HTTP, HTTPS, WebSocket, FTP scanning" },
  { icon: Clock, title: "Real-Time Results", description: "Instant scan results with detailed findings" },
  { icon: Key, title: "API Access", description: "RESTful API with Bearer token authentication" },
  { icon: Layers, title: "Deep Crawl Mode", description: "Scan entire sites with automatic link discovery" },
  { icon: FileCode, title: "Open Source", description: "MIT licensed - self-host with full control" },
]

const quickStartSteps: Step[] = [
  { step: 1, title: "Create Account", description: `Sign up at ${APP_URL.replace("https://", "")}` },
  { step: 2, title: "Generate API Key", description: "Profile → API Keys → Generate New Key" },
  { step: 3, title: "Make Your First Scan", description: "POST to /api/v2/scan with your target URL" },
  { step: 4, title: "View Results", description: "Detailed findings with severity and remediation steps" },
]

const docSections = [
  {
    icon: Zap,
    title: "API Reference",
    subtitle: "v2 REST API",
    description: "Complete API documentation with authentication, endpoints, code examples in cURL, JavaScript, and Python.",
    features: [
      "Bearer token authentication",
      "Scan, history, and crawl endpoints",
      "Rate limiting (varies by plan)",
      "Detailed error handling",
    ],
    href: "/docs/api",
  },
  {
    icon: Code2,
    title: "Setup Guide",
    subtitle: "Self-hosting",
    description: `Step-by-step instructions for deploying ${APP_NAME} on your own infrastructure with PostgreSQL.`,
    features: [
      "Prerequisites and installation",
      "Database and email configuration",
      "Docker and Vercel deployment",
      "Migration and version checking",
    ],
    href: "/docs/setup",
  },
  {
    icon: Terminal,
    title: "Developer Guide",
    subtitle: "SDKs & Integration",
    description: "Build custom integrations, create SDKs, and access the Finding Types API for dynamic vulnerability data.",
    features: [
      "Finding Types endpoint",
      "SDK development patterns",
      "Official Python & TypeScript SDKs",
      "Community contributions",
    ],
    href: "/docs/developers",
  },
  {
    icon: BookOpen,
    title: "Changelog",
    subtitle: "Version History",
    description: `Track all updates, new features, bug fixes, and improvements across ${APP_NAME} versions.`,
    features: [
      "Release notes and migration guides",
      "Breaking changes highlighted",
      "Feature announcements",
      "Security advisories",
    ],
    href: "/changelog",
  },
]

export default function DocsPage() {
  const { setActiveSection, setTocItems } = useDocsContext()
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    setTocItems(tocItems)
    return () => setTocItems([])
  }, [setTocItems])

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
      <DocsHero
        badge={`v${APP_VERSION}`}
        title={`${APP_NAME} Documentation`}
        description={`Complete guide to using ${APP_NAME} for web vulnerability scanning. Learn how to integrate our API, self-host the platform, and build custom security workflows.`}
        stats={[
          { value: TOTAL_CHECKS_LABEL, label: "Security Checks" },
          { value: "v2", label: "API Version" },
          { value: "6", label: "Protocols" },
          { value: "MIT", label: "License" },
        ]}
      />

      {/* Key Features */}
      <DocsSection id="features" title="Platform Features">
        <DocsFeatureGrid features={platformFeatures} />
      </DocsSection>

      {/* Quick Start */}
      <DocsSection id="quick-start" title="Quick Start">
        <p className="text-sm sm:text-base text-muted-foreground">Get scanning in under 2 minutes.</p>

        <Card className="p-4 sm:p-6 border-border/40 bg-primary/5">
          <div className="grid lg:grid-cols-2 gap-6 lg:gap-8">
            <DocsSteps steps={quickStartSteps} />

            <div className="relative">
              <div className="text-xs font-medium text-muted-foreground mb-2">Example Request</div>
              <pre className="bg-secondary/50 p-4 rounded-lg overflow-x-auto text-sm border border-border/40">
                <code>{curlExample}</code>
              </pre>
              <CopyButton text={curlExample} className="absolute top-9 right-3" />
            </div>
          </div>
        </Card>
      </DocsSection>

      {/* Documentation Navigation */}
      <DocsSection id="documentation" title="Documentation">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {docSections.map((section) => (
            <Card
              key={section.href}
              className="p-4 sm:p-6 border-border/40 hover:border-accent transition-all duration-200 group"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 group-hover:bg-accent transition-colors">
                  <section.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">{section.title}</h3>
                  <p className="text-xs text-muted-foreground">{section.subtitle}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-4">{section.description}</p>
              <ul className="text-xs text-muted-foreground space-y-1.5 mb-4">
                {section.features.map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckCircle className="h-3 w-3 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button
                asChild
                variant="outline"
                className="w-full group-hover:bg-accent group-hover:text-accent-foreground transition-colors"
              >
                <Link href={section.href} className="flex items-center justify-center gap-2">
                  View {section.title}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </Card>
          ))}
        </div>
      </DocsSection>

      {/* Support */}
      <DocsSection id="support" title="Support">
        <Card className="p-4 sm:p-6 border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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

        <Card className="p-4 border-border/40 bg-card/30">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span>
                <strong>App Version:</strong> {APP_VERSION}
              </span>
              <span>
                <strong>Engine:</strong> {ENGINE_VERSION}
              </span>
              <span>
                <strong>API:</strong> v2
              </span>
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
      </DocsSection>
    </div>
  )
}
