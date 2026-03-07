import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { APP_NAME, APP_URL } from "@/lib/constants"
import { Code2, Package, Github, ExternalLink, Zap, FileJson, Terminal } from "lucide-react"
import Link from "next/link"

export const metadata = {
  title: `Developer Documentation | ${APP_NAME}`,
  description: `Build SDKs and integrations for ${APP_NAME}. Access finding types, API specifications, and SDK development guidelines.`,
}

export default function DevelopersPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight mb-4">Developer Documentation</h1>
        <p className="text-lg text-muted-foreground">
          Build SDKs, integrations, and tools for {APP_NAME}. Everything you need to programmatically interact with our security scanning platform.
        </p>
      </div>

      {/* Overview */}
      <section id="overview" className="scroll-mt-24">
        <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
          <Code2 className="h-6 w-6 text-primary" />
          Overview
        </h2>
        <Card className="p-6 border-border/40">
          <p className="text-muted-foreground mb-4">
            {APP_NAME} provides a comprehensive REST API for security scanning. As a developer, you can build SDKs in any language to interact with our platform. This documentation covers the resources available for SDK development.
          </p>
          <div className="grid gap-4 md:grid-cols-3 mt-6">
            <div className="p-4 bg-secondary/30 rounded-lg">
              <h3 className="font-semibold mb-2">API v1</h3>
              <p className="text-sm text-muted-foreground">All authenticated endpoints use <code className="bg-secondary px-1 rounded">/api/v1/</code> prefix</p>
            </div>
            <div className="p-4 bg-secondary/30 rounded-lg">
              <h3 className="font-semibold mb-2">110+ Checks</h3>
              <p className="text-sm text-muted-foreground">Security checks with full metadata available via API</p>
            </div>
            <div className="p-4 bg-secondary/30 rounded-lg">
              <h3 className="font-semibold mb-2">Open Source</h3>
              <p className="text-sm text-muted-foreground">MIT licensed - build and distribute SDKs freely</p>
            </div>
          </div>
        </Card>
      </section>

      {/* Finding Types API */}
      <section id="finding-types" className="scroll-mt-24">
        <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
          <FileJson className="h-6 w-6 text-primary" />
          Finding Types API
        </h2>
        <Card className="p-6 border-border/40">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Badge className="bg-blue-600/20 text-blue-700 hover:bg-blue-600/20">GET</Badge>
              <code className="text-primary font-mono">/api/v1/finding-types</code>
            </div>
            <span className="text-xs text-muted-foreground">Public Endpoint - No Auth Required</span>
          </div>
          <p className="text-muted-foreground mb-4">
            Returns all security check definitions. Use this to understand what findings your SDK should handle, display human-readable titles, categorize results, and show severity levels.
          </p>

          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-sm mb-2">Example Request</h4>
              <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{`curl ${APP_URL}/api/v1/finding-types`}</code></pre>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Response (200 OK)</h4>
              <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{`{
  "version": "2.0.0",
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
    },
    {
      "id": "cookie-secure-missing",
      "type": "cookie_security",
      "title": "Cookie Missing Secure Flag",
      "category": "Cookie Security",
      "severity": "medium"
    }
    // ... 107 more types
  ]
}`}</code></pre>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Response Fields</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-semibold">Field</th>
                      <th className="text-left py-2 font-semibold">Type</th>
                      <th className="text-left py-2 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    <tr className="border-b border-border/50">
                      <td className="py-2"><code className="bg-secondary px-1 rounded">id</code></td>
                      <td className="py-2">string</td>
                      <td className="py-2">Unique identifier for the finding (e.g., <code className="bg-secondary px-1 rounded">hsts-missing</code>)</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2"><code className="bg-secondary px-1 rounded">type</code></td>
                      <td className="py-2">string</td>
                      <td className="py-2">Finding category type (e.g., <code className="bg-secondary px-1 rounded">security_header</code>, <code className="bg-secondary px-1 rounded">cookie_security</code>)</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2"><code className="bg-secondary px-1 rounded">title</code></td>
                      <td className="py-2">string</td>
                      <td className="py-2">Human-readable title for display</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2"><code className="bg-secondary px-1 rounded">category</code></td>
                      <td className="py-2">string</td>
                      <td className="py-2">UI category grouping</td>
                    </tr>
                    <tr>
                      <td className="py-2"><code className="bg-secondary px-1 rounded">severity</code></td>
                      <td className="py-2">string</td>
                      <td className="py-2">Severity level: <code className="bg-secondary px-1 rounded">critical</code>, <code className="bg-secondary px-1 rounded">high</code>, <code className="bg-secondary px-1 rounded">medium</code>, <code className="bg-secondary px-1 rounded">low</code>, <code className="bg-secondary px-1 rounded">info</code></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Building SDKs */}
      <section id="building-sdks" className="scroll-mt-24">
        <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
          <Package className="h-6 w-6 text-primary" />
          Building SDKs
        </h2>
        <Card className="p-6 border-border/40">
          <p className="text-muted-foreground mb-6">
            When building an SDK for {APP_NAME}, follow these guidelines to ensure consistency and compatibility.
          </p>

          <div className="space-y-6">
            <div>
              <h4 className="font-semibold mb-2">1. Authentication</h4>
              <p className="text-sm text-muted-foreground mb-2">
                All authenticated requests require a Bearer token in the Authorization header:
              </p>
              <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{`Authorization: Bearer YOUR_API_KEY`}</code></pre>
            </div>

            <div>
              <h4 className="font-semibold mb-2">2. Base URL</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Use the versioned API base URL for all authenticated endpoints:
              </p>
              <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{`${APP_URL}/api/v1`}</code></pre>
            </div>

            <div>
              <h4 className="font-semibold mb-2">3. Core Endpoints</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-semibold">Endpoint</th>
                      <th className="text-left py-2 font-semibold">Method</th>
                      <th className="text-left py-2 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    <tr className="border-b border-border/50">
                      <td className="py-2"><code className="bg-secondary px-1 rounded">/scan</code></td>
                      <td className="py-2">POST</td>
                      <td className="py-2">Run a security scan on a URL</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2"><code className="bg-secondary px-1 rounded">/scan/bulk</code></td>
                      <td className="py-2">POST</td>
                      <td className="py-2">Scan multiple URLs in one request</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2"><code className="bg-secondary px-1 rounded">/history</code></td>
                      <td className="py-2">GET</td>
                      <td className="py-2">Get scan history</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2"><code className="bg-secondary px-1 rounded">/history/:id</code></td>
                      <td className="py-2">GET</td>
                      <td className="py-2">Get specific scan details</td>
                    </tr>
                    <tr>
                      <td className="py-2"><code className="bg-secondary px-1 rounded">/finding-types</code></td>
                      <td className="py-2">GET</td>
                      <td className="py-2">Get all finding type definitions (public)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">4. Error Handling</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Handle these HTTP status codes appropriately:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li><code className="bg-secondary px-1 rounded">200</code> - Success</li>
                <li><code className="bg-secondary px-1 rounded">400</code> - Bad Request (invalid parameters)</li>
                <li><code className="bg-secondary px-1 rounded">401</code> - Unauthorized (invalid or missing API key)</li>
                <li><code className="bg-secondary px-1 rounded">429</code> - Rate Limited</li>
                <li><code className="bg-secondary px-1 rounded">500</code> - Server Error</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-2">5. Rate Limiting</h4>
              <p className="text-sm text-muted-foreground">
                Implement exponential backoff when receiving 429 responses. Check the <code className="bg-secondary px-1 rounded">Retry-After</code> header for guidance on when to retry.
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* Official SDKs */}
      <section id="official-sdks" className="scroll-mt-24">
        <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" />
          Official SDKs
        </h2>
        <div className="grid gap-4">
          <Card className="p-6 border-border/40">
            <div className="flex items-start justify-between">
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
              <Link 
                href="https://github.com/VulnRadar/vulnradar-py" 
                target="_blank"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="h-5 w-5" />
              </Link>
            </div>
            <div className="mt-4">
              <p className="text-sm text-muted-foreground mb-3">
                The official Python SDK for {APP_NAME}. Currently in active development - contributions welcome!
              </p>
              <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{`# Coming soon
pip install vulnradar

from vulnradar import VulnRadar

client = VulnRadar(api_key="your-api-key")
result = client.scan("https://example.com")
print(result.findings)`}</code></pre>
            </div>
          </Card>
        </div>
      </section>

      {/* Community SDKs */}
      <section id="community" className="scroll-mt-24">
        <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
          <Github className="h-6 w-6 text-primary" />
          Community SDKs
        </h2>
        <Card className="p-6 border-border/40">
          <p className="text-muted-foreground mb-4">
            Building an SDK for {APP_NAME}? We would love to feature it here! Community-built SDKs in any language are welcome.
          </p>
          <div className="p-4 bg-secondary/30 rounded-lg">
            <h4 className="font-semibold mb-2">Submit Your SDK</h4>
            <p className="text-sm text-muted-foreground mb-3">
              To have your SDK listed here:
            </p>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Publish your SDK to a package manager (npm, PyPI, RubyGems, etc.)</li>
              <li>Open source it on GitHub with an MIT or compatible license</li>
              <li>Include documentation and examples</li>
              <li>Contact us via the <Link href="/contact" className="text-primary hover:underline">contact form</Link> or open a GitHub issue</li>
            </ol>
          </div>
          <div className="mt-4 text-center text-muted-foreground text-sm">
            No community SDKs listed yet. Be the first to build one!
          </div>
        </Card>
      </section>

      {/* v2 Notice */}
      <section className="scroll-mt-24">
        <Card className="p-6 border-primary/50 bg-primary/5">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <h3 className="font-semibold mb-1">v2.0 Coming Soon</h3>
              <p className="text-sm text-muted-foreground">
                Version 2.0 will bring major improvements to the API including new endpoints, enhanced scan results, and more granular controls. The /api/v1/ endpoints will remain supported during the transition. Stay tuned for migration guides.
              </p>
            </div>
          </div>
        </Card>
      </section>
    </div>
  )
}
