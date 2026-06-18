"use client"

import { useState, useEffect, useRef } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

import { APP_URL, APP_NAME, APP_VERSION, ENGINE_VERSION } from "@/lib/config/constants"
import { cn } from "@/lib/ui/utils"
import { useDocsContext, type TocItem } from "../layout"
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  EndpointCard,
  CodeBlock,
  type Endpoint,
} from "@/components/docs"

// Define all endpoints
const endpoints: Endpoint[] = [
  {
    id: "post-scan",
    method: "POST",
    path: "/scan",
    title: "Create Scan",
    description:
      "Initiate a vulnerability scan on a target URL. Supports HTTP, HTTPS, WebSocket (ws/wss), and FTP (ftp/ftps) protocols. Returns comprehensive security findings with severity ratings and remediation advice.",
    requestBody: `{
  "url": "https://example.com",    // Required - Target URL to scan
  "scanners": ["headers", "ssl"]   // Optional - Specific scanners to run
}`,
    responseExample: `{
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
  "scanHistoryId": 12345
}`,
    notes: [
      "Supported protocols: http://, https://, ws://, wss://, ftp://, ftps://",
      "If 'scanners' is omitted, all available scanners will run",
      "Scan results are automatically saved to your history",
    ],
    errors: [
      { code: 400, description: "Missing or invalid URL parameter" },
      { code: 401, description: "Invalid, missing, or revoked API key" },
      { code: 422, description: "Target URL unreachable or blocking requests" },
      { code: 429, description: "Rate limit exceeded (varies by plan)" },
    ],
  },
  {
    id: "get-history",
    method: "GET",
    path: "/history",
    title: "List Scans",
    description:
      "Retrieve all scans for the authenticated user. Returns up to 100 most recent scans ordered by date descending.",
    responseExample: `{
  "scans": [
    {
      "id": 1,
      "url": "https://example.com",
      "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
      "findings_count": 7,
      "duration": 1234,
      "scanned_at": "2026-03-10T15:30:00.000Z",
      "source": "api",
      "tags": ["production", "weekly-scan"]
    }
  ]
}`,
    errors: [{ code: 401, description: "Unauthorized - must be authenticated" }],
  },
  {
    id: "get-history-id",
    method: "GET",
    path: "/history/[id]",
    title: "Get Scan Details",
    description:
      "Retrieve detailed information for a specific scan by ID, including all findings and response headers. Team members can access scans from other team members.",
    pathParams: [{ name: "id", type: "number", description: "The scan ID" }],
    responseExample: `{
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
  }
}`,
    errors: [
      { code: 401, description: "Unauthorized - must be authenticated" },
      { code: 404, description: "Scan not found or access denied" },
    ],
  },
  {
    id: "delete-history-id",
    method: "DELETE",
    path: "/history/[id]",
    title: "Delete Scan",
    description:
      "Permanently delete a scan from your history. This action cannot be undone. Only the scan owner or team admins can delete scans.",
    pathParams: [{ name: "id", type: "number", description: "The scan ID to delete" }],
    responseExample: `{
  "success": true,
  "message": "Scan deleted successfully"
}`,
    errors: [
      { code: 401, description: "Unauthorized - must be authenticated" },
      { code: 403, description: "Forbidden - you don't have permission to delete this scan" },
      { code: 404, description: "Scan not found" },
    ],
  },
  {
    id: "post-scan-crawl",
    method: "POST",
    path: "/scan/crawl",
    title: "Deep Crawl Scan",
    description:
      "Crawl an entire website and scan multiple pages for vulnerabilities. Discovers internal links automatically or accepts a pre-selected list of URLs. Maximum 20 pages per crawl.",
    requestBody: `{
  "url": "https://example.com",           // Required - Entry URL
  "urls": [                               // Optional - Pre-selected URLs
    "https://example.com/about",
    "https://example.com/contact"
  ]
}`,
    responseExample: `{
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
}`,
    notes: [
      "If 'urls' is omitted, the crawler discovers links automatically (max 20 pages)",
      "All discovered pages must be on the same domain as the entry URL",
      "Deep crawls count as multiple requests against your rate limit",
    ],
    errors: [
      { code: 400, description: "Missing or invalid URL" },
      { code: 401, description: "Unauthorized" },
      { code: 429, description: "Rate limit exceeded" },
    ],
  },
  {
    id: "post-scan-crawl-discover",
    method: "POST",
    path: "/scan/crawl/discover",
    title: "Discover URLs",
    description:
      "Discover all internal pages on a website without scanning them. Useful for letting users select which pages to include in a deep crawl.",
    requestBody: `{
  "url": "https://example.com"  // Required - Entry URL
}`,
    responseExample: `{
  "urls": [
    "https://example.com",
    "https://example.com/about",
    "https://example.com/contact",
    "https://example.com/blog"
  ],
  "total": 4
}`,
    notes: ["Discovery does not count against your scan rate limit", "Returns up to 100 discovered URLs"],
    errors: [
      { code: 400, description: "Missing or invalid URL" },
      { code: 401, description: "Unauthorized" },
    ],
  },
  {
    id: "get-version",
    method: "GET",
    path: "/api/version",
    title: "Version Check",
    description:
      "Check if the running instance is up to date. Compares the installed version against the latest release. No authentication required. Note: This endpoint is not versioned.",
    responseExample: `{
  "current": "${APP_VERSION}",
  "latest": "${APP_VERSION}",
  "engine": "${ENGINE_VERSION}",
  "status": "up-to-date",
  "message": "You're running the latest version."
}`,
    notes: [
      "No authentication required - public endpoint",
      "Status can be: up-to-date, behind, or ahead",
      "Useful for self-hosted deployments to check for updates",
    ],
    errors: [],
  },
  {
    id: "get-finding-types",
    method: "GET",
    path: "/api/v2/finding-types",
    title: "Finding Types",
    description:
      "Returns all security check definitions. Use this to understand what findings your integration should handle, display human-readable titles, and categorize results by severity.",
    responseExample: `{
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
}`,
    notes: [
      "No authentication required - public endpoint",
      "Useful for SDK development and custom integrations",
      "Returns all 110+ security check definitions",
    ],
    errors: [],
  },
]

// Table of contents
const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "authentication", label: "Authentication" },
  { id: "endpoints", label: "Endpoints" },
  ...endpoints.map((e) => ({ id: e.id, label: e.title, level: 2 })),
  { id: "code-examples", label: "Code Examples" },
  { id: "rate-limiting", label: "Rate Limiting" },
  { id: "error-handling", label: "Error Handling" },
  { id: "best-practices", label: "Best Practices" },
]

// Code examples by language
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

export default function APIDocsPage() {
  const { setActiveSection, setTocItems } = useDocsContext()
  const [activeCodeTab, setActiveCodeTab] = useState<"curl" | "javascript" | "python">("curl")
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
        badge="v2 API"
        title="API Reference"
        description={`Complete documentation for the ${APP_NAME} REST API. Integrate automated vulnerability scanning into your applications, CI/CD pipelines, or custom security tools.`}
        stats={[
          { value: "v2", label: "API Version" },
          { value: "By Plan", label: "Rate Limit" },
          { value: "Bearer", label: "Auth Method" },
        ]}
      />

      {/* Authentication */}
      <DocsSection id="authentication" title="Authentication">
        <p className="text-sm sm:text-base text-muted-foreground">
          All API requests require authentication using a Bearer token. Generate API keys from your account
          settings.
        </p>

        <Card className="p-4 sm:p-6 border-border/40">
          <h3 className="font-semibold mb-4">Bearer Token Authentication</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Include your API key in the Authorization header:
          </p>
          <CodeBlock code="Authorization: Bearer YOUR_API_KEY_HERE" language="http" />

          <div className="mt-6 pt-6 border-t border-border/40">
            <h4 className="font-semibold mb-3 text-sm">Getting Your API Key</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Log in to your {APP_NAME} account
              </li>
              <li>
                Navigate to <strong className="text-foreground">Profile</strong> &rarr;{" "}
                <strong className="text-foreground">API Keys</strong>
              </li>
              <li>
                Click <strong className="text-foreground">Generate New Key</strong>
              </li>
              <li>Copy and store the key securely (it will only be shown once)</li>
            </ol>
          </div>

          <DocsCallout variant="warning" title="Security Warning" className="mt-6">
            <p>
              Never share API keys publicly or commit them to version control. Each account is limited to 3
              active API keys.
            </p>
          </DocsCallout>
        </Card>
      </DocsSection>

      {/* Endpoints */}
      <DocsSection id="endpoints" title="Endpoints">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 -mt-2">
          <div className="text-xs sm:text-sm text-muted-foreground">
            Base URL:{" "}
            <code className="bg-secondary px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[10px] sm:text-xs break-all">
              {APP_URL}/api/v2
            </code>
          </div>
        </div>

        <div className="space-y-6">
          {endpoints.map((endpoint) => (
            <EndpointCard key={endpoint.id} {...endpoint} />
          ))}
        </div>
      </DocsSection>

      {/* Code Examples */}
      <DocsSection id="code-examples" title="Code Examples">
        <p className="text-muted-foreground">
          Complete examples for the most common API operations in multiple languages.
        </p>

        <Card className="p-6 border-border/40">
          <div className="flex gap-1 mb-6 border-b border-border">
            {(["curl", "javascript", "python"] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setActiveCodeTab(lang)}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium transition-all duration-200 capitalize relative",
                  activeCodeTab === lang ? "text-primary" : "text-muted-foreground hover:text-foreground"
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
              <CodeBlock
                code={codeExamples[activeCodeTab].scan}
                language={activeCodeTab === "curl" ? "bash" : activeCodeTab}
              />
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">List Scan History</h4>
              <CodeBlock
                code={codeExamples[activeCodeTab].history}
                language={activeCodeTab === "curl" ? "bash" : activeCodeTab}
              />
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Get Scan Details</h4>
              <CodeBlock
                code={codeExamples[activeCodeTab].detail}
                language={activeCodeTab === "curl" ? "bash" : activeCodeTab}
              />
            </div>
          </div>
        </Card>
      </DocsSection>

      {/* Rate Limiting */}
      <DocsSection id="rate-limiting" title="Rate Limiting">
        <Card className="p-6 border-border/40">
          <p className="text-muted-foreground mb-6">
            API rate limits vary by subscription plan. Rate limit information is included in response headers.
          </p>

          <div className="space-y-6">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Rate Limits by Plan
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { value: "25", label: "Free" },
                  { value: "100", label: "Core" },
                  { value: "5,000", label: "Pro" },
                  { value: "Unlimited", label: "Elite", highlight: true },
                ].map((plan) => (
                  <div
                    key={plan.label}
                    className="p-3 rounded-lg bg-secondary/30 border border-border/40 text-center"
                  >
                    <div className={cn("text-lg font-bold", plan.highlight ? "text-primary" : "text-foreground")}>
                      {plan.value}
                    </div>
                    <div className="text-xs text-muted-foreground">{plan.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Response Headers
              </h4>
              <CodeBlock
                code={`X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 2026-03-11T15:30:00Z
Retry-After: 86400`}
                language="http"
              />
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Rate Limit Exceeded Response
              </h4>
              <CodeBlock
                code={`{
  "error": "Rate limit exceeded",
  "limit": 100,
  "used": 100,
  "remaining": 0,
  "resets_at": "2026-03-11T15:30:00Z"
}`}
              />
            </div>

            <DocsCallout variant="info" title="Web Sessions vs API Keys">
              <p>
                Scans performed via the web interface use separate rate limits. API rate limits only apply to
                API key requests.
              </p>
            </DocsCallout>
          </div>
        </Card>
      </DocsSection>

      {/* Error Handling */}
      <DocsSection id="error-handling" title="Error Handling">
        <Card className="p-6 border-border/40">
          <p className="text-muted-foreground mb-6">
            The API uses standard HTTP status codes and returns detailed error messages in JSON format.
          </p>

          <div className="space-y-4">
            {[
              {
                code: 400,
                title: "Bad Request",
                description: "Missing or invalid request parameters. Check your request body and query parameters.",
              },
              {
                code: 401,
                title: "Unauthorized",
                description: "Invalid, missing, or revoked API key. Verify your Authorization header is correct.",
              },
              {
                code: 403,
                title: "Forbidden",
                description: "You don't have permission to access this resource.",
              },
              {
                code: 404,
                title: "Not Found",
                description: "Resource doesn't exist or you don't have access. Check the resource ID.",
              },
              {
                code: 422,
                title: "Unprocessable Entity",
                description: "Target URL is unreachable, blocking requests, or not publicly accessible.",
              },
              {
                code: 429,
                title: "Too Many Requests",
                description: "Rate limit exceeded. Wait until the reset time before making more requests.",
              },
              {
                code: 500,
                title: "Server Error",
                description: "Unexpected server error. Try again later or contact support if the issue persists.",
              },
            ].map((error) => (
              <div key={error.code} className="flex items-start gap-4 p-3 rounded-lg bg-secondary/20">
                <Badge variant="outline" className="font-mono text-xs flex-shrink-0">
                  {error.code}
                </Badge>
                <div>
                  <h4 className="font-semibold text-sm mb-1">{error.title}</h4>
                  <p className="text-xs text-muted-foreground">{error.description}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </DocsSection>

      {/* Best Practices */}
      <DocsSection id="best-practices" title="Best Practices">
        <Card className="p-6 border-border/40">
          <div className="grid gap-6 sm:grid-cols-2">
            {[
              {
                title: "Secure Key Storage",
                description:
                  "Never hardcode API keys. Use environment variables or secure vaults. Rotate keys periodically.",
              },
              {
                title: "Handle Rate Limits",
                description:
                  "Implement exponential backoff for 429 responses. Check X-RateLimit headers to plan requests.",
              },
              {
                title: "Validate URLs",
                description:
                  "Ensure URLs are valid and publicly accessible before scanning. Avoid internal networks.",
              },
              {
                title: "Retry Failed Requests",
                description: "Implement retry logic with exponential backoff for transient failures (422, 500).",
              },
              {
                title: "Cache Results",
                description:
                  "Cache scan results locally to avoid unnecessary API calls and reduce rate limit usage.",
              },
              {
                title: "Monitor Usage",
                description:
                  "Track your API usage to stay within limits. Set up alerts when approaching the daily cap.",
              },
            ].map((practice, i) => (
              <div key={i} className="p-4 rounded-lg bg-secondary/20 border border-border/40">
                <h4 className="font-semibold text-sm mb-2">{practice.title}</h4>
                <p className="text-xs text-muted-foreground">{practice.description}</p>
              </div>
            ))}
          </div>
        </Card>
      </DocsSection>
    </div>
  )
}
