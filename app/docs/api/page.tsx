"use client";

import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  APP_URL,
  APP_NAME,
  APP_REPO,
  APP_VERSION,
  ENGINE_VERSION,
} from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";
import { useDocsContext, type TocItem } from "../layout";
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  EndpointCard,
  CodeBlock,
  type Endpoint,
} from "@/components/docs";

const endpoints: Endpoint[] = [
  {
    id: "post-scan",
    method: "POST",
    path: "/scan",
    title: "Create a Scan",
    description:
      "Initiate a vulnerability scan against a target. Pass a hostname or a full URL; we auto-prepend https:// if you omit the scheme. Service probes are opt-in via the probes field. Returns findings with severity, category, evidence, and a fix recipe.",
    requestBody: `{
  "url": "example.com",
  "probes": ["ssh:22", "smtp:587"]
}`,
    responseExample: `{
  "url": "https://example.com",
  "scannedAt": "2026-06-25T15:30:00.000Z",
  "duration": 1423,
  "findings": [
    {
      "id": "hsts-missing",
      "title": "HSTS Header Missing",
      "severity": "medium",
      "category": "headers",
      "description": "HTTP Strict Transport Security header is not set.",
      "evidence": "GET / response did not include a Strict-Transport-Security header.",
      "riskImpact": "Without HSTS, a man-in-the-middle can downgrade the connection to HTTP on the first visit.",
      "explanation": "HSTS tells browsers and compliant clients to only ever speak HTTPS to your domain.",
      "fixSteps": [
        "Add the header to every HTTPS response",
        "Set max-age to at least 31536000 (1 year)",
        "Include subDomains and preload once you are confident"
      ],
      "codeExamples": [
        {
          "label": "nginx",
          "language": "nginx",
          "code": "add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains; preload\" always;"
        }
      ]
    }
  ],
  "checksRun": 739,
  "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
  "scanHistoryId": 12345
}`,
    notes: [
      "url accepts a bare hostname (auto-prepended https://), a full URL with http/https/ws/wss/ftp/ftps/ssh/smtp/smtp/imap/imaps/pop3/pop3s/mongodb scheme, or a public IPv4 literal (probe-only mode).",
      "Raw IPv4: web checks (headers, ssl, tls, cookies, content, info, configuration, code, secrets, api) are skipped — there is no hostname context for them. DNS + email + your selected service probes still run.",
      'probes is an array of "<service>:<port>" strings. Supported services: ssh, smtp, imap, pop3, ftp, mongodb. Default port is used if you omit it. Each probe opens a TCP socket to the hostname or IP, reads the banner, and reports version disclosure and reachability.',
      "scanners (advanced) accepts category names to restrict web checks: headers, ssl, content, cookies, configuration, information-disclosure, dns, email, api, code, secrets-extended. Omit to run all 12 categories.",
      "Service probes are independent of the URL scheme — you can ask for an SSH probe on a https:// target or a raw IPv4.",
      "SSRF protection rejects localhost and private IP targets.",
      "Scan results are saved to scan_history.",
    ],
    errors: [
      { code: 400, description: "Missing or invalid URL" },
      {
        code: 401,
        description: "Unauthorized (session cookie or Bearer API key required)",
      },
      { code: 422, description: "Target unreachable or blocking requests" },
      { code: 429, description: "Daily quota exceeded" },
    ],
  },
  {
    id: "post-scan-bulk",
    method: "POST",
    path: "/scan/bulk",
    title: "Bulk Scan",
    description:
      "Submit up to 100 URLs in one request. Each URL counts as one daily quota unit.",
    requestBody: `{
  "urls": [
    "https://example.com",
    "https://example.org",
    "https://example.net"
  ]
}`,
    responseExample: `{
  "results": [
    { "url": "https://example.com", "summary": { "critical": 0, "high": 1, "medium": 2, "low": 1, "info": 0, "total": 4 } },
    { "url": "https://example.org", "summary": { "critical": 0, "high": 0, "medium": 0, "low": 1, "info": 2, "total": 3 } }
  ],
  "totalScans": 3,
  "totalFindings": 12
}`,
    notes: [
      "Max 100 URLs per request (CONFIG_MAX_URLS_BULK).",
      "Returns after all URLs complete; long batches use CONFIG_BULK_SCAN_TIMEOUT_SECONDS.",
    ],
    errors: [
      { code: 400, description: "Missing or invalid urls array" },
      { code: 401, description: "Unauthorized" },
      { code: 429, description: "Rate limit or daily quota" },
    ],
  },
  {
    id: "post-scan-crawl",
    method: "POST",
    path: "/scan/crawl",
    title: "Deep Crawl Scan",
    description:
      "Crawl the target and scan each discovered page. Either provide a pre-selected URL list or let the crawler discover links. Up to 15 pages per crawl.",
    requestBody: `{
  "url": "https://example.com",
  "urls": ["https://example.com/about", "https://example.com/contact"]
}`,
    responseExample: `{
  "url": "https://example.com",
  "scannedAt": "2026-03-10T15:30:00.000Z",
  "duration": 8500,
  "findings": [ /* aggregate findings across all pages */ ],
  "summary": { "critical": 0, "high": 2, "medium": 5, "low": 3, "info": 2, "total": 12 },
  "scanHistoryId": 12346,
  "crawl": {
    "pagesDiscovered": 18,
    "pagesScanned": 12,
    "pagesSkipped": 6,
    "pages": [
      {
        "url": "https://example.com",
        "summary": { "critical": 0, "high": 1, "medium": 1, "low": 0, "info": 1, "total": 3 },
        "duration": 1200,
        "findings": []
      }
    ]
  }
}`,
    notes: [
      "Max 15 pages (MAX_PAGES in app/api/v3/scan/crawl/route.ts).",
      "All pages must share the entry URL's hostname (same-origin).",
      "For session auth, each scanned page counts as one daily quota unit.",
      "For Bearer auth, the entire crawl counts as one quota unit.",
    ],
    errors: [
      { code: 400, description: "Missing or invalid URL" },
      { code: 401, description: "Unauthorized" },
      { code: 429, description: "Rate limit or daily quota" },
    ],
  },
  {
    id: "post-scan-crawl-discover",
    method: "POST",
    path: "/scan/crawl/discover",
    title: "Discover URLs",
    description:
      "Discover links from a target without scanning them. Useful for previewing what a crawl would cover.",
    requestBody: `{
  "url": "https://example.com"
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
    notes: [
      "Returns up to 20 URLs (MAX_PAGES in app/api/v3/scan/crawl/discover/route.ts).",
      "Counts as 1 daily quota unit on either auth path.",
      "Subject to the standard per-IP scan rate limit (100/hour).",
    ],
    errors: [
      { code: 400, description: "Missing or invalid URL" },
      { code: 401, description: "Unauthorized" },
      { code: 429, description: "Rate limit or daily quota" },
    ],
  },
  {
    id: "post-scan-discover",
    method: "POST",
    path: "/scan/discover",
    title: "Discover Subdomains",
    description:
      "Enumerate subdomains for a domain. Aggregates results from crt.sh, HackerTarget, Subdomain.Center, RapidDNS, and brute-force DNS.",
    requestBody: `{
  "url": "https://example.com",
  "forceRefresh": false
}`,
    responseExample: `{
  "subdomains": [
    { "host": "www.example.com", "source": "crt.sh" },
    { "host": "api.example.com", "source": "rapiddns" },
    { "host": "staging.example.com", "source": "brute" }
  ]
}`,
    notes: [
      "forceRefresh: true bypasses the subdomain_cache table.",
      "Results are cached for 24h per domain by default.",
    ],
    errors: [
      { code: 400, description: "Missing or invalid URL" },
      { code: 401, description: "Unauthorized" },
      { code: 429, description: "Rate limit" },
    ],
  },
  {
    id: "get-history",
    method: "GET",
    path: "/history",
    title: "List Scan History",
    description:
      "Returns up to 100 most recent scans for the authenticated user. Retention follows the user's plan (Free: 30 days, Core: 90, Pro/Elite: forever). Staff roles bypass retention.",
    responseExample: `{
  "scans": [
    {
      "id": 1,
      "url": "https://example.com",
      "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
      "findings_count": 7,
      "duration": 1423,
      "scanned_at": "2026-03-10T15:30:00.000Z",
      "source": "api",
      "tags": ["production", "weekly-scan"]
    }
  ]
}`,
    notes: [
      "Team members can see scans from other team members in the same team.",
      "Use /history/[id] for full details (findings, response headers).",
    ],
    errors: [{ code: 401, description: "Unauthorized" }],
  },
  {
    id: "get-history-id",
    method: "GET",
    path: "/history/[id]",
    title: "Get Scan Details",
    description:
      "Return full scan details: findings, response headers, scan metadata. Owner or same-team member can view.",
    pathParams: [{ name: "id", type: "number", description: "Scan ID" }],
    responseExample: `{
  "url": "https://example.com",
  "scannedAt": "2026-03-10T15:30:00.000Z",
  "duration": 1423,
  "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
  "findings": [
    { /* full Vulnerability object — see /scan response */ }
  ],
  "responseHeaders": {
    "content-type": "text/html; charset=utf-8",
    "server": "nginx/1.18.0"
  }
}`,
    errors: [
      { code: 401, description: "Unauthorized" },
      { code: 404, description: "Scan not found or access denied" },
    ],
  },
  {
    id: "delete-history",
    method: "DELETE",
    path: "/history",
    title: "Delete All Scan History",
    description:
      "Permanently delete every scan and tag for the authenticated user. Cannot be undone.",
    responseExample: `{
  "success": true,
  "deleted": 47
}`,
    errors: [{ code: 401, description: "Unauthorized" }],
  },
  {
    id: "delete-history-id",
    method: "DELETE",
    path: "/history/[id]",
    title: "Delete a Single Scan",
    description: "Permanently delete a single scan by ID. Owner only.",
    pathParams: [
      { name: "id", type: "number", description: "Scan ID to delete" },
    ],
    responseExample: `{
  "success": true,
  "message": "Scan deleted successfully"
}`,
    errors: [
      { code: 401, description: "Unauthorized" },
      { code: 403, description: "Forbidden — not the scan owner" },
      { code: 404, description: "Scan not found" },
    ],
  },
  {
    id: "patch-history-id",
    method: "PATCH",
    path: "/history/[id]",
    title: "Update Scan Notes",
    description: "Update the user note on a scan. Owner only.",
    pathParams: [{ name: "id", type: "number", description: "Scan ID" }],
    requestBody: `{
  "notes": "Investigating HSTS issue with infra team"
}`,
    responseExample: `{
  "success": true
}`,
    errors: [
      { code: 400, description: "Notes longer than 2000 characters" },
      { code: 401, description: "Unauthorized" },
      { code: 403, description: "Forbidden — not the scan owner" },
      { code: 404, description: "Scan not found" },
    ],
  },
  {
    id: "post-browser-sessions",
    method: "POST",
    path: "/browser/sessions",
    title: "Start a Browser Session",
    description:
      "Open an ephemeral BrowserBase session so the user can view the scanned site from a remote, sandboxed browser. Sessions are time-limited and end automatically when the popup closes. Only enabled when BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID are configured on the server.",
    requestBody: `{
  "url": "https://example.com",
  "ttlSeconds": 300
}`,
    responseExample: `{
  "session": {
    "id": "01HXY...",
    "status": "RUNNING",
    "url": "https://example.com",
    "debuggerUrl": "https://www.browserbase.com/devtools/inspector.html?wss=connect.browserbase.com%2Fdebug%2F...",
    "debuggerFullscreenUrl": "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=connect.browserbase.com%2Fdebug%2F...",
    "connectUrl": "wss://connect.browserbase.com/debug/...",
    "liveViewerUrl": "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=...&navbar=false",
    "expiresAt": "2026-06-26T18:25:55.722+00:00"
  },
  "expiresInSeconds": 300
}`,
    notes: [
      "ttlSeconds is hard-clamped to BROWSERBASE_MAX_TTL_SECONDS (default 300 = 5 minutes, max 21600 enforced by BrowserBase).",
      "Open the returned session.id at /browser/{id}?expiresIn={expiresInSeconds} to view in the popup. The iframe src is session.liveViewerUrl (debuggerFullscreenUrl + &navbar=false).",
      "Under the hood: we POST /v1/sessions to BrowserBase (with projectId + timeout + browserSettings, no startUrl), then open a CDP WebSocket (Node 22 built-in, to the create response's connectUrl) to send Page.navigate to the target URL, then GET /v1/sessions/{id}/debug for the iframe-embed URL. Best-effort: if CDP fails the browser stays on about:blank.",
      "BrowserBase does NOT accept a `?goto=` parameter — navigation must go through CDP. See https://docs.browserbase.com/platform/browser/observability/session-live-view for the embed pattern.",
      "Server-only: the BrowserBase API key is never sent to the client.",
    ],
    errors: [
      { code: 401, description: "Unauthorized" },
      {
        code: 503,
        description: "BrowserBase is not configured on this server",
      },
    ],
  },
  {
    id: "get-browser-sessions",
    method: "GET",
    path: "/browser/sessions?id={id}",
    title: "Read Browser Session",
    description:
      "Fetch the latest BrowserBase session metadata (status, current URL, viewer URL). Used by the popup page to refresh after the user reconnects.",
    queryParams: [
      { name: "id", type: "string", description: "BrowserBase session id" },
    ],
    responseExample: `{
  "session": {
    "id": "bb_session_abc123",
    "status": "RUNNING",
    "url": "https://example.com/login",
    "liveViewerUrl": "https://app.browserbase.com/..."
  }
}`,
    errors: [
      { code: 401, description: "Unauthorized" },
      {
        code: 503,
        description: "BrowserBase is not configured on this server",
      },
      {
        code: 502,
        description: "BrowserBase read failed (network or upstream error)",
      },
    ],
  },
  {
    id: "delete-browser-sessions",
    method: "DELETE",
    path: "/browser/sessions?id={id}",
    title: "End Browser Session",
    description:
      "End a BrowserBase session early. Idempotent — safe to call from window.onbeforeunload.",
    queryParams: [
      { name: "id", type: "string", description: "BrowserBase session id" },
    ],
    responseExample: `{
  "ended": true,
  "id": "bb_session_abc123"
}`,
    errors: [
      { code: 401, description: "Unauthorized" },
      {
        code: 503,
        description: "BrowserBase is not configured on this server",
      },
    ],
  },
  {
    id: "get-version",
    method: "GET",
    path: "/api/version",
    title: "Version Check",
    description:
      "Compare installed version against the latest GitHub release. Unauthenticated. Cached upstream of GitHub for 1 hour.",
    responseExample: `{
  "current": "${APP_VERSION}",
  "engine": "${ENGINE_VERSION}",
  "latest": "${APP_VERSION}",
  "status": "up-to-date",
  "message": "You're running the latest version.",
  "release_url": "https://github.com/${APP_REPO}/releases/tag/v${APP_VERSION}"
}`,
    notes: [
      "status: up-to-date | behind | ahead | unknown",
      "When status is unknown, current/latest may still be populated from cache.",
    ],
    errors: [],
  },
  {
    id: "get-finding-types",
    method: "GET",
    path: "/api/v3/finding-types",
    title: "Finding Types",
    description:
      "Returns the full catalogue of detection checks. Use this to display human-readable titles, categorize findings, or build SDKs that know every check ID ahead of time.",
    responseExample: `{
  "success": true,
  "count": 709,
  "categories": {
    "headers": 107,
    "content": 194,
    "code": 127,
    "configuration": 48,
    "information-disclosure": 33,
    "secrets-extended": 54,
    "api": 43,
    "email": 28,
    "tls": 20,
    "dns": 23,
    "cookies": 22,
    "ssl": 10
  },
  "data": [
    {
      "id": "hsts-missing",
      "type": "header",
      "title": "HSTS Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "HTTP Strict Transport Security header is not set."
    },
    {
      "id": "csp-missing",
      "type": "header",
      "title": "Content Security Policy Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "Content Security Policy header is not set."
    }
  ]
}`,
    notes: [
      "Unauthenticated.",
      "Backed by lib/scanner/checks-data/*.json (709+ entries across 12 categories).",
      "Each category has its own JSON file and inline detector module under lib/scanner/checks/.",
      "type values: header | combined | content | etc. (per-checks-data/<category>.json schema).",
    ],
    errors: [],
  },
  {
    id: "get-keys",
    method: "GET",
    path: "/keys",
    title: "List API Keys",
    description:
      "List API keys for the authenticated user. Secret values are never returned.",
    responseExample: `{
  "keys": [
    {
      "id": 1,
      "name": "CI",
      "prefix": "vr_live_abc12345",
      "created_at": "2026-03-10T15:30:00.000Z",
      "last_used_at": "2026-03-10T16:00:00.000Z",
      "daily_limit": 150,
      "revoked_at": null
    }
  ]
}`,
    errors: [{ code: 401, description: "Unauthorized (session required)" }],
  },
  {
    id: "post-keys",
    method: "POST",
    path: "/keys",
    title: "Create API Key",
    description:
      "Generate a new API key. The raw value is returned ONLY in this response — copy and store it immediately. Up to 3 active keys per user.",
    requestBody: `{
  "name": "CI"
}`,
    responseExample: `{
  "id": 1,
  "name": "CI",
  "key": {
    "raw_key": "vr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "prefix": "vr_live_xxxxxxxx",
    "daily_limit": 50
  }
}`,
    notes: [
      "raw_key is shown exactly once. The server stores only the encrypted form + a SHA-256 fingerprint.",
      "Default daily_limit comes from CONFIG_DEFAULT_API_KEY_DAILY_LIMIT (50).",
    ],
    errors: [
      { code: 400, description: "Maximum of 3 active keys reached" },
      { code: 401, description: "Unauthorized" },
    ],
  },
  {
    id: "post-keys-rotate",
    method: "POST",
    path: "/keys/[id]/rotate",
    title: "Rotate API Key",
    description:
      "Hard-delete the key and create a new one with the same name. Returns the new raw key once.",
    pathParams: [
      { name: "id", type: "number", description: "Key ID to rotate" },
    ],
    responseExample: `{
  "id": 2,
  "name": "CI",
  "key": { "raw_key": "vr_live_…", "prefix": "vr_live_…", "daily_limit": 50 }
}`,
    errors: [
      { code: 401, description: "Unauthorized" },
      { code: 404, description: "Key not found" },
    ],
  },
  {
    id: "post-keys-revoke",
    method: "POST",
    path: "/keys/[id]/revoke",
    title: "Revoke API Key",
    description:
      "Set revoked_at on the key. The key stops working immediately.",
    pathParams: [
      { name: "id", type: "number", description: "Key ID to revoke" },
    ],
    responseExample: `{
  "success": true
}`,
    errors: [
      { code: 401, description: "Unauthorized" },
      { code: 404, description: "Key not found" },
    ],
  },
];

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "authentication", label: "Authentication" },
  { id: "endpoints", label: "Endpoints" },
  ...endpoints.map((e) => ({ id: e.id, label: e.title, level: 2 })),
  { id: "code-examples", label: "Code Examples" },
  { id: "rate-limiting", label: "Rate Limiting" },
  { id: "error-handling", label: "Error Handling" },
  { id: "best-practices", label: "Best Practices" },
];

const codeExamples = {
  curl: {
    scan: `curl -X POST "${APP_URL}/api/v3/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "example.com", "probes": ["ssh:22", "smtp:587"]}'`,
    history: `curl -X GET "${APP_URL}/api/v3/history" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    detail: `curl -X GET "${APP_URL}/api/v3/history/123" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
  },
  javascript: {
    scan: `const response = await fetch('${APP_URL}/api/v3/scan', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'example.com',
    probes: ['ssh:22', 'smtp:587']
  })
});
const data = await response.json();
console.log(data.findings);`,
    history: `const response = await fetch('${APP_URL}/api/v3/history', {
  headers: { 'Authorization': 'Bearer YOUR_API_KEY' }
});
const { scans } = await response.json();`,
    detail: `const response = await fetch('${APP_URL}/api/v3/history/123', {
  headers: { 'Authorization': 'Bearer YOUR_API_KEY' }
});
const scan = await response.json();`,
  },
  python: {
    scan: `import requests

response = requests.post(
    '${APP_URL}/api/v3/scan',
    headers={'Authorization': 'Bearer YOUR_API_KEY'},
    json={
        'url': 'example.com',
        'probes': ['ssh:22', 'smtp:587']
    }
)
data = response.json()
print(f"Found {len(data['findings'])} vulnerabilities")`,
    history: `import requests

response = requests.get(
    '${APP_URL}/api/v3/history',
    headers={'Authorization': 'Bearer YOUR_API_KEY'}
)
scans = response.json()['scans']`,
    detail: `import requests

response = requests.get(
    '${APP_URL}/api/v3/history/123',
    headers={'Authorization': 'Bearer YOUR_API_KEY'}
)
scan = response.json()`,
  },
};

export default function APIDocsPage() {
  const { setActiveSection, setTocItems } = useDocsContext();
  const [activeCodeTab, setActiveCodeTab] = useState<
    "curl" | "javascript" | "python"
  >("curl");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setTocItems(tocItems);
    return () => setTocItems([]);
  }, [setTocItems]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );

    tocItems.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [setActiveSection]);

  return (
    <div className="space-y-16">
      <DocsHero
        badge="v3 API"
        title="API Reference"
        description={`Complete documentation for the ${APP_NAME} REST API. Integrate automated vulnerability scanning into your applications, CI/CD pipelines, or custom security tools.`}
        stats={[
          { value: "v3", label: "Current API version" },
          { value: "By plan", label: "Daily quota" },
          { value: "Bearer", label: "Auth method" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <p className="text-sm sm:text-base text-muted-foreground">
          The v3 API is the current, supported version. v1 and v2 are no longer
          supported — older versions of VulnRadar retain their historical
          endpoints.
        </p>
        <p className="text-sm sm:text-base text-muted-foreground">
          All endpoints live under <code>{APP_URL}/api/v3/</code>.
          Authentication is either a session cookie or a Bearer API key with the{" "}
          <code>vr_live_</code> prefix (default{" "}
          <code>CONFIG_API_KEY_PREFIX</code>).
        </p>
      </DocsSection>

      <DocsSection id="authentication" title="Authentication">
        <Card className="p-4 sm:p-6 border-border/40">
          <h3 className="font-semibold mb-4">Bearer token</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Include your API key in the Authorization header:
          </p>
          <CodeBlock
            code="Authorization: Bearer YOUR_API_KEY_HERE"
            language="http"
          />

          <div className="mt-6 pt-6 border-t border-border/40">
            <h4 className="font-semibold mb-3 text-sm">Getting an API key</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Sign in to your {APP_NAME} account.</li>
              <li>
                Open <strong className="text-foreground">Profile</strong> →{" "}
                <strong className="text-foreground">API Keys</strong>.
              </li>
              <li>
                Click{" "}
                <strong className="text-foreground">Generate New Key</strong>.
              </li>
              <li>
                Copy and store the raw key (shown only once). Server stores only
                an AES-256-GCM-encrypted form + a SHA-256 fingerprint.
              </li>
            </ol>
          </div>

          <DocsCallout variant="warning" title="Security" className="mt-6">
            <p>
              Never share API keys or commit them to version control. Each
              account is limited to 3 active API keys. Rotate via{" "}
              <code>POST /api/v3/keys/[id]/rotate</code>.
            </p>
          </DocsCallout>
        </Card>
      </DocsSection>

      <DocsSection id="endpoints" title="Endpoints">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 -mt-2">
          <div className="text-xs sm:text-sm text-muted-foreground">
            Base URL:{" "}
            <code className="bg-secondary px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[10px] sm:text-xs break-all">
              {APP_URL}/api/v3
            </code>
          </div>
          <div className="text-xs text-muted-foreground">
            {endpoints.length} documented
          </div>
        </div>

        <div className="space-y-6 mt-4">
          {endpoints.map((endpoint) => (
            <EndpointCard key={endpoint.id} {...endpoint} />
          ))}
        </div>
      </DocsSection>

      <DocsSection id="code-examples" title="Code Examples">
        <p className="text-muted-foreground">
          Reference implementations in three languages.
        </p>

        <Card className="p-6 border-border/40">
          <div className="flex gap-1 mb-6 border-b border-border">
            {(["curl", "javascript", "python"] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setActiveCodeTab(lang)}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium transition-all duration-200 capitalize relative",
                  activeCodeTab === lang
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
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
              <h4 className="font-semibold mb-3 text-sm">Create a scan</h4>
              <CodeBlock
                code={codeExamples[activeCodeTab].scan}
                language={activeCodeTab === "curl" ? "bash" : activeCodeTab}
              />
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">List scan history</h4>
              <CodeBlock
                code={codeExamples[activeCodeTab].history}
                language={activeCodeTab === "curl" ? "bash" : activeCodeTab}
              />
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Get scan details</h4>
              <CodeBlock
                code={codeExamples[activeCodeTab].detail}
                language={activeCodeTab === "curl" ? "bash" : activeCodeTab}
              />
            </div>
          </div>
        </Card>
      </DocsSection>

      <DocsSection id="rate-limiting" title="Rate Limiting">
        <Card className="p-6 border-border/40">
          <p className="text-muted-foreground mb-6">
            Per-API-key daily quota plus per-IP burst limits on auth endpoints.
            Full reference on the{" "}
            <a
              href="/docs/rate-limits"
              className="text-primary hover:underline"
            >
              Rate Limits
            </a>{" "}
            page.
          </p>

          <div className="space-y-6">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Daily quotas by plan
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { scans: "25", api: "25", label: "Free" },
                  { scans: "100", api: "100", label: "Core" },
                  { scans: "150", api: "5,000", label: "Pro" },
                  {
                    scans: "500",
                    api: "Unlimited",
                    label: "Elite",
                    highlight: true,
                  },
                ].map((plan) => (
                  <div
                    key={plan.label}
                    className={cn(
                      "p-3 rounded-lg border text-center",
                      plan.highlight
                        ? "bg-primary/5 border-primary/30"
                        : "bg-secondary/30 border-border/40",
                    )}
                  >
                    <div className="text-sm font-mono">
                      <span className="font-bold">{plan.scans}</span>
                      <span className="text-muted-foreground"> scans</span>
                    </div>
                    <div className="text-sm font-mono">
                      <span className="font-bold">{plan.api}</span>
                      <span className="text-muted-foreground"> API</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {plan.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Response headers
              </h4>
              <CodeBlock
                code={`HTTP/1.1 200 OK
X-RateLimit-Limit: 150
X-RateLimit-Remaining: 147
X-RateLimit-Used: 3
X-RateLimit-Policy: daily
X-RateLimit-Reset: 2026-03-12T00:00:00.000Z`}
                language="http"
              />
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                429 response
              </h4>
              <CodeBlock
                code={`{
  "error": "Daily scan limit reached. Resets at 2026-03-12T00:00:00Z.",
  "limit": 150,
  "used": 150,
  "remaining": 0,
  "resets_at": "2026-03-12T00:00:00Z"
}`}
                language="json"
              />
            </div>

            <DocsCallout variant="info" title="Web Sessions vs API Keys">
              <p>
                Session-cookie scans use a separate counter (per-user daily
                quota). API-key scans use a per-key counter. Both share the same{" "}
                <code>X-RateLimit-*</code> headers but the <code>Reset</code>{" "}
                semantics differ — see the Rate Limits page.
              </p>
            </DocsCallout>
          </div>
        </Card>
      </DocsSection>

      <DocsSection id="error-handling" title="Error Handling">
        <Card className="p-6 border-border/40">
          <p className="text-muted-foreground mb-6">
            Standard HTTP status codes. Error responses include a JSON body with
            at minimum an <code>error</code> string.
          </p>

          <div className="space-y-4">
            {[
              {
                code: 400,
                title: "Bad Request",
                description:
                  "Missing or invalid request body. Check the field names and types.",
              },
              {
                code: 401,
                title: "Unauthorized",
                description:
                  "No session cookie, no Bearer token, or token is revoked/expired.",
              },
              {
                code: 403,
                title: "Forbidden",
                description:
                  "Authenticated, but not authorized for this resource (e.g. trying to delete another user's scan).",
              },
              {
                code: 404,
                title: "Not Found",
                description:
                  "Resource does not exist or is not accessible to the caller.",
              },
              {
                code: 422,
                title: "Unprocessable Entity",
                description:
                  "Target URL is unreachable, blocks requests, is on a private IP, or fails SSRF checks.",
              },
              {
                code: 429,
                title: "Too Many Requests",
                description:
                  "Daily quota exceeded or per-IP burst limit hit. Honor Retry-After.",
              },
              {
                code: 500,
                title: "Server Error",
                description:
                  "Unexpected server-side failure. Retry with backoff; contact support if persistent.",
              },
            ].map((error) => (
              <div
                key={error.code}
                className="flex items-start gap-4 p-3 rounded-lg bg-secondary/20"
              >
                <Badge
                  variant="outline"
                  className="font-mono text-xs flex-shrink-0"
                >
                  {error.code}
                </Badge>
                <div>
                  <h4 className="font-semibold text-sm mb-1">{error.title}</h4>
                  <p className="text-xs text-muted-foreground">
                    {error.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </DocsSection>

      <DocsSection id="best-practices" title="Best Practices">
        <Card className="p-6 border-border/40">
          <div className="grid gap-6 sm:grid-cols-2">
            {[
              {
                title: "Secure key storage",
                description:
                  "Never hardcode API keys. Use environment variables or a secrets vault. Rotate via /keys/[id]/rotate periodically.",
              },
              {
                title: "Honor rate-limit headers",
                description:
                  "Read X-RateLimit-Remaining after each call. Slow down before you hit 429.",
              },
              {
                title: "Validate URLs first",
                description:
                  "Ensure URLs are valid, public, and not on localhost / private networks before scanning. Avoid SSRF by pre-validating.",
              },
              {
                title: "Retry 5xx with backoff",
                description:
                  "Transient server errors (500, 502, 503) should be retried with exponential backoff. 429 should respect Retry-After.",
              },
              {
                title: "Cache findings",
                description:
                  "Use /api/v3/finding-types to look up stable IDs and titles. Cache scan results to avoid re-scanning unchanged targets.",
              },
              {
                title: "Watch your quota",
                description:
                  "Subscribe to webhook notifications for scan-complete events. Set up alerts when X-RateLimit-Used exceeds 80% of limit.",
              },
            ].map((practice, i) => (
              <div
                key={i}
                className="p-4 rounded-lg bg-secondary/20 border border-border/40"
              >
                <h4 className="font-semibold text-sm mb-2">{practice.title}</h4>
                <p className="text-xs text-muted-foreground">
                  {practice.description}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </DocsSection>
    </div>
  );
}
