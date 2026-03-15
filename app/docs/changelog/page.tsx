"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { APP_NAME, APP_VERSION } from "@/lib/constants"
import { useEffect, useRef } from "react"
import { useDocsContext, type TocItem } from "../layout"
import { 
  Sparkles, 
  Bug, 
  Wrench, 
  Shield,
  Zap,
  Database,
  Settings,
  FileCode
} from "lucide-react"

const tocItems: TocItem[] = [
  { id: "v2.0.3", label: "v2.0.3 (Current)" },
  { id: "v2.0.2", label: "v2.0.2" },
  { id: "v2.0.1", label: "v2.0.1" },
  { id: "v2.0.0", label: "v2.0.0" },
]

interface ChangelogEntry {
  version: string
  date: string
  type: "major" | "minor" | "patch"
  highlights?: string[]
  changes: {
    category: "added" | "changed" | "fixed" | "security" | "performance" | "deprecated"
    items: string[]
  }[]
}

const changelog: ChangelogEntry[] = [
  {
    version: "2.0.3",
    date: "2026-03-15",
    type: "patch",
    highlights: [
      "310+ security checks with expanded credential detection",
      "Simplified configuration system - config.yaml is now the single source of truth",
      "Improved documentation with complete .env.example references"
    ],
    changes: [
      {
        category: "added",
        items: [
          "90+ new security checks covering credentials exposure (AWS, Stripe, GitHub, npm, Docker Hub, etc.)",
          "New CSP directive checks (base-uri, form-action, frame-src, upgrade-insecure-requests)",
          "Cookie security checks (__Host- prefix, Partitioned attribute, broad domain detection)",
          "API security checks (JWT in URL, Bearer token exposure, JSONP detection)",
          "DOM security checks (XSS sinks, prototype pollution, DOM clobbering)",
          "New config-values.ts module for circular dependency-free config loading",
          "Application Configuration section in setup docs",
          "Scroll overflow handling for modals and toast notifications"
        ]
      },
      {
        category: "changed",
        items: [
          "Configuration system refactored - config.yaml is now the single source of truth",
          "Removed NEXT_PUBLIC_APP_VERSION and NEXT_PUBLIC_ENGINE_VERSION environment variables",
          "constants.ts now imports from config-values.ts instead of config.ts",
          "DEFAULT_CONFIG now uses config-values.ts instead of hardcoded values",
          "Updated setup docs with complete .env.example including Stripe and Discord OAuth",
          "Docker setup docs now include full environment variable reference",
          "Total checks label updated to 310+"
        ]
      },
      {
        category: "fixed",
        items: [
          "Hydration mismatch errors when config.yaml values changed during development",
          "Bulk scan helper text no longer incorrectly states 'must include https://'",
          "v1 API references in docs updated to v2",
          "Missing copy button on Environment Configuration code blocks"
        ]
      }
    ]
  },
  {
    version: "2.0.2",
    date: "2026-03-14",
    type: "patch",
    changes: [
      {
        category: "added",
        items: [
          "Comprehensive security checks expansion to 175+",
          "Version checking system with GitHub releases integration",
          "Beta mode configuration for testing deployments"
        ]
      },
      {
        category: "changed",
        items: [
          "Improved scan result categorization",
          "Enhanced error messages for API endpoints"
        ]
      },
      {
        category: "fixed",
        items: [
          "Rate limiting edge cases for bulk scans",
          "Session cleanup timing issues"
        ]
      }
    ]
  },
  {
    version: "2.0.1",
    date: "2026-03-10",
    type: "patch",
    changes: [
      {
        category: "fixed",
        items: [
          "Docker compose database connection issues",
          "SMTP configuration validation",
          "API key encryption key generation instructions"
        ]
      },
      {
        category: "security",
        items: [
          "Updated dependencies to address security advisories"
        ]
      }
    ]
  },
  {
    version: "2.0.0",
    date: "2026-03-01",
    type: "major",
    highlights: [
      "Complete rewrite with Next.js 15 and React 19",
      "New API v2 with improved performance and features",
      "Team collaboration with role-based access control"
    ],
    changes: [
      {
        category: "added",
        items: [
          "API v2 with breaking changes from v1",
          "Team collaboration features with invites and roles",
          "Two-factor authentication (TOTP)",
          "Discord OAuth sign-in",
          "Stripe billing integration",
          "Scheduled scans with cron support",
          "Webhook notifications",
          "PDF report generation",
          "Bulk scanning (up to 100 URLs)",
          "Scan tags and notes",
          "Dark/light theme support",
          "Self-hosting support with Docker"
        ]
      },
      {
        category: "changed",
        items: [
          "Complete UI redesign with shadcn/ui components",
          "Migrated from API v1 to v2 (v1 deprecated)",
          "Improved scan engine with 150+ initial checks",
          "Better error handling and user feedback"
        ]
      },
      {
        category: "deprecated",
        items: [
          "API v1 endpoints (still functional but not recommended)"
        ]
      }
    ]
  }
]

const categoryConfig = {
  added: { label: "Added", color: "text-green-500", bg: "bg-green-500/10", icon: Sparkles },
  changed: { label: "Changed", color: "text-blue-500", bg: "bg-blue-500/10", icon: Wrench },
  fixed: { label: "Fixed", color: "text-orange-500", bg: "bg-orange-500/10", icon: Bug },
  security: { label: "Security", color: "text-red-500", bg: "bg-red-500/10", icon: Shield },
  performance: { label: "Performance", color: "text-purple-500", bg: "bg-purple-500/10", icon: Zap },
  deprecated: { label: "Deprecated", color: "text-yellow-500", bg: "bg-yellow-500/10", icon: Settings }
}

export default function ChangelogPage() {
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

  return (
    <div className="space-y-12">
      {/* Header */}
      <section>
        <Badge variant="outline" className="mb-3 text-primary border-primary/30">v{APP_VERSION}</Badge>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-3">{APP_NAME} Changelog</h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-3xl">
          Track all changes, improvements, and fixes across {APP_NAME} releases.
        </p>
      </section>

      {/* Changelog Entries */}
      <div className="space-y-8">
        {changelog.map((entry, index) => (
          <section key={entry.version} id={`v${entry.version}`} className="scroll-mt-24">
            <Card className="p-6 border-border/40">
              {/* Version Header */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <h2 className="text-xl font-bold">v{entry.version}</h2>
                <Badge 
                  variant={entry.type === "major" ? "default" : "secondary"}
                  className={entry.type === "major" ? "bg-primary" : ""}
                >
                  {entry.type === "major" ? "Major Release" : entry.type === "minor" ? "Minor" : "Patch"}
                </Badge>
                {index === 0 && (
                  <Badge variant="outline" className="text-green-500 border-green-500/30">Current</Badge>
                )}
                <span className="text-sm text-muted-foreground ml-auto">{entry.date}</span>
              </div>

              {/* Highlights */}
              {entry.highlights && entry.highlights.length > 0 && (
                <div className="mb-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <h3 className="text-sm font-semibold text-primary mb-2">Highlights</h3>
                  <ul className="space-y-1">
                    {entry.highlights.map((highlight, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <Sparkles className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                        {highlight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Changes by Category */}
              <div className="space-y-4">
                {entry.changes.map((change) => {
                  const config = categoryConfig[change.category]
                  const Icon = config.icon
                  return (
                    <div key={change.category}>
                      <div className={`inline-flex items-center gap-2 px-2 py-1 rounded-md ${config.bg} mb-2`}>
                        <Icon className={`h-4 w-4 ${config.color}`} />
                        <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
                      </div>
                      <ul className="space-y-1 ml-1">
                        {change.items.map((item, i) => (
                          <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                            <span className="text-muted-foreground/50 mt-1.5">•</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </Card>
          </section>
        ))}
      </div>
    </div>
  )
}
