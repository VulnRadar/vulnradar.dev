"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { KeyRound, Code2, CheckCircle2 } from "lucide-react";
import {
  APP_URL,
  APP_NAME,
  APP_REPO,
  APP_VERSION,
  ENGINE_VERSION,
} from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";
import { useDocsContext, type TocItem } from "@/components/docs/docs-shell";
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  DocsTable,
  EndpointCard,
  EndpointTable,
  CodeBlock,
  InlineCode,
  type Endpoint,
} from "@/components/docs";

const endpoints: Endpoint[] = [
  {
    id: "post-scan",
    method: "POST",
    path: "/scan",
    title: "Create a Scan",
    description:
      "Start a vulnerability scan against a target. Pass a hostname or a full URL; we auto-prepend https:// if you omit the scheme. Service probes are opt-in via the probes field. The scan runs as a background job: this call returns immediately with a scan id, and you poll GET /scan/status/{scanId} for progress and the final result.",
    requestBody: `{
  "url": "example.com",
  "probes": ["ssh:22", "smtp:587"]
}`,
    responseExample: `{
  "scanId": 12345,
  "status": "running"
}`,
    notes: [
      "url accepts a bare hostname (auto-prepended https://), a full URL with an http/https/ws/wss/ftp/ftps/ssh/smtp/imap/imaps/pop3/pop3s/mongodb scheme, or a public IPv4 literal (probe-only mode).",
      "Raw IPv4: web checks (headers, ssl, tls, cookies, content, info, configuration, code, secrets, api) are skipped, because there is no hostname context for them. DNS, email, and your selected service probes still run.",
      'probes is an array of "<service>:<port>" strings. Supported services: ssh, smtp, imap, pop3, ftp, mongodb. Default port is used if you omit it. Each probe opens a TCP socket to the hostname or IP, reads the banner, and reports version disclosure and reachability.',
      "scanners (advanced) accepts category names to restrict web checks: headers, ssl, tls, content, cookies, configuration, information-disclosure, dns, email, api, code, secrets-extended, vibe-code, client-side, supply-chain, host-validation. Omit to run all 16 categories.",
      "Service probes are independent of the URL scheme: you can ask for an SSH probe on an https:// target or a raw IPv4.",
      "SSRF protection rejects localhost and private IP targets.",
      "A scan_history row is created before scanning starts, in status pending, then running. Poll GET /scan/status/{scanId} (see below) for progress and the completed result; there is no synchronous response body with findings on this endpoint anymore.",
      "Webhooks and scan-complete emails fire when the background job finishes, not when this request returns.",
    ],
    errors: [
      { code: 400, description: "Missing or invalid URL" },
      {
        code: 401,
        description: "Unauthorized (session cookie or Bearer API key required)",
      },
      { code: 429, description: "Rate limit or daily quota exceeded" },
      { code: 500, description: "Failed to create the scan job; retry" },
    ],
  },
  {
    id: "get-scan-status",
    method: "GET",
    path: "/scan/status/{id}",
    title: "Get Scan Job Status",
    description:
      "Poll a scan job started by POST /scan or POST /scan/crawl. Returns live progress while the job runs and the full result once it completes.",
    pathParams: [
      { name: "id", type: "number", required: true, description: "Scan id" },
    ],
    responseExample: `{
  "status": "running",
  "currentCategory": "headers",
  "categoriesCompleted": 4,
  "categoriesTotal": 12,
  "elapsedMs": 1820
}`,
    notes: [
      "status is one of pending, running, completed, failed.",
      'When status is "completed", the response also includes result: { url, scannedAt, duration, findings, summary, responseHeaders, scanHistoryId, ...checksRun/other result metadata }.',
      'When status is "failed", the response also includes error: a human-readable failure reason (including "Cancelled" if you cancelled it yourself).',
      "A scan that exceeds its time budget (300s for a single scan, 900s crawl, 1800s bulk) is force-failed by a server-side watchdog rather than left at running forever.",
      "Owner-only: returns 404 for a scan id that does not exist or belongs to another user.",
    ],
    errors: [
      { code: 401, description: "Unauthorized" },
      { code: 404, description: "Scan not found or access denied" },
    ],
  },
  {
    id: "delete-scan-status",
    method: "DELETE",
    path: "/scan/status/{id}",
    title: "Cancel a Scan Job",
    description:
      "Cancel a scan that is still pending or running. Has no effect on a scan that already finished.",
    pathParams: [
      { name: "id", type: "number", required: true, description: "Scan id" },
    ],
    responseExample: `{
  "status": "failed",
  "cancelled": true
}`,
    notes: [
      'The scan is marked failed with error: "Cancelled" immediately; it does not wait for the background job to notice.',
    ],
    errors: [
      { code: 401, description: "Unauthorized" },
      { code: 404, description: "Scan not found or access denied" },
      {
        code: 409,
        description:
          "The scan already reached a terminal state; there is nothing to cancel",
      },
    ],
  },
  {
    id: "post-scan-authenticated",
    method: "POST",
    path: "/scan/authenticated",
    title: "Authenticated Scan",
    description:
      "Scan a single page after logging in first. Credentials are supplied in this one request and are never stored: they live only in memory for the duration of the call. Unlike POST /scan, this endpoint is synchronous (no polling) and scans exactly one page; it does not crawl.",
    requestBody: `{
  "url": "https://example.com/dashboard",
  "auth": {
    "method": "form",
    "loginUrl": "https://example.com/login",
    "username": "demo@example.com",
    "password": "correct-horse-battery-staple"
  }
}`,
    responseExample: `{
  "scanHistoryId": 12345,
  "url": "https://example.com/dashboard",
  "scannedAt": "2026-08-05T15:30:00.000Z",
  "duration": 2210,
  "findings": [],
  "summary": { "critical": 0, "high": 0, "medium": 1, "low": 0, "info": 0, "total": 1 },
  "responseHeaders": { "content-type": "text/html; charset=utf-8" },
  "authReport": { "status": "authenticated", "method": "form" }
}`,
    notes: [
      'auth.method is "form", "header", or "cookie". Form auth opens an ephemeral, real browser session (via BrowserBase) so a JavaScript-rendered login page gets a chance to appear before the login form is located and submitted as a normal HTTP POST; header and cookie auth attach the given values directly to every request instead of logging in.',
      "Nothing under auth is ever written to a database table, a log line, or an audit record. The audit log and scan_history only record the non-secret fact that an authenticated scan ran, its method, and its outcome.",
      'authReport.status is "authenticated" on a normal run, "lost" if the authenticated session appears to have dropped partway through (e.g. a redirect back to the login page), or "failed" if login itself never succeeded, in which case authReport.reason explains why and no scan runs.',
      "If the login page turns out to be a Cloudflare challenge or a CAPTCHA, that is reported as a failed login with a reason describing the block, not silently treated like a wrong password.",
      "Runs the same detector set as an unauthenticated single-page scan (the legacy per-category checks plus DNS/TLS/email async checks); it does not yet run the newer page-content checks described below.",
      'Gated by the "Authenticated scanning" admin setting; returns 403 if disabled on this deployment.',
    ],
    errors: [
      {
        code: 400,
        description: "Invalid request body or URL blocked for security reasons",
      },
      { code: 401, description: "Unauthorized" },
      {
        code: 403,
        description:
          "Authenticated scanning is disabled on this deployment, or the target is not scannable",
      },
      {
        code: 422,
        description:
          "Login failed or could not be confirmed; see authReport.reason",
      },
      { code: 429, description: "Rate limit or daily quota exceeded" },
      {
        code: 502,
        description:
          "Login succeeded but the target could not be reached afterward",
      },
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
      "Crawl the target and scan each discovered page. Either provide a pre-selected URL list or let the crawler discover links. Up to 15 pages per crawl. Like POST /scan, this runs as a background job: the call returns immediately with a scan id, and you poll GET /scan/status/{scanId} for progress and the final aggregate result.",
    requestBody: `{
  "url": "https://example.com",
  "urls": ["https://example.com/about", "https://example.com/contact"]
}`,
    responseExample: `{
  "scanId": 12346,
  "status": "running"
}`,
    notes: [
      "Max 15 pages (MAX_PAGES in app/api/v3/scan/crawl/route.ts).",
      "All pages must share the entry URL's hostname (same-origin).",
      "For session auth, each scanned page counts as one daily quota unit.",
      "For Bearer auth, the entire crawl counts as one quota unit.",
      "Poll GET /scan/status/{scanId}: the completed result's result.crawl field carries { pagesDiscovered, pagesScanned, pagesSkipped, pages: [...] } alongside the aggregate findings and summary.",
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
    pathParams: [
      { name: "id", type: "number", required: true, description: "Scan ID" },
    ],
    responseExample: `{
  "url": "https://example.com",
  "scannedAt": "2026-03-10T15:30:00.000Z",
  "duration": 1423,
  "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
  "findings": [
    { /* full Vulnerability object, see /scan response */ }
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
      {
        name: "id",
        type: "number",
        required: true,
        description: "Scan ID to delete",
      },
    ],
    responseExample: `{
  "success": true,
  "message": "Scan deleted successfully"
}`,
    errors: [
      { code: 401, description: "Unauthorized" },
      { code: 403, description: "Forbidden: not the scan owner" },
      { code: 404, description: "Scan not found" },
    ],
  },
  {
    id: "patch-history-id",
    method: "PATCH",
    path: "/history/[id]",
    title: "Update Scan Notes",
    description: "Update the user note on a scan. Owner only.",
    pathParams: [
      { name: "id", type: "number", required: true, description: "Scan ID" },
    ],
    requestBody: `{
  "notes": "Investigating HSTS issue with infra team"
}`,
    responseExample: `{
  "success": true
}`,
    errors: [
      { code: 400, description: "Notes longer than 2000 characters" },
      { code: 401, description: "Unauthorized" },
      { code: 403, description: "Forbidden: not the scan owner" },
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
      "BrowserBase does NOT accept a `?goto=` parameter: navigation must go through CDP. See https://docs.browserbase.com/platform/browser/observability/session-live-view for the embed pattern.",
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
      {
        name: "id",
        type: "string",
        required: true,
        description: "BrowserBase session id",
      },
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
      "End a BrowserBase session early. Idempotent, so it is safe to call from window.onbeforeunload.",
    queryParams: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "BrowserBase session id",
      },
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
  "count": 695,
  "categories": {
    "content": 148,
    "headers": 130,
    "code": 112,
    "secrets-extended": 55,
    "information-disclosure": 40,
    "api": 32,
    "vibe-code": 31,
    "cookies": 32,
    "tls": 20,
    "configuration": 18,
    "email": 18,
    "client-side": 16,
    "supply-chain": 15,
    "dns": 13,
    "ssl": 8,
    "host-validation": 7
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
      "Backed by lib/scanner/checks-data/*.json (652 legacy checks) plus lib/scanner/checks/page-checks/ (43 checks on the newer PageCheck architecture, described in Architecture): 695 entries across 16 categories at the time of writing. Read count from the response rather than hardcoding it.",
      "Each legacy category has its own JSON file and a matching detector module under lib/scanner/checks/. The newer page-content checks declare their own metadata inline instead of a JSON file.",
      "type values come from the per-category JSON schema: header, combined, content, and so on.",
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
      "Generate a new API key. The raw value is returned ONLY in this response, so copy and store it immediately. Up to 3 active keys per user.",
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
      {
        name: "id",
        type: "number",
        required: true,
        description: "Key ID to rotate",
      },
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
      {
        name: "id",
        type: "number",
        required: true,
        description: "Key ID to revoke",
      },
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
  -d '{"url": "example.com", "probes": ["ssh:22", "smtp:587"]}'
# → { "scanId": 12345, "status": "running" }

# Poll until status is completed or failed
curl "${APP_URL}/api/v3/scan/status/12345" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    history: `curl -X GET "${APP_URL}/api/v3/history" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    detail: `curl -X GET "${APP_URL}/api/v3/history/123" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
  },
  javascript: {
    scan: `const started = await fetch('${APP_URL}/api/v3/scan', {
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
const { scanId } = await started.json();

// Poll until status is completed or failed
async function waitForScan(id) {
  for (;;) {
    const res = await fetch(\`${APP_URL}/api/v3/scan/status/\${id}\`, {
      headers: { 'Authorization': 'Bearer YOUR_API_KEY' },
    });
    const job = await res.json();
    if (job.status === 'completed') return job.result;
    if (job.status === 'failed') throw new Error(job.error);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const result = await waitForScan(scanId);
console.log(result.findings);`,
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
    scan: `from vulnradar import VulnRadar

client = VulnRadar(api_key='YOUR_API_KEY')

result = client.scan('example.com')

print(f"Total findings: {result.summary.total}")
print(f"Critical: {result.summary.critical}")

for finding in result.findings:
    print(f"[{finding.severity.value.upper()}] {finding.title}")`,
    history: `from vulnradar import VulnRadar

client = VulnRadar(api_key='YOUR_API_KEY')

history = client.history.list()

for scan in history.scans:
    print(scan.id, scan.url, scan.scanned_at)
    print(f"  Findings: {scan.findings_count}")`,
    detail: `from vulnradar import VulnRadar

client = VulnRadar(api_key='YOUR_API_KEY')

result = client.history.get(123)

print(result.url)
for finding in result.findings:
    print(finding.title, finding.severity)`,
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
        <div className="max-w-[68ch] space-y-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          <p>
            Every endpoint lives under{" "}
            <InlineCode>{APP_URL}/api/v3/</InlineCode>. v3 is the only version
            this build ships:{" "}
            <InlineCode>CONFIG_API_SUPPORTED_VERSIONS</InlineCode> is{" "}
            <InlineCode>[&quot;v3&quot;]</InlineCode> and there is no{" "}
            <InlineCode>/api/v1</InlineCode> or <InlineCode>/api/v2</InlineCode>{" "}
            route tree to fall back to.
          </p>
          <p>
            Authentication is either the session cookie the web app already
            holds, or a Bearer API key prefixed{" "}
            <InlineCode>vr_live_</InlineCode> (
            <InlineCode>CONFIG_API_KEY_PREFIX</InlineCode>). Which one you use
            changes how quota is counted, so read{" "}
            <Link
              href="/docs/rate-limits"
              className="text-primary underline-offset-2 hover:underline"
            >
              Rate Limits
            </Link>{" "}
            before you wire this into CI.
          </p>
        </div>
      </DocsSection>

      <DocsSection id="authentication" title="Authentication" icon={KeyRound}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
          <div className="min-w-0 space-y-3">
            <h3 className="text-base font-medium text-foreground">
              Getting a key
            </h3>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-primary">
              <li>Sign in to your {APP_NAME} account.</li>
              <li>
                Open <strong className="text-foreground">Profile</strong>, then{" "}
                <strong className="text-foreground">API Keys</strong>.
              </li>
              <li>
                Click{" "}
                <strong className="text-foreground">Generate New Key</strong>.
              </li>
              <li>
                Copy the raw key now. It is shown once. The server keeps only an
                AES-256-GCM-encrypted copy and a SHA-256 fingerprint, so it
                cannot show it to you again.
              </li>
            </ol>
          </div>

          <div className="min-w-0 space-y-4">
            <CodeBlock
              code="Authorization: Bearer YOUR_API_KEY_HERE"
              language="http"
            />
            <DocsCallout variant="warning" title="Three keys, and they leak">
              <p>
                Each account is capped at 3 active keys. Keep them out of
                version control and rotate with{" "}
                <InlineCode>POST /api/v3/keys/[id]/rotate</InlineCode>, which
                deletes the old key in the same call.
              </p>
            </DocsCallout>
          </div>
        </div>
      </DocsSection>

      <DocsSection id="endpoints" title="Endpoints">
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <dt>Base URL</dt>
            <dd>
              <InlineCode className="break-all text-foreground">
                {APP_URL}/api/v3
              </InlineCode>
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>Documented endpoints</dt>
            <dd className="tabular-nums text-foreground">{endpoints.length}</dd>
          </div>
        </dl>

        <EndpointTable
          caption="Every documented endpoint, with a link to its full reference"
          endpoints={endpoints.map((e) => ({
            method: e.method,
            endpoint: e.path,
            description: e.title,
          }))}
        />

        <div className="space-y-6">
          {endpoints.map((endpoint) => (
            <EndpointCard key={endpoint.id} {...endpoint} />
          ))}
        </div>
      </DocsSection>

      <DocsSection id="code-examples" title="Code Examples" icon={Code2}>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          The same three calls in curl, JavaScript, and Python. Swap the
          placeholder key and they run as-is. The Python tab uses the official
          SDK (<InlineCode>pip install vulnradar</InlineCode>, source at{" "}
          <a
            href="https://github.com/VulnRadar/Python-SDK"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            github.com/VulnRadar/Python-SDK
          </a>
          ) instead of raw HTTP calls.
        </p>

        <div>
          <div
            role="tablist"
            aria-label="Example language"
            className="mb-6 flex gap-1 border-b border-border"
          >
            {(["curl", "javascript", "python"] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                role="tab"
                id={`code-tab-${lang}`}
                aria-selected={activeCodeTab === lang}
                aria-controls="code-tabpanel"
                onClick={() => setActiveCodeTab(lang)}
                className={cn(
                  "relative -mb-px border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-sm",
                  activeCodeTab === lang
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {lang}
              </button>
            ))}
          </div>

          <div
            id="code-tabpanel"
            role="tabpanel"
            aria-labelledby={`code-tab-${activeCodeTab}`}
            className="space-y-8"
          >
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
        </div>
      </DocsSection>

      <DocsSection id="rate-limiting" title="Rate Limiting">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          A per-key daily quota, plus per-IP burst limits on the auth endpoints.
          The numbers, the reset semantics, and worked backoff code are on the{" "}
          <Link
            href="/docs/rate-limits"
            className="text-primary underline-offset-2 hover:underline"
          >
            Rate Limits
          </Link>{" "}
          page. What follows is the part you need while reading this reference.
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <h3 className="text-base font-medium text-foreground">
              Headers on a successful response
            </h3>
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
          <div className="min-w-0 space-y-2">
            <h3 className="text-base font-medium text-foreground">
              Body of a 429
            </h3>
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
        </div>

        <DocsCallout variant="info" title="Sessions and keys count separately">
          <p>
            A scan run from the web app decrements a per-user counter. A scan
            run with a Bearer key decrements that key&apos;s counter. Both emit
            the same <InlineCode>X-RateLimit-*</InlineCode> headers, but the
            reset is midnight UTC for sessions and a rolling 24 hours for keys.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="error-handling" title="Error Handling">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Standard HTTP status codes. Every error body carries at least an{" "}
          <InlineCode>error</InlineCode> string; quota errors add the counters
          shown above.
        </p>

        <DocsTable
          caption="HTTP status codes returned by the v3 API"
          columns={[
            { key: "code", header: "Status", className: "font-mono" },
            { key: "title", header: "Meaning" },
            {
              key: "description",
              header: "When you see it",
              className: "w-full",
            },
          ]}
          data={[
            {
              code: "400",
              title: "Bad Request",
              description:
                "Missing or invalid request body. Check the field names and types.",
            },
            {
              code: "401",
              title: "Unauthorized",
              description:
                "No session cookie, no Bearer token, or the token is revoked or expired.",
            },
            {
              code: "403",
              title: "Forbidden",
              description:
                "Authenticated but not authorised for this resource, such as deleting another user's scan.",
            },
            {
              code: "404",
              title: "Not Found",
              description:
                "The resource does not exist, or it exists and is not visible to this caller.",
            },
            {
              code: "422",
              title: "Unprocessable Entity",
              description:
                "The target is unreachable, blocks the request, resolves to a private IP, or fails the SSRF check.",
            },
            {
              code: "429",
              title: "Too Many Requests",
              description:
                "Daily quota exhausted or per-IP burst limit hit. Honour Retry-After.",
            },
            {
              code: "500",
              title: "Server Error",
              description:
                "Unexpected server-side failure. Retry with backoff, and open an issue if it persists.",
            },
          ]}
        />
      </DocsSection>

      <DocsSection
        id="best-practices"
        title="Before You Ship This"
        icon={CheckCircle2}
      >
        <dl className="max-w-[80ch] divide-y divide-border/50 border-y border-border/50">
          {[
            {
              title: "Keep the key out of the repo",
              description:
                "Environment variable or secrets vault, never a literal. Rotate with POST /keys/[id]/rotate, which invalidates the old key in the same call.",
            },
            {
              title: "Read X-RateLimit-Remaining, not the 429",
              description:
                "Slowing down at 20 remaining costs nothing. Discovering the limit by hitting it costs you the request and a Retry-After wait.",
            },
            {
              title: "Validate the target before you send it",
              description:
                "The server rejects localhost and private ranges, but a client-side check turns a 422 round trip into a local error.",
            },
            {
              title: "Retry 5xx, respect 429",
              description:
                "Exponential backoff on 500, 502, and 503. On 429 wait exactly what Retry-After says; backing off faster does not help.",
            },
            {
              title: "Cache by finding id",
              description:
                "Check ids are stable across scans and releases. GET /api/v3/finding-types gives you the whole catalogue in one unauthenticated call.",
            },
            {
              title: "Let webhooks tell you it finished",
              description:
                "Polling /history burns quota. A webhook fires once per completed scan and costs nothing.",
            },
          ].map((practice) => (
            <div key={practice.title} className="py-3">
              <dt className="text-sm font-medium text-foreground">
                {practice.title}
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {practice.description}
              </dd>
            </div>
          ))}
        </dl>
      </DocsSection>
    </div>
  );
}
