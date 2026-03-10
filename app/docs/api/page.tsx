"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, CheckCircle, Copy, Check } from "lucide-react"
import { APP_URL, APP_NAME, APP_VERSION, ENGINE_VERSION } from "@/lib/constants"
import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { useDocsContext, type TocItem } from "../layout"

// Define all endpoints for the sidebar
const endpoints = [
  { id: "post-scan", method: "POST", path: "/scan", label: "Create Scan" },
  { id: "get-history", method: "GET", path: "/history", label: "List Scans" },
  { id: "get-history-id", method: "GET", path: "/history/[id]", label: "Get Scan Details" },
  { id: "delete-history-id", method: "DELETE", path: "/history/[id]", label: "Delete Scan" },
  { id: "post-scan-crawl", method: "POST", path: "/scan/crawl", label: "Deep Crawl Scan" },
  { id: "post-scan-crawl-discover", method: "POST", path: "/scan/crawl/discover", label: "Discover URLs" },
  { id: "get-version", method: "GET", path: "/api/version", label: "Version Check" },
  { id: "get-finding-types", method: "GET", path: "/api/v1/finding-types", label: "Finding Types" },
]

// Table of contents items
const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "authentication", label: "Authentication" },
  { id: "endpoints", label: "Endpoints" },
  ...endpoints.map(e => ({ id: e.id, label: e.label, level: 2 })),
  { id: "code-examples", label: "Code Examples" },
  { id: "rate-limiting", label: "Rate Limiting" },
  { id: "error-handling", label: "Error Handling" },
  { id: "best-practices", label: "Best Practices" },
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

function EndpointCard({ 
  id, 
  method, 
  path, 
  title, 
  description, 
  requestBody,
  responseExample,
  queryParams,
  pathParams,
  errors,
  notes
}: {
  id: string
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH"
  path: string
  title: string
  description: string
  requestBody?: string
  responseExample: string
  queryParams?: { name: string; type: string; description: string; required?: boolean }[]
  pathParams?: { name: string; type: string; description: string }[]
  errors?: { code: number; description: string }[]
  notes?: string[]
}) {
  const methodColors = {
    GET: "bg-blue-600/20 text-blue-600 border-blue-600/30",
    POST: "bg-green-600/20 text-green-600 border-green-600/30",
    DELETE: "bg-red-600/20 text-red-600 border-red-600/30",
    PUT: "bg-amber-600/20 text-amber-600 border-amber-600/30",
    PATCH: "bg-purple-600/20 text-purple-600 border-purple-600/30",
  }

  return (
    <Card id={id} className="p-6 border-border/40 scroll-mt-24 transition-all duration-300 hover:border-border/60">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Badge className={cn("font-mono text-xs border", methodColors[method])}>{method}</Badge>
        <code className="text-primary font-mono text-sm">{path}</code>
        <span className="text-xs text-muted-foreground ml-auto">{title}</span>
      </div>
      
      {/* Description */}
      <p className="text-muted-foreground text-sm mb-6 leading-relaxed">{description}</p>
      
      <div className="space-y-6">
        {/* Path Parameters */}
        {pathParams && pathParams.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Path Parameters</h4>
            <div className="space-y-2">
              {pathParams.map((param) => (
                <div key={param.name} className="flex items-start gap-3 text-sm">
                  <code className="bg-secondary px-2 py-0.5 rounded text-xs font-mono">{param.name}</code>
                  <span className="text-muted-foreground text-xs">{param.type}</span>
                  <span className="text-muted-foreground text-xs flex-1">{param.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Query Parameters */}
        {queryParams && queryParams.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Query Parameters</h4>
            <div className="space-y-2">
              {queryParams.map((param) => (
                <div key={param.name} className="flex items-start gap-3 text-sm">
                  <code className="bg-secondary px-2 py-0.5 rounded text-xs font-mono">{param.name}</code>
                  <span className="text-muted-foreground text-xs">{param.type}</span>
                  {param.required && <Badge variant="outline" className="text-[10px] px-1.5 py-0">required</Badge>}
                  <span className="text-muted-foreground text-xs flex-1">{param.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Request Body */}
        {requestBody && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Request Body</h4>
            <CodeBlock code={requestBody} />
          </div>
        )}

        {/* Response */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Response <Badge variant="outline" className="ml-2 text-[10px]">200 OK</Badge></h4>
          <CodeBlock code={responseExample} />
        </div>

        {/* Notes */}
        {notes && notes.length > 0 && (
          <div className="space-y-2">
            {notes.map((note, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                <span>{note}</span>
              </div>
            ))}
          </div>
        )}

        {/* Errors */}
        {errors && errors.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Error Responses</h4>
            <div className="space-y-2">
              {errors.map((error) => (
                <div key={error.code} className="flex items-start gap-3 text-sm">
                  <Badge variant="outline" className="text-xs font-mono">{error.code}</Badge>
                  <span className="text-muted-foreground text-xs">{error.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

export default function APIDocsPage() {
  const { setActiveSection, setTocItems } = useDocsContext()
  const [activeCodeTab, setActiveCodeTab] = useState<"curl" | "javascript" | "python">("curl")
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

    // Observe all sections
    tocItems.forEach((item) => {
      const el = document.getElementById(item.id)
      if (el) observerRef.current?.observe(el)
    })

    return () => observerRef.current?.disconnect()
  }, [setActiveSection])

  const codeExamples = {
    curl: {
      scan: `curl -X POST "${APP_URL}/api/v2/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com"}'`,
      history: `curl -X GET "${APP_URL}/api/v2/history" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
      detail: `curl -X GET "${APP_URL}/api/v2/history/123" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    },
    javascript: {
      scan: `const response = await fetch('${APP_URL}/api/v2/scan', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ url: 'https://example.com' })
});
const data = await response.json();
console.log(data.findings);`,
      history: `const response = await fetch('${APP_URL}/api/v2/history', {
  headers: { 'Authorization': 'Bearer YOUR_API_KEY' }
});
const { scans } = await response.json();`,
      detail: `const response = await fetch('${APP_URL}/api/v2/history/123', {
  headers: { 'Authorization': 'Bearer YOUR_API_KEY' }
});
const scan = await response.json();`,
    },
    python: {
      scan: `import requests

response = requests.post(
    '${APP_URL}/api/v2/scan',
    headers={'Authorization': 'Bearer YOUR_API_KEY'},
    json={'url': 'https://example.com'}
)
data = response.json()
print(f"Found {len(data['findings'])} vulnerabilities")`,
      history: `import requests

response = requests.get(
    '${APP_URL}/api/v2/history',
    headers={'Authorization': 'Bearer YOUR_API_KEY'}
)
scans = response.json()['scans']`,
      detail: `import requests

response = requests.get(
    '${APP_URL}/api/v2/history/123',
    headers={'Authorization': 'Bearer YOUR_API_KEY'}
)
scan = response.json()`,
    },
  }

  return (
    <div className="space-y-16">
      {/* Header */}
      <section id="overview" className="scroll-mt-24">
        <Badge variant="outline" className="mb-4 text-primary border-primary/30">v2 API</Badge>
        <h1 className="text-4xl font-bold tracking-tight mb-4">API Reference</h1>
        <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl">
          Complete documentation for the {APP_NAME} REST API. Integrate automated vulnerability scanning 
          into your applications, CI/CD pipelines, or custom security tools.
        </p>
        
        {/* Quick Info Cards */}
        <div className="grid sm:grid-cols-3 gap-4 mt-8">
          <div className="p-4 rounded-lg bg-card border border-border/40">
            <div className="text-2xl font-bold text-primary mb-1">v2</div>
            <div className="text-xs text-muted-foreground">API Version</div>
          </div>
          <div className="p-4 rounded-lg bg-card border border-border/40">
            <div className="text-2xl font-bold text-primary mb-1">50/day</div>
            <div className="text-xs text-muted-foreground">Rate Limit per Key</div>
          </div>
          <div className="p-4 rounded-lg bg-card border border-border/40">
            <div className="text-2xl font-bold text-primary mb-1">Bearer</div>
            <div className="text-xs text-muted-foreground">Auth Method</div>
          </div>
        </div>
      </section>

      {/* Authentication */}
      <section id="authentication" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Authentication</h2>
        <p className="text-muted-foreground">
          All API requests require authentication using a Bearer token. Generate API keys from your account settings.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Bearer Token Authentication</h3>
          <p className="text-sm text-muted-foreground mb-4">Include your API key in the Authorization header:</p>
          <CodeBlock code="Authorization: Bearer YOUR_API_KEY_HERE" language="http" />
          
          <div className="mt-6 pt-6 border-t border-border/40">
            <h4 className="font-semibold mb-3 text-sm">Getting Your API Key</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Log in to your {APP_NAME} account</li>
              <li>Navigate to <strong className="text-foreground">Profile</strong> &rarr; <strong className="text-foreground">API Keys</strong></li>
              <li>Click <strong className="text-foreground">Generate New Key</strong></li>
              <li>Copy and store the key securely (it will only be shown once)</li>
            </ol>
          </div>
          
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 flex gap-3 mt-6">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground">
              <p className="font-medium text-amber-600 mb-1">Security Warning</p>
              <p>Never share API keys publicly or commit them to version control. Each account is limited to 3 active API keys.</p>
            </div>
          </div>
        </Card>
      </section>

      {/* Endpoints */}
      <section id="endpoints" className="scroll-mt-24 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Endpoints</h2>
          <div className="text-sm text-muted-foreground">
            Base URL: <code className="bg-secondary px-2 py-1 rounded text-xs">{APP_URL}/api/v2</code>
          </div>
        </div>
        
        <div className="space-y-6">
          {/* POST /scan */}
          <EndpointCard
            id="post-scan"
            method="POST"
            path="/scan"
            title="Create Scan"
            description="Initiate a vulnerability scan on a target URL. Supports HTTP, HTTPS, WebSocket (ws/wss), and FTP (ftp/ftps) protocols. Returns comprehensive security findings with severity ratings and remediation advice."
            requestBody={`{
  "url": "https://example.com",    // Required - Target URL to scan
  "scanners": ["headers", "ssl"]   // Optional - Specific scanners to run
}`}
            responseExample={`{
  "url": "https://example.com",
  "scannedAt": "2026-03-10T15:30:00.000Z",
  "duration": 1234,
  "findings": [
    {
      "type": "hsts-missing",
      "title": "HSTS Header Missing",
      "severity": "medium",
      "description": "HTTP Strict Transport Security header is not set",
      "remediation": "Add 'Strict-Transport-Security: max-age=31536000; includeSubDomains'"
    }
  ],
  "summary": {
    "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7
  },
  "scanHistoryId": 12345,
  "notes": "${APP_NAME} v${APP_VERSION} (Engine v${ENGINE_VERSION})"
}`}
            notes={[
              "Supported protocols: http://, https://, ws://, wss://, ftp://, ftps://",
              "If 'scanners' is omitted, all available scanners will run",
              "Scan results are automatically saved to your history"
            ]}
            errors={[
              { code: 400, description: "Missing or invalid URL parameter" },
              { code: 401, description: "Invalid, missing, or revoked API key" },
              { code: 422, description: "Target URL unreachable or blocking requests" },
              { code: 429, description: "Rate limit exceeded (50 requests per 24 hours)" },
            ]}
          />

          {/* GET /history */}
          <EndpointCard
            id="get-history"
            method="GET"
            path="/history"
            title="List Scans"
            description="Retrieve all scans for the authenticated user. Returns up to 100 most recent scans ordered by date descending."
            responseExample={`{
  "scans": [
    {
      "id": 1,
      "url": "https://example.com",
      "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
      "findings_count": 7,
      "duration": 1234,
      "scanned_at": "2026-03-10T15:30:00.000Z",
      "source": "api",
      "notes": "${APP_NAME} v${APP_VERSION}",
      "tags": ["production", "weekly-scan"]
    }
  ]
}`}
            errors={[
              { code: 401, description: "Unauthorized - must be authenticated" },
            ]}
          />

          {/* GET /history/[id] */}
          <EndpointCard
            id="get-history-id"
            method="GET"
            path="/history/[id]"
            title="Get Scan Details"
            description="Retrieve detailed information for a specific scan by ID, including all findings and response headers. Team members can access scans from other team members."
            pathParams={[
              { name: "id", type: "number", description: "The scan ID" }
            ]}
            responseExample={`{
  "url": "https://example.com",
  "scannedAt": "2026-03-10T15:30:00.000Z",
  "duration": 1234,
  "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
  "findings": [
    {
      "type": "hsts-missing",
      "title": "HSTS Header Missing",
      "severity": "medium",
      "description": "HTTP Strict Transport Security header is not set",
      "remediation": "Add 'Strict-Transport-Security: max-age=31536000'"
    }
  ],
  "responseHeaders": {
    "content-type": "text/html; charset=utf-8",
    "server": "nginx/1.18.0"
  },
  "notes": "${APP_NAME} v${APP_VERSION}"
}`}
            errors={[
              { code: 401, description: "Unauthorized - must be authenticated" },
              { code: 404, description: "Scan not found or access denied" },
            ]}
          />

          {/* DELETE /history/[id] */}
          <EndpointCard
            id="delete-history-id"
            method="DELETE"
            path="/history/[id]"
            title="Delete Scan"
            description="Permanently delete a scan from your history. This action cannot be undone. Only the scan owner or team admins can delete scans."
            pathParams={[
              { name: "id", type: "number", description: "The scan ID to delete" }
            ]}
            responseExample={`{
  "success": true,
  "message": "Scan deleted successfully"
}`}
            errors={[
              { code: 401, description: "Unauthorized - must be authenticated" },
              { code: 403, description: "Forbidden - you don't have permission to delete this scan" },
              { code: 404, description: "Scan not found" },
            ]}
          />

          {/* POST /scan/crawl */}
          <EndpointCard
            id="post-scan-crawl"
            method="POST"
            path="/scan/crawl"
            title="Deep Crawl Scan"
            description="Crawl an entire website and scan multiple pages for vulnerabilities. Discovers internal links automatically or accepts a pre-selected list of URLs. Maximum 20 pages per crawl."
            requestBody={`{
  "url": "https://example.com",           // Required - Entry URL
  "urls": [                                // Optional - Pre-selected URLs
    "https://example.com/about",
    "https://example.com/contact"
  ]
}`}
            responseExample={`{
  "url": "https://example.com",
  "scannedAt": "2026-03-10T15:30:00.000Z",
  "duration": 8500,
  "summary": { "critical": 0, "high": 2, "medium": 5, "low": 3, "info": 2, "total": 12 },
  "crawl": {
    "totalPages": 5,
    "pages": [
      {
        "url": "https://example.com",
        "findings": [...],
        "summary": { "critical": 0, "high": 1, "medium": 1, "low": 0, "info": 1, "total": 3 },
        "duration": 1200
      }
    ]
  },
  "scanHistoryId": 12346
}`}
            notes={[
              "If 'urls' is omitted, the crawler discovers links automatically (max 20 pages)",
              "All discovered pages must be on the same domain as the entry URL",
              "Deep crawls count as multiple requests against your rate limit"
            ]}
            errors={[
              { code: 400, description: "Missing or invalid URL" },
              { code: 401, description: "Unauthorized" },
              { code: 429, description: "Rate limit exceeded" },
            ]}
          />

          {/* POST /scan/crawl/discover */}
          <EndpointCard
            id="post-scan-crawl-discover"
            method="POST"
            path="/scan/crawl/discover"
            title="Discover URLs"
            description="Discover all internal pages on a website without scanning them. Useful for letting users select which pages to include in a deep crawl."
            requestBody={`{
  "url": "https://example.com"  // Required - Entry URL
}`}
            responseExample={`{
  "urls": [
    "https://example.com",
    "https://example.com/about",
    "https://example.com/contact",
    "https://example.com/blog"
  ],
  "total": 4
}`}
            notes={[
              "Discovery does not count against your scan rate limit",
              "Returns up to 100 discovered URLs"
            ]}
            errors={[
              { code: 400, description: "Missing or invalid URL" },
              { code: 401, description: "Unauthorized" },
            ]}
          />

          {/* GET /api/version */}
          <EndpointCard
            id="get-version"
            method="GET"
            path="/api/version"
            title="Version Check"
            description="Check if the running instance is up to date. Compares the installed version against the latest release. No authentication required. Note: This endpoint is not versioned."
            responseExample={`{
  "current": "${APP_VERSION}",
  "latest": "${APP_VERSION}",
  "engine": "${ENGINE_VERSION}",
  "status": "up-to-date",
  "message": "You're running the latest version."
}`}
            notes={[
              "No authentication required - public endpoint",
              "Status can be: up-to-date, behind, or ahead",
              "Useful for self-hosted deployments to check for updates"
            ]}
            errors={[]}
          />

          {/* GET /api/v1/finding-types */}
          <EndpointCard
            id="get-finding-types"
            method="GET"
            path="/api/v1/finding-types"
            title="Finding Types"
            description="Returns all security check definitions. Use this to understand what findings your integration should handle, display human-readable titles, and categorize results by severity."
            responseExample={`{
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
    }
  ]
}`}
            notes={[
              "No authentication required - public endpoint",
              "Useful for SDK development and custom integrations",
              "Returns all 110+ security check definitions"
            ]}
            errors={[]}
          />
        </div>
      </section>

      {/* Code Examples */}
      <section id="code-examples" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Code Examples</h2>
        <p className="text-muted-foreground">
          Complete examples for the most common API operations in multiple languages.
        </p>

        <Card className="p-6 border-border/40">
          {/* Language Tabs */}
          <div className="flex gap-1 mb-6 border-b border-border">
            {(["curl", "javascript", "python"] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setActiveCodeTab(lang)}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium transition-all duration-200 capitalize relative",
                  activeCodeTab === lang
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {lang}
                {activeCodeTab === lang && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </button>
            ))}
          </div>

          <div className="space-y-8">
            <div>
              <h4 className="font-semibold mb-3 text-sm">Create a Scan</h4>
              <CodeBlock code={codeExamples[activeCodeTab].scan} language={activeCodeTab === "curl" ? "bash" : activeCodeTab} />
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">List Scan History</h4>
              <CodeBlock code={codeExamples[activeCodeTab].history} language={activeCodeTab === "curl" ? "bash" : activeCodeTab} />
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Get Scan Details</h4>
              <CodeBlock code={codeExamples[activeCodeTab].detail} language={activeCodeTab === "curl" ? "bash" : activeCodeTab} />
            </div>
          </div>
        </Card>
      </section>

      {/* Rate Limiting */}
      <section id="rate-limiting" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Rate Limiting</h2>
        
        <Card className="p-6 border-border/40">
          <p className="text-muted-foreground mb-6">
            Each API key is limited to <strong className="text-foreground">50 requests per 24 hours</strong>. 
            Rate limit information is included in response headers.
          </p>
          
          <div className="space-y-6">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Response Headers</h4>
              <CodeBlock code={`X-RateLimit-Limit: 50
X-RateLimit-Remaining: 49
X-RateLimit-Reset: 2026-03-11T15:30:00Z
Retry-After: 86400`} language="http" />
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Rate Limit Exceeded Response</h4>
              <CodeBlock code={`{
  "error": "Rate limit exceeded. 50 requests per 24 hours.",
  "limit": 50,
  "used": 50,
  "remaining": 0,
  "resets_at": "2026-03-11T15:30:00Z"
}`} />
            </div>

            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 flex gap-3">
              <CheckCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-blue-600 mb-1">Web Sessions vs API Keys</p>
                <p>Scans performed via the web interface use separate rate limits. API rate limits only apply to API key requests.</p>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Error Handling */}
      <section id="error-handling" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Error Handling</h2>
        
        <Card className="p-6 border-border/40">
          <p className="text-muted-foreground mb-6">
            The API uses standard HTTP status codes and returns detailed error messages in JSON format.
          </p>
          
          <div className="space-y-4">
            {[
              { code: 400, title: "Bad Request", description: "Missing or invalid request parameters. Check your request body and query parameters." },
              { code: 401, title: "Unauthorized", description: "Invalid, missing, or revoked API key. Verify your Authorization header is correct." },
              { code: 403, title: "Forbidden", description: "You don't have permission to access this resource." },
              { code: 404, title: "Not Found", description: "Resource doesn't exist or you don't have access. Check the resource ID." },
              { code: 422, title: "Unprocessable Entity", description: "Target URL is unreachable, blocking requests, or not publicly accessible." },
              { code: 429, title: "Too Many Requests", description: "Rate limit exceeded. Wait until the reset time before making more requests." },
              { code: 500, title: "Server Error", description: "Unexpected server error. Try again later or contact support if the issue persists." },
            ].map((error) => (
              <div key={error.code} className="flex items-start gap-4 p-3 rounded-lg bg-secondary/20">
                <Badge variant="outline" className="font-mono text-xs flex-shrink-0">{error.code}</Badge>
                <div>
                  <h4 className="font-semibold text-sm mb-1">{error.title}</h4>
                  <p className="text-xs text-muted-foreground">{error.description}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Best Practices */}
      <section id="best-practices" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Best Practices</h2>
        
        <Card className="p-6 border-border/40">
          <div className="grid gap-6 sm:grid-cols-2">
            {[
              { title: "Secure Key Storage", description: "Never hardcode API keys. Use environment variables or secure vaults. Rotate keys periodically." },
              { title: "Handle Rate Limits", description: "Implement exponential backoff for 429 responses. Check X-RateLimit headers to plan requests." },
              { title: "Validate URLs", description: "Ensure URLs are valid and publicly accessible before scanning. Avoid internal networks." },
              { title: "Retry Failed Requests", description: "Implement retry logic with exponential backoff for transient failures (422, 500)." },
              { title: "Cache Results", description: "Cache scan results locally to avoid unnecessary API calls and reduce rate limit usage." },
              { title: "Monitor Usage", description: "Track your API usage to stay within limits. Set up alerts when approaching the daily cap." },
            ].map((practice, i) => (
              <div key={i} className="p-4 rounded-lg bg-secondary/20 border border-border/40">
                <h4 className="font-semibold text-sm mb-2">{practice.title}</h4>
                <p className="text-xs text-muted-foreground">{practice.description}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  )
}
