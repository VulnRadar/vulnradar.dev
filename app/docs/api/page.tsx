"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { AlertTriangle, CheckCircle } from "lucide-react"
import { APP_URL, APP_NAME } from "@/lib/constants"
import { useState } from "react"
import { cn } from "@/lib/utils"

export default function APIDocsPage() {
  const [activeCodeTab, setActiveCodeTab] = useState<"curl" | "javascript" | "python">("curl")

  const codeExamples = {
    curl: (endpoint: string, method: string = "GET", data?: string) => {
      if (method === "POST" && data) {
        return `curl -X POST "${APP_URL}/api${endpoint}" \\
  -H "Authorization: Bearer YOUR_API_KEY_HERE" \\
  -H "Content-Type: application/json" \\
  -d '${data}'`
      }
      return `curl -X ${method} "${APP_URL}/api${endpoint}" \\
  -H "Authorization: Bearer YOUR_API_KEY_HERE"`
    },
    javascript: (endpoint: string, method: string = "GET", data?: string) => {
      if (method === "POST" && data) {
        return `const response = await fetch('${APP_URL}/api${endpoint}', {
  method: '${method}',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY_HERE',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(${data})
});
const data = await response.json();
console.log(data);`
      }
      return `const response = await fetch('${APP_URL}/api${endpoint}', {
  method: '${method}',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY_HERE',
  }
});
const data = await response.json();
console.log(data);`
    },
    python: (endpoint: string, method: string = "GET", data?: string) => {
      if (method === "POST" && data) {
        return `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_KEY_HERE',
    'Content-Type': 'application/json',
}

payload = ${data}
response = requests.${method.toLowerCase()}('${APP_URL}/api${endpoint}', 
  headers=headers, json=payload)
print(response.json())`
      }
      return `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_KEY_HERE',
}

response = requests.${method.toLowerCase()}('${APP_URL}/api${endpoint}', 
  headers=headers)
print(response.json())`
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2">API Reference</h1>
        <p className="text-lg text-muted-foreground">Complete documentation for the {APP_NAME} REST API. Integrate automated vulnerability scanning into your applications.</p>
      </div>

      {/* Authentication */}
      <section id="authentication" className="space-y-4">
        <h2 className="text-2xl font-bold">Authentication</h2>
        <p className="text-muted-foreground">All API requests require authentication using an API key. Get your key from your account settings and include it in the Authorization header.</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Bearer Token Authentication</h3>
          <p className="text-sm text-muted-foreground mb-3">Include your API key in the Authorization header of every request:</p>
          <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm mb-4"><code>{`Authorization: Bearer YOUR_API_KEY_HERE`}</code></pre>
          
          <h3 className="font-semibold mb-3 mt-6">Getting Your API Key</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Log in to your {APP_NAME} account</li>
            <li>Navigate to Account Settings → API Keys</li>
            <li>Click "Generate New Key"</li>
            <li>Copy the key immediately and store it securely</li>
            <li>Maximum 3 active API keys per account</li>
          </ol>
          
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 flex gap-3 mt-4">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground">
              <p><strong>Security:</strong> Treat API keys like passwords. Never share them publicly or commit them to version control. Each key is rate limited to 50 requests per 24 hours.</p>
            </div>
          </div>
        </Card>
      </section>

      {/* Endpoints */}
      <section id="endpoints" className="space-y-4">
        <h2 className="text-2xl font-bold">Endpoints</h2>
        <p className="text-muted-foreground">Base URL: <code className="bg-secondary px-2 py-1 rounded text-sm">{APP_URL}/api</code></p>

        {/* Create Scan */}
        <Card className="p-6 border-border/40">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Badge className="bg-green-600/20 text-green-700 hover:bg-green-600/20">POST</Badge>
              <code className="text-primary font-mono">/scan</code>
            </div>
            <span className="text-xs text-muted-foreground">Create Scan</span>
          </div>
          <p className="text-muted-foreground mb-4">Initiate a vulnerability scan on a website. Returns immediately with comprehensive security findings.</p>
          
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-sm mb-2">Request Body</h4>
              <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{`{
  "url": "https://example.com"  // (required) URL to scan, must be http:// or https://
}`}</code></pre>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Response (200 OK)</h4>
              <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{`{
  "url": "https://example.com",
  "scannedAt": "2024-02-12T15:30:00.000Z",
  "duration": 1234,
  "findings": [
    {
      "type": "missing_security_header",
      "title": "Missing X-Content-Type-Options Header",
      "severity": "high",
      "description": "The X-Content-Type-Options header is not set",
      "remediation": "Add 'X-Content-Type-Options: nosniff' to HTTP response headers"
    }
  ],
  "summary": {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
    "info": 1,
    "total": 7
  },
  "scanHistoryId": 12345
}`}</code></pre>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Error Responses</h4>
              <div className="space-y-2 text-xs">
                <div className="flex gap-2">
                  <Badge variant="outline" className="flex-shrink-0">400</Badge>
                  <span className="text-muted-foreground">Missing or invalid URL parameter</span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="flex-shrink-0">401</Badge>
                  <span className="text-muted-foreground">Unauthorized - invalid, missing, or revoked API key</span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="flex-shrink-0">422</Badge>
                  <span className="text-muted-foreground">Target URL unreachable, blocking requests, or not publicly accessible</span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="flex-shrink-0">429</Badge>
                  <span className="text-muted-foreground">Rate limit exceeded (50 requests per 24 hours)</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* List Scans */}
        <Card className="p-6 border-border/40">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Badge className="bg-blue-600/20 text-blue-700 hover:bg-blue-600/20">GET</Badge>
              <code className="text-primary font-mono">/history</code>
            </div>
            <span className="text-xs text-muted-foreground">List Scans</span>
          </div>
          <p className="text-muted-foreground mb-4">Retrieve all scans for the authenticated user, including scan history and metadata. Returns up to 100 most recent scans.</p>
          
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-sm mb-2">Query Parameters</h4>
              <p className="text-xs text-muted-foreground">None - scans are returned limited to 100 most recent, ordered by scan date descending. Web session authentication automatically filters to current user.</p>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Response (200 OK)</h4>
              <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{`{
  "scans": [
    {
      "id": 1,
      "url": "https://example.com",
      "summary": {
        "critical": 0,
        "high": 1,
        "medium": 2,
        "low": 3,
        "info": 1,
        "total": 7
      },
      "findings_count": 7,
      "duration": 1234,
      "scanned_at": "2024-02-12T15:30:00.000Z",
      "source": "api",
      "tags": []
    }
  ]
}`}</code></pre>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Error Responses</h4>
              <div className="space-y-2 text-xs">
                <div className="flex gap-2">
                  <Badge variant="outline" className="flex-shrink-0">401</Badge>
                  <span className="text-muted-foreground">Unauthorized - must be authenticated</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Get Scan by ID */}
        <Card className="p-6 border-border/40">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Badge className="bg-blue-600/20 text-blue-700 hover:bg-blue-600/20">GET</Badge>
              <code className="text-primary font-mono">/history/[id]</code>
            </div>
            <span className="text-xs text-muted-foreground">Get Scan Details</span>
          </div>
          <p className="text-muted-foreground mb-4">Retrieve detailed information for a specific scan by ID, including all findings and recommendations. Includes team member access if both are on the same team.</p>
          
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-sm mb-2">Path Parameters</h4>
              <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{`{
  "id": "1"  // (required) Scan ID number
}`}</code></pre>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Response (200 OK)</h4>
              <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{`{
  "url": "https://example.com",
  "scannedAt": "2024-02-12T15:30:00.000Z",
  "duration": 1234,
  "summary": {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
    "info": 1,
    "total": 7
  },
  "findings": [
    {
      "type": "missing_security_header",
      "title": "Missing X-Content-Type-Options Header",
      "severity": "high",
      "description": "The X-Content-Type-Options header prevents browsers from MIME-type sniffing",
      "remediation": "Set X-Content-Type-Options: nosniff in response headers"
    }
  ]
}`}</code></pre>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Error Responses</h4>
              <div className="space-y-2 text-xs">
                <div className="flex gap-2">
                  <Badge variant="outline" className="flex-shrink-0">401</Badge>
                  <span className="text-muted-foreground">Unauthorized - must be authenticated</span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="flex-shrink-0">404</Badge>
                  <span className="text-muted-foreground">Scan not found or user does not have access</span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Code Examples */}
      <section id="examples" className="space-y-4">
        <h2 className="text-2xl font-bold">Code Examples</h2>
        <p className="text-muted-foreground">Complete examples for the most common API operations across multiple languages.</p>

        {/* Create Scan Example */}
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Create Scan Example</h3>
          
          {/* Code Tabs */}
          <div className="flex gap-1 mb-4 border-b border-border">
            {(["curl", "javascript", "python"] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setActiveCodeTab(lang)}
                className={cn(
                  "px-4 py-2 text-sm font-medium transition-colors capitalize",
                  activeCodeTab === lang
                    ? "text-primary border-b-2 border-primary -mb-[2px]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {lang}
              </button>
            ))}
          </div>

          {/* Code Block */}
          <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{codeExamples[activeCodeTab]("/scan", "POST", JSON.stringify({
  url: "https://example.com"
}, null, 2))}</code></pre>
        </Card>

        {/* List Scans Example */}
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">List Scans Example</h3>
          
          {/* Code Tabs */}
          <div className="flex gap-1 mb-4 border-b border-border">
            {(["curl", "javascript", "python"] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setActiveCodeTab(lang)}
                className={cn(
                  "px-4 py-2 text-sm font-medium transition-colors capitalize",
                  activeCodeTab === lang
                    ? "text-primary border-b-2 border-primary -mb-[2px]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {lang}
              </button>
            ))}
          </div>

          {/* Code Block */}
          <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{codeExamples[activeCodeTab]("/history", "GET")}</code></pre>
        </Card>

        {/* Get Scan by ID Example */}
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Get Scan Details Example</h3>
          
          {/* Code Tabs */}
          <div className="flex gap-1 mb-4 border-b border-border">
            {(["curl", "javascript", "python"] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setActiveCodeTab(lang)}
                className={cn(
                  "px-4 py-2 text-sm font-medium transition-colors capitalize",
                  activeCodeTab === lang
                    ? "text-primary border-b-2 border-primary -mb-[2px]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {lang}
              </button>
            ))}
          </div>

          {/* Code Block */}
          <pre className="bg-secondary/30 p-4 rounded-lg overflow-x-auto text-sm"><code>{codeExamples[activeCodeTab]("/history/1", "GET")}</code></pre>
        </Card>
      </section>

      {/* Rate Limiting */}
      <section id="ratelimit" className="space-y-4">
        <h2 className="text-2xl font-bold">Rate Limiting</h2>
        
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-3">API Rate Limits</h3>
          <p className="text-sm text-muted-foreground mb-4">Each API key is limited to <strong>50 requests per 24 hours</strong>. Rate limit information is returned in response headers.</p>
          
          <div className="space-y-3">
            <div>
              <h4 className="font-semibold text-sm mb-2">Rate Limit Headers</h4>
              <pre className="bg-secondary/30 p-3 rounded-lg overflow-x-auto text-xs"><code>{`X-RateLimit-Limit: 50
X-RateLimit-Remaining: 49
X-RateLimit-Reset: 2024-02-13T15:30:00Z
Retry-After: 86400`}</code></pre>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">When Rate Limit Exceeded</h4>
              <p className="text-xs text-muted-foreground mb-2">Response status: <code className="bg-secondary px-1 rounded">429 Too Many Requests</code></p>
              <pre className="bg-secondary/30 p-3 rounded-lg overflow-x-auto text-xs"><code>{`{
  "error": "Rate limit exceeded. 50 requests per 24 hours.",
  "limit": 50,
  "used": 50,
  "remaining": 0,
  "resets_at": "2024-02-13T15:30:00Z"
}`}</code></pre>
            </div>

            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 flex gap-3 mt-4">
              <CheckCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <p><strong>Web Sessions:</strong> Scans performed via the web interface use separate rate limits. API rate limits only apply to API key requests.</p>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Error Handling */}
      <section id="errors" className="space-y-4">
        <h2 className="text-2xl font-bold">Error Handling</h2>
        
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Common Errors</h3>
          
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">400</Badge>
                <span className="font-semibold text-sm">Bad Request</span>
              </div>
              <p className="text-xs text-muted-foreground">Missing or invalid request parameters. Check your request body and parameters.</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">401</Badge>
                <span className="font-semibold text-sm">Unauthorized</span>
              </div>
              <p className="text-xs text-muted-foreground">Invalid, missing, or revoked API key. Verify your Authorization header is correct.</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">404</Badge>
                <span className="font-semibold text-sm">Not Found</span>
              </div>
              <p className="text-xs text-muted-foreground">Resource doesn't exist or you don't have access. Check the resource ID and your permissions.</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">422</Badge>
                <span className="font-semibold text-sm">Unprocessable Entity</span>
              </div>
              <p className="text-xs text-muted-foreground">Target URL is unreachable, blocking requests, or not publicly accessible. Ensure the URL is valid and accessible.</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">429</Badge>
                <span className="font-semibold text-sm">Too Many Requests</span>
              </div>
              <p className="text-xs text-muted-foreground">Rate limit exceeded. Wait until the reset time before making more requests.</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">500</Badge>
                <span className="font-semibold text-sm">Server Error</span>
              </div>
              <p className="text-xs text-muted-foreground">Unexpected server error. Try again later or contact support.</p>
            </div>
          </div>
        </Card>
      </section>

      {/* Best Practices */}
      <section id="best-practices" className="space-y-4">
        <h2 className="text-2xl font-bold">Best Practices</h2>
        
        <Card className="p-6 border-border/40">
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-sm mb-2">1. Secure API Key Storage</h4>
              <p className="text-xs text-muted-foreground">Never hardcode API keys in source code. Use environment variables or secure vaults.</p>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">2. Handle Rate Limits</h4>
              <p className="text-xs text-muted-foreground">Implement exponential backoff when receiving 429 responses. Check rate limit headers to plan requests.</p>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">3. Validate URLs</h4>
              <p className="text-xs text-muted-foreground">Ensure URLs are valid and publicly accessible before scanning. Avoid scanning private/internal networks.</p>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">4. Retry Failed Requests</h4>
              <p className="text-xs text-muted-foreground">Implement retry logic for transient failures (422, 500). Use exponential backoff between retries.</p>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">5. Cache Results</h4>
              <p className="text-xs text-muted-foreground">Cache scan results to avoid unnecessary API calls. Store scan history locally when possible.</p>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">6. Monitor Usage</h4>
              <p className="text-xs text-muted-foreground">Track your API usage to stay within rate limits. Set up alerts when approaching limits.</p>
            </div>
          </div>
        </Card>
      </section>
    </div>
  )
}
