"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FileJson, Package, Github, ExternalLink, Zap, Lightbulb, BookOpen } from "lucide-react"
import { APP_NAME, APP_URL, APP_VERSION, TOTAL_CHECKS_LABEL } from "@/lib/config/constants"
import { useDocsContext, type TocItem } from "../layout"
import {
  DocsHero,
  DocsSection,
  CodeBlock,
  EndpointTable,
  FieldTable,
} from "@/components/docs"

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "finding-types", label: "Finding Types API" },
  { id: "building-sdks", label: "Building SDKs" },
  { id: "sdk-checklist", label: "SDK Checklist", level: 2 },
  { id: "community", label: "Community SDKs" },
  { id: "contributing", label: "Contributing" },
]

const coreEndpoints = [
  { endpoint: "/scan", method: "POST", description: "Run a security scan on a URL" },
  { endpoint: "/scan/crawl", method: "POST", description: "Deep crawl and scan multiple pages" },
  { endpoint: "/scan/crawl/discover", method: "POST", description: "Discover crawlable URLs" },
  { endpoint: "/history", method: "GET", description: "Get scan history" },
  { endpoint: "/history/:id", method: "GET", description: "Get specific scan details" },
  { endpoint: "/history/:id", method: "DELETE", description: "Delete a scan" },
]

const findingTypeFields = [
  { field: "id", type: "string", description: "Unique identifier (e.g., hsts-missing)" },
  { field: "type", type: "string", description: "Category type (e.g., security_header)" },
  { field: "title", type: "string", description: "Human-readable title for display" },
  { field: "category", type: "string", description: "UI category grouping" },
  { field: "severity", type: "string", description: "One of: critical, high, medium, low, info" },
]

const sdkChecklist = [
  "Bearer token authentication",
  "Configurable base URL",
  "Type-safe response models",
  "Error handling with typed exceptions",
  "Rate limit handling with backoff",
  "Async/await support",
  "Request/response logging option",
  "Comprehensive documentation",
  "Unit tests with mocked responses",
  "Example usage in README",
]

export default function DevelopersPage() {
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
    <div className="space-y-16">
      {/* Hero */}
      <DocsHero
        badge="SDK Development"
        title="Developer Documentation"
        description={`Build SDKs, integrations, and tools for ${APP_NAME}. Everything you need to programmatically interact with our security scanning platform.`}
        stats={[
          { value: TOTAL_CHECKS_LABEL, label: "Security Checks" },
          { value: "MIT", label: "License" },
          { value: "v2", label: "API Version" },
        ]}
      />

      {/* Finding Types API */}
      <DocsSection id="finding-types" title="Finding Types API" icon={FileJson}>
        <p className="text-muted-foreground">
          The Finding Types API returns all security check definitions. Use this to understand what findings your SDK should handle, display human-readable titles, and categorize results by severity.
        </p>

        <Card className="p-6 border-border/40">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Badge className="bg-blue-600/20 text-blue-600 border-blue-600/30 border font-mono text-xs">GET</Badge>
            <code className="text-primary font-mono text-sm">/api/v2/finding-types</code>
            <Badge variant="outline" className="text-xs ml-auto">Public - No Auth</Badge>
          </div>

          <div className="space-y-6">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Example Request</h4>
              <CodeBlock code={`curl ${APP_URL}/api/v2/finding-types`} language="bash" />
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Response</h4>
              <CodeBlock code={`{
  "version": "${APP_VERSION}",
  "count": 110,
  "types": [
    {
      "id": "hsts-missing",
      "type": "security_header",
      "title": "HSTS Header Missing",
      "category": "Security Headers",
      "severity": "medium"
    },
    {
      "id": "csp-missing",
      "type": "security_header", 
      "title": "Content Security Policy Missing",
      "category": "Security Headers",
      "severity": "medium"
    }
  ]
}`} />
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Response Fields</h4>
              <FieldTable fields={findingTypeFields} />
            </div>
          </div>
        </Card>
      </DocsSection>

      {/* Building SDKs */}
      <DocsSection id="building-sdks" title="Building SDKs" icon={Package}>
        <p className="text-muted-foreground">
          When building an SDK for {APP_NAME}, follow these guidelines to ensure consistency and compatibility.
        </p>

        <Card className="p-6 border-border/40 space-y-8">
          <div>
            <h4 className="font-semibold mb-3">1. Authentication</h4>
            <p className="text-sm text-muted-foreground mb-3">All authenticated requests require a Bearer token:</p>
            <CodeBlock code="Authorization: Bearer YOUR_API_KEY" language="http" />
          </div>

          <div>
            <h4 className="font-semibold mb-3">2. Base URL</h4>
            <p className="text-sm text-muted-foreground mb-3">Use the versioned API base URL:</p>
            <CodeBlock code={`${APP_URL}/api/v2`} language="text" />
          </div>

          <div>
            <h4 className="font-semibold mb-3">3. Core Endpoints</h4>
            <EndpointTable endpoints={coreEndpoints} />
          </div>

          <div>
            <h4 className="font-semibold mb-3">4. Error Handling</h4>
            <p className="text-sm text-muted-foreground mb-3">Handle these HTTP status codes appropriately:</p>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">200</code> - Success</li>
              <li><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">400</code> - Bad Request (invalid parameters)</li>
              <li><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">401</code> - Unauthorized (invalid API key)</li>
              <li><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">429</code> - Rate Limited</li>
              <li><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">500</code> - Server Error</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-3">5. Rate Limiting</h4>
            <p className="text-sm text-muted-foreground">
              Implement exponential backoff when receiving 429 responses. Check the{" "}
              <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">Retry-After</code> header for guidance.
              See <Link href="/docs/rate-limits" className="text-primary hover:underline">Rate Limits</Link> for details.
            </p>
          </div>
        </Card>

        {/* SDK Checklist */}
        <div id="sdk-checklist" className="scroll-mt-24">
          <Card className="p-6 border-border/40 bg-primary/5">
            <div className="flex items-center gap-3 mb-4">
              <Lightbulb className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">SDK Checklist</h3>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm text-muted-foreground">
              {sdkChecklist.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </DocsSection>

      {/* Community SDKs */}
      <DocsSection id="community" title="Community SDKs" icon={Github}>
        <div className="space-y-4">
          {/* Python SDK */}
          <Card className="p-6 border-border/40 hover:border-primary/50 transition-colors">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600/20 rounded-lg">
                  <Package className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    Python SDK
                    <Badge variant="outline" className="text-xs">Community</Badge>
                  </h3>
                  <p className="text-sm text-muted-foreground">VulnRadar/Python-SDK</p>
                </div>
              </div>
              <a
                href="https://github.com/VulnRadar/Python-SDK"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="h-5 w-5" />
              </a>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Community-maintained Python SDK for VulnRadar API integration. Supports async operations and comprehensive vulnerability scanning.
            </p>
            <CodeBlock
              code={`from vulnradar import VulnRadar

client = VulnRadar(api_key="your-api-key")
result = client.scan("https://example.com")

print(f"Total findings: {result.summary.total}")
print(f"Critical: {result.summary.critical}")
for finding in result.findings:
    print(f"[{finding.severity.value.upper()}] {finding.title}")`}
              language="python"
            />
          </Card>
        </div>

        <Card className="p-6 border-border/40 bg-secondary/30">
          <h4 className="font-semibold mb-3">Building Your Own SDK?</h4>
          <p className="text-sm text-muted-foreground mb-4">
            We welcome community-built SDKs in any language! If you build one, let us know and we&apos;ll feature it here.
          </p>
          <div className="p-3 bg-card rounded-lg border border-border/40 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Requirements:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Use the <Link href="/docs/api" className="text-primary hover:underline">v2 API</Link> for all requests</li>
              <li>Support Bearer token authentication</li>
              <li>Include comprehensive documentation</li>
              <li>Open source with MIT or compatible license</li>
              <li>Publish to your language&apos;s package manager</li>
            </ul>
          </div>
        </Card>
      </DocsSection>

      {/* Contributing */}
      <DocsSection id="contributing" title="Contributing" icon={BookOpen}>
        <Card className="p-6 border-primary/50 bg-primary/5">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <h3 className="font-semibold mb-2">Open Source</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {APP_NAME} is open source and welcomes contributions. Whether it&apos;s bug fixes, new features, documentation improvements, or SDK development - we appreciate all contributions.
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href="https://github.com/VulnRadar/vulnradar.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-background border border-border text-sm font-medium hover:bg-muted transition-colors"
                >
                  <Github className="h-4 w-4" />
                  View on GitHub
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </a>
              </div>
            </div>
          </div>
        </Card>
      </DocsSection>
    </div>
  )
}
