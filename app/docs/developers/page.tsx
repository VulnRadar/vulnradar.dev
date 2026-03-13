"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { APP_NAME, APP_URL, APP_VERSION, ENGINE_VERSION, TOTAL_CHECKS_LABEL } from "@/lib/constants"
import { Code2, Package, Github, ExternalLink, Zap, FileJson, Terminal, Copy, Check, BookOpen, Lightbulb } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useDocsContext, type TocItem } from "../layout"
import { cn } from "@/lib/utils"

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "finding-types", label: "Finding Types API" },
  { id: "building-sdks", label: "Building SDKs" },
  { id: "sdk-checklist", label: "SDK Checklist", level: 2 },
  { id: "official-sdks", label: "Official SDKs" },
  { id: "community", label: "Community SDKs" },
  { id: "contributing", label: "Contributing" },
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

function CodeBlock({ code, language = "json" }: { code: string; language?: string }) {
  return (
    <div className="relative group">
      <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm border border-border/40">
        <code className={`language-${language}`}>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  )
}

export default function DevelopersPage() {
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

  return (
    <div className="space-y-16">
      {/* Header */}
      <section id="overview" className="scroll-mt-24">
        <Badge variant="outline" className="mb-3 sm:mb-4 text-primary border-primary/30">SDK Development</Badge>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-3 sm:mb-4">Developer Documentation</h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-3xl">
          Build SDKs, integrations, and tools for {APP_NAME}. Everything you need to programmatically 
          interact with our security scanning platform.
        </p>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-6 sm:mt-8">
          <div className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40">
            <div className="text-lg sm:text-2xl font-bold text-primary mb-0.5 sm:mb-1">{TOTAL_CHECKS_LABEL}</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground">Security Checks</div>
          </div>
          <div className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40">
            <div className="text-lg sm:text-2xl font-bold text-primary mb-0.5 sm:mb-1">MIT</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground">License</div>
          </div>
          <div className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40">
            <div className="text-lg sm:text-2xl font-bold text-primary mb-0.5 sm:mb-1">v2</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground">API Version</div>
          </div>
        </div>
      </section>

      {/* Finding Types API */}
      <section id="finding-types" className="scroll-mt-24 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileJson className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Finding Types API</h2>
        </div>
        
        <p className="text-muted-foreground">
          The Finding Types API returns all security check definitions. Use this to understand what findings 
          your SDK should handle, display human-readable titles, categorize results, and show severity levels.
        </p>

        <Card className="p-6 border-border/40">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Badge className="bg-blue-600/20 text-blue-600 border-blue-600/30 border font-mono text-xs">GET</Badge>
            <code className="text-primary font-mono text-sm">/api/v1/finding-types</code>
            <Badge variant="outline" className="text-xs ml-auto">Public - No Auth</Badge>
          </div>

          <div className="space-y-6">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Example Request</h4>
              <CodeBlock code={`curl ${APP_URL}/api/v1/finding-types`} language="bash" />
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Response</h4>
              <CodeBlock code={`{
  "version": "${APP_VERSION}",
  "count": "...",
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
    },
    {
      "id": "cookie-secure-missing",
      "type": "cookie_security",
      "title": "Cookie Missing Secure Flag",
      "category": "Cookie Security",
      "severity": "medium"
    }
    // ... more types
  ]
}`} />
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Response Fields</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-semibold text-xs">Field</th>
                      <th className="text-left py-2 font-semibold text-xs">Type</th>
                      <th className="text-left py-2 font-semibold text-xs">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    <tr className="border-b border-border/50">
                      <td className="py-2.5"><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">id</code></td>
                      <td className="py-2.5 text-xs">string</td>
                      <td className="py-2.5 text-xs">Unique identifier (e.g., <code className="bg-secondary px-1 rounded">hsts-missing</code>)</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2.5"><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">type</code></td>
                      <td className="py-2.5 text-xs">string</td>
                      <td className="py-2.5 text-xs">Category type (e.g., <code className="bg-secondary px-1 rounded">security_header</code>)</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2.5"><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">title</code></td>
                      <td className="py-2.5 text-xs">string</td>
                      <td className="py-2.5 text-xs">Human-readable title for display</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2.5"><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">category</code></td>
                      <td className="py-2.5 text-xs">string</td>
                      <td className="py-2.5 text-xs">UI category grouping</td>
                    </tr>
                    <tr>
                      <td className="py-2.5"><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">severity</code></td>
                      <td className="py-2.5 text-xs">string</td>
                      <td className="py-2.5 text-xs">One of: critical, high, medium, low, info</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Building SDKs */}
      <section id="building-sdks" className="scroll-mt-24 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Package className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Building SDKs</h2>
        </div>
        
        <p className="text-muted-foreground">
          When building an SDK for {APP_NAME}, follow these guidelines to ensure consistency and compatibility.
        </p>

        <Card className="p-6 border-border/40 space-y-8">
          <div>
            <h4 className="font-semibold mb-3">1. Authentication</h4>
            <p className="text-sm text-muted-foreground mb-3">
              All authenticated requests require a Bearer token in the Authorization header:
            </p>
            <CodeBlock code="Authorization: Bearer YOUR_API_KEY" language="http" />
          </div>

          <div>
            <h4 className="font-semibold mb-3">2. Base URL</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Use the versioned API base URL for all endpoints:
            </p>
            <CodeBlock code={`${APP_URL}/api/v2`} language="text" />
          </div>

          <div>
            <h4 className="font-semibold mb-3">3. Core Endpoints</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 font-semibold text-xs">Endpoint</th>
                    <th className="text-left py-2 font-semibold text-xs">Method</th>
                    <th className="text-left py-2 font-semibold text-xs">Description</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  {[
                    { endpoint: "/scan", method: "POST", description: "Run a security scan on a URL" },
                    { endpoint: "/scan/crawl", method: "POST", description: "Deep crawl and scan multiple pages" },
                    { endpoint: "/scan/crawl/discover", method: "POST", description: "Discover crawlable URLs" },
                    { endpoint: "/history", method: "GET", description: "Get scan history" },
                    { endpoint: "/history/:id", method: "GET", description: "Get specific scan details" },
                    { endpoint: "/history/:id", method: "DELETE", description: "Delete a scan" },
                  ].map((row) => (
                    <tr key={row.endpoint + row.method} className="border-b border-border/50">
                      <td className="py-2.5"><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">{row.endpoint}</code></td>
                      <td className="py-2.5 text-xs">{row.method}</td>
                      <td className="py-2.5 text-xs">{row.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-3">4. Error Handling</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Handle these HTTP status codes appropriately:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">200</code> - Success</li>
              <li><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">400</code> - Bad Request (invalid parameters)</li>
              <li><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">401</code> - Unauthorized (invalid API key)</li>
              <li><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">429</code> - Rate Limited (50 req/day)</li>
              <li><code className="bg-secondary px-1.5 py-0.5 rounded text-xs">500</code> - Server Error</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-3">5. Rate Limiting</h4>
            <p className="text-sm text-muted-foreground">
              Implement exponential backoff when receiving 429 responses. Check the{" "}
              <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">Retry-After</code> header 
              for guidance on when to retry. See{" "}
              <Link href="/docs/api#rate-limiting" className="text-primary hover:underline">Rate Limiting</Link>{" "}
              documentation for details.
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
              {[
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
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* Official SDKs */}
      <section id="official-sdks" className="scroll-mt-24 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Official SDKs</h2>
        </div>

        <div className="grid gap-4">
          {/* Python SDK */}
          <Card className="p-6 border-border/40">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600/20 rounded-lg">
                  <Terminal className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    Python SDK
                    <Badge variant="outline" className="text-xs">In Development</Badge>
                  </h3>
                  <p className="text-sm text-muted-foreground">vulnradar-py</p>
                </div>
              </div>
              <a 
                href="https://github.com/VulnRadar/vulnradar-py" 
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="h-5 w-5" />
              </a>
            </div>
            <CodeBlock code={`# Coming soon
pip install vulnradar

from vulnradar import VulnRadar

client = VulnRadar(api_key="your-api-key")
result = client.scan("https://example.com")

print(f"Found {len(result.findings)} vulnerabilities")
for finding in result.findings:
    print(f"[{finding.severity}] {finding.title}")`} language="python" />
          </Card>

          {/* TypeScript SDK */}
          <Card className="p-6 border-border/40">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600/20 rounded-lg">
                  <Code2 className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    TypeScript SDK
                    <Badge variant="outline" className="text-xs">Planned</Badge>
                  </h3>
                  <p className="text-sm text-muted-foreground">@vulnradar/sdk</p>
                </div>
              </div>
            </div>
            <CodeBlock code={`// Coming soon
npm install @vulnradar/sdk

import { VulnRadar } from '@vulnradar/sdk';

const client = new VulnRadar({ apiKey: 'your-api-key' });
const result = await client.scan('https://example.com');

console.log(\`Found \${result.findings.length} vulnerabilities\`);
result.findings.forEach(f => console.log(\`[\${f.severity}] \${f.title}\`));`} language="typescript" />
          </Card>
        </div>
      </section>

      {/* Community SDKs */}
      <section id="community" className="scroll-mt-24 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Github className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Community SDKs</h2>
        </div>

        <Card className="p-6 border-border/40">
          <p className="text-muted-foreground mb-6">
            Building an SDK for {APP_NAME}? We&apos;d love to feature it here! Community-built SDKs in any language are welcome.
          </p>
          
          <div className="p-4 bg-secondary/30 rounded-lg">
            <h4 className="font-semibold mb-3 text-sm">Submit Your SDK</h4>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Publish your SDK to a package manager (npm, PyPI, RubyGems, etc.)</li>
              <li>Open source it on GitHub with an MIT or compatible license</li>
              <li>Include documentation and usage examples</li>
              <li>Contact us via the <Link href="/contact" className="text-primary hover:underline">contact form</Link> or open a GitHub issue</li>
            </ol>
          </div>
          
          <div className="mt-6 text-center py-8 text-muted-foreground text-sm border border-dashed border-border/60 rounded-lg">
            No community SDKs listed yet. Be the first to build one!
          </div>
        </Card>
      </section>

      {/* Contributing */}
      <section id="contributing" className="scroll-mt-24 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Contributing</h2>
        </div>

        <Card className="p-6 border-primary/50 bg-primary/5">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <h3 className="font-semibold mb-2">Open Source</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {APP_NAME} is open source and welcomes contributions. Whether it&apos;s bug fixes, 
                new features, documentation improvements, or SDK development - we appreciate all contributions.
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
      </section>
    </div>
  )
}
