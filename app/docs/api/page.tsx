import Link from "next/link";
import {
  APP_URL,
  APP_NAME,
  APP_REPO,
  APP_VERSION,
  ENGINE_VERSION,
} from "@/lib/config/constants";
import {
  EXACT_LEGACY_CHECK_COUNT,
  EXACT_PAGE_CHECK_COUNT,
  EXACT_CHECK_COUNT,
  EXACT_CHECK_CATEGORY_COUNT,
} from "@/lib/config/check-stats.generated";
import { TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { ArrowRight } from "lucide-react";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import { CodeExampleTabs, type CodeExamples } from "./code-example-tabs";
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
      "Start a vulnerability scan against a target. Pass a hostname or a full URL; we auto-prepend https:// if you omit the scheme. A curated port and service sweep is opt-in via portScan. The scan runs as a background job: this call returns immediately with a scan id, and you poll GET /scan/status/{scanId} for progress and the final result.",
    requestBody: `{
  "url": "example.com",
  "portScan": true,
  "captureScreenshot": false,
  "isPublic": false,
  "scanners": ["headers", "ssl", "dns"]
}`,
    responseExample: `{
  "scanId": 12345,
  "status": "running"
}`,
    notes: [
      "url accepts a bare hostname (auto-prepended https://), a full URL with any of the 15 supported schemes, or a public IPv4 literal (probe-only mode). The full set (SUPPORTED_PROTOCOLS in lib/scanner/execute-scan.ts) is http, https, ws, wss, ftp, ftps, ssh, sftp, smtp, smtps, imap, imaps, pop3, pop3s, mongodb. Note that the 400 body this route returns on a rejected scheme names only the first six; sftp and smtps in particular are accepted despite not appearing in that message.",
      "Raw IPv4: web checks (headers, ssl, tls, cookies, content, info, configuration, code, secrets, api) are skipped, because there is no hostname context for them. DNS, email, and the portScan sweep still run.",
      "portScan is a boolean. Set it to true to run a curated sweep of common ports and services (the previous per-service probes array was removed and consolidated into this single flag). Each reachable service has its banner read and is reported for version disclosure and reachability.",
      "portScan is held to the same verified-domain gate as active-probes: port scanning from shared infrastructure is abuse, so a request setting portScan against a domain you have not verified is rejected with 403 before the scan starts.",
      "scanners (advanced) accepts category names to restrict web checks: headers, ssl, tls, content, cookies, configuration, information-disclosure, dns, email, api, code, secrets-extended, vibe-code, client-side, supply-chain, host-validation, reputation, active-probes. Omit to run all 17 default categories. reputation only produces findings when the deployment has WEB_RISK_API_KEY configured. active-probes is opt-in only: it submits real requests to the target (SQLi/XSS/SSTI/command-injection/open-redirect canary payloads, spoofed-Origin CORS reflection, dangerous HTTP methods, X-Forwarded-Host injection, a live GraphQL introspection query) and never runs unless you name it explicitly, even if scanners is omitted.",
      "active-probes additionally requires the target's domain (or its parent) to be a verified domain on your account -- see POST /domains below. A request naming active-probes against an unverified domain is rejected with 403 DOMAIN_NOT_VERIFIED before the scan starts.",
      "To run only some active probes, pass a scoped token in scanners instead of the bare category: active-probes:<id>, where id is one of xss, sqli, ssti, command-injection, open-redirect, graphql, cors, http-methods, x-forwarded-host. List several to select several; the bare active-probes runs them all.",
      "isPublic (boolean, optional) decides whether the finished scan is world-readable at its share URL and whether it feeds the public host-reputation cache. Omit it and the scan inherits your account's 'scans are private by default' setting, which is what an API caller gets silently today if they never set it. Pass it explicitly when the answer matters.",
      "captureScreenshot (boolean, default false) renders a screenshot of the target page. It spins up a real, metered BrowserBase session, so it is never implied and only runs when you ask for it.",
      "The port sweep is independent of the URL scheme: it runs the same way on an https:// target or a raw IPv4.",
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
      {
        code: 403,
        description:
          "active-probes was requested against a domain you haven't verified (DOMAIN_NOT_VERIFIED)",
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
  "scanners": ["headers", "cookies", "content"],
  "isPublic": false,
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
  "dangerScore": 5.4,
  "engineConfidence": 91,
  "responseHeaders": { "content-type": "text/html; charset=utf-8" },
  "authReport": { "status": "authenticated", "method": "form" }
}`,
    notes: [
      "scanners (array of category names, optional) restricts the check set exactly as on POST /scan.",
      "isPublic (boolean, optional) defaults to FALSE here, unlike every other scan-creation path. An authenticated scan sees whatever a logged-in area renders, so it is private unless this request explicitly passes true: neither the account's 'scans are private by default' setting nor the normal is_public default can make it public from either direction.",
      "The response also carries dangerScore (0-10 aggregate risk, anchored to the safety tier) and engineConfidence (50-100, an integer percent), both computed over the same findings array.",
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
      "Submit multiple URLs in one request, up to your plan's URLs-per-bulk-request limit (5/10/25/100 for free/core/pro/elite). Returns immediately with one queued scan id per accepted URL; poll /scan/status/{id} for each. Each URL counts as one dailyScans quota unit, consumed when its scan is queued, regardless of auth method.",
    requestBody: `{
  "urls": [
    "https://example.com",
    "https://example.org",
    "https://example.net"
  ]
}`,
    responseExample: `{
  "total": 3,
  "queued": 2,
  "failed": 1,
  "skipped": 0,
  "results": [
    { "url": "https://example.com/", "success": true, "scanId": 1001, "status": "queued" },
    { "url": "https://example.org/", "success": true, "scanId": 1002, "status": "queued" },
    { "url": "https://example.net/", "success": false, "error": "Could not reach https://example.net/." }
  ]
}`,
    notes: [
      "Max 100 URLs per request as an absolute server ceiling (CONFIG_MAX_URLS_BULK); your plan's own bulkScanUrls limit is usually lower and applies first.",
      "Returns as soon as every URL is queued, not when the scans finish. Each result carries a scanId to poll on /scan/status/{id}; the batch drains one scan at a time under CONFIG_BULK_SCAN_TIMEOUT_SECONDS.",
      "URLs beyond your remaining daily quota are reported in results with success: false rather than being scanned.",
    ],
    errors: [
      { code: 400, description: "Missing or invalid urls array" },
      { code: 401, description: "Unauthorized" },
      { code: 429, description: "Rate limit or daily quota" },
    ],
  },
  {
    id: "post-scan-verify",
    method: "POST",
    path: "/scan/verify",
    title: "AI-Verify a Scan's Findings",
    description:
      "Re-run every finding on a scan you own through AI verification and persist the result: each finding gets aiVerdict (confirmed, possible_fp, or uncertain), aiConfidence, and aiReason written back onto the scan, so a later GET /scan/status/{scanId} or GET /history/{id} shows them in place.",
    requestBody: `{
  "scanHistoryId": 12345
}`,
    responseExample: `{
  "success": true,
  "findings": [
    {
      "id": "hsts-missing",
      "title": "HSTS Header Missing",
      "aiVerdict": "confirmed",
      "aiConfidence": 92,
      "aiReason": "No Strict-Transport-Security header on any response checked."
    }
  ]
}`,
    notes: [
      "Owner-only: scanHistoryId must belong to the caller (session user or the API key's account).",
      "Shares its per-account rate limit with POST /scan/verify-batch, the next card.",
      "Bounded by the account's AI token quota per plan; a BYOK account (its own AI provider key configured) bypasses that cap entirely.",
    ],
    errors: [
      { code: 400, description: "Missing or non-numeric scanHistoryId" },
      { code: 401, description: "Unauthorized" },
      {
        code: 403,
        description:
          "AI disabled in your settings, or the API key is missing scan:write",
      },
      { code: 404, description: "Scan not found or access denied" },
      {
        code: 429,
        description: "AI verification rate limit or AI token quota exceeded",
      },
    ],
  },
  {
    id: "post-scan-verify-batch",
    method: "POST",
    path: "/scan/verify-batch",
    title: "AI-Verify a Findings Array",
    description:
      "Run AI verification over a findings array you supply, without it having to belong to a stored scan. Same per-finding pipeline as POST /scan/verify; the difference is where the findings come from and that nothing is written back to a scan. Use this to verify results you already hold client-side, or findings from a scan you have exported.",
    requestBody: `{
  "url": "https://example.com",
  "findings": [
    {
      "id": "hsts-missing",
      "title": "HSTS Header Missing",
      "severity": "medium",
      "category": "headers",
      "description": "HTTP Strict Transport Security header is not set."
    }
  ]
}`,
    responseExample: `{
  "findings": [
    {
      "id": "hsts-missing",
      "title": "HSTS Header Missing",
      "severity": "medium",
      "category": "headers",
      "description": "HTTP Strict Transport Security header is not set.",
      "aiVerdict": "confirmed",
      "aiConfidence": 92,
      "aiReason": "No Strict-Transport-Security header on any response checked."
    }
  ]
}`,
    notes: [
      "url and findings[] are both required. The response is the same array, enriched in place with aiVerdict, aiConfidence and aiReason. Nothing is persisted.",
      "Shares one rate-limit bucket with POST /scan/verify (RATE_LIMITS.aiVerify, keyed per account), so hitting both routes does not double your effective AI-verification quota.",
      "findings[] is hard-capped by the AI_VERIFY_BATCH_MAX_FINDINGS admin setting, which ships at 50. Unlike /scan/verify, which only ever processes findings already stored on one of your own scans, this route accepts an arbitrary array, so the cap is what stops one request forcing unbounded AI spend. Over the cap is a 400 naming the limit.",
      "Bounded by the account's AI token quota per plan; a BYOK account (its own AI provider key configured) bypasses that cap entirely.",
      "Bearer callers need scan:write, not scan:read: this is treated as part of the active scanning workflow it enriches.",
      "Long-running. maxDuration is 720 seconds, so set a generous client timeout for a large array.",
    ],
    errors: [
      {
        code: 400,
        description:
          "Unparseable body, missing url or findings[], or more findings than AI_VERIFY_BATCH_MAX_FINDINGS",
      },
      { code: 401, description: "Unauthorized, or invalid API key" },
      {
        code: 403,
        description:
          "AI disabled in your settings, or the API key is missing scan:write",
      },
      {
        code: 429,
        description: "AI verification rate limit or AI token quota exceeded",
      },
    ],
  },
  {
    id: "post-history-summary",
    method: "POST",
    path: "/history/{id}/summary",
    title: "Generate an AI Scan Summary",
    description:
      "Generate a short plain-English summary of a completed scan you own and persist it onto the scan's result_meta.aiSummary. A plain call returns the cached summary (no AI call, no rate-limit cost) once one already exists; pass ?regenerate=true to force a fresh one.",
    pathParams: [
      {
        name: "id",
        type: "number",
        required: true,
        description: "Scan (scan_history) id",
      },
    ],
    queryParams: [
      {
        name: "regenerate",
        type: "boolean",
        description: "Force a fresh AI call and overwrite the cached summary",
        default: "false",
      },
    ],
    responseExample: `{
  "success": true,
  "summary": "This scan of example.com found 4 issues, none critical. The most notable is a missing HSTS header, which leaves the first request on a network exposed to downgrade attacks.",
  "cached": true
}`,
    notes: [
      "Owner-only: {id} must belong to the caller (session user or the API key's account).",
      "Unmetered against the AI token quota (summaries are free/unmetered), but still rate-limited per account.",
    ],
    errors: [
      { code: 400, description: "Invalid scan id" },
      { code: 401, description: "Unauthorized" },
      {
        code: 403,
        description:
          "AI disabled in your settings, or the API key is missing scan:write",
      },
      { code: 404, description: "Scan not found or access denied" },
      { code: 429, description: "AI summary rate limit exceeded" },
      {
        code: 502,
        description: "AI provider unavailable or returned nothing usable",
      },
    ],
  },
  {
    id: "post-scan-crawl",
    method: "POST",
    path: "/scan/crawl",
    title: "Deep Crawl Scan",
    description:
      "Crawl the target and scan each discovered page. Either provide a pre-selected URL list or let the crawler discover links. The page cap depends on your plan. Like POST /scan, this runs as a background job: the call returns immediately with a scan id, and you poll GET /scan/status/{scanId} for progress and the final aggregate result.",
    requestBody: `{
  "url": "https://example.com",
  "urls": ["https://example.com/about", "https://example.com/contact"],
  "scanners": ["headers", "ssl", "content"],
  "captureScreenshot": false,
  "portScan": false,
  "isPublic": false
}`,
    responseExample: `{
  "scanId": 12346,
  "status": "running"
}`,
    notes: [
      "Page cap per crawl is set by your plan: Free 25, Core 50, Pro 100, Elite 250 (lib/billing/crawl-page-limits.ts). A self-hosted instance with billing disabled is uncapped. Each page scanned counts as one scan against your daily limit.",
      "scanners, captureScreenshot and portScan work exactly as they do on POST /scan, including portScan's verified-domain gate. captureScreenshot and portScan apply to the main URL / main host only, not once per crawled page.",
      "isPublic behaves as on POST /scan for a logged-out crawl: omit it and the account default decides. An AUTHENTICATED crawl (one carrying an auth block) is the exception, and is private unless this request sets isPublic: true. It sees whatever a logged-in area renders, so neither the account default nor the normal is_public default is allowed to make it public.",
      "auth (object, optional) turns this into an authenticated crawl. It takes the same block, the same admin toggle, and the same limits as POST /scan/authenticated: the session is established once and threaded through every page fetch. Nothing under auth is stored or logged.",
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
  ]
}`,
    notes: [
      "Capped by the CRAWL_DISCOVER_MAX_PAGES admin setting, which ships at 500. Discovery is not plan-aware: every plan discovers up to the same number.",
      "The response body is exactly { urls }. There is no total field; read urls.length. An earlier version of this example showed one.",
      "Rate limited at the scan cap (100 requests / 60 min by default, RATE_LIMIT_SCAN_REQUESTS + RATE_LIMIT_SCAN_WINDOW_MINUTES) but keyed per USER, not per IP, and in its own bucket (crawl-discover:{userId}) separate from POST /scan's. Rotating source IPs does not reset it; discovery calls do not consume the scan endpoint's allowance either.",
      "Does NOT consume a daily scan quota unit. Discovery only reads pages, it does not scan them. This card previously claimed it counted as one.",
      "Same-origin only: sitemap URLs plus a depth-bounded link crawl, all pinned to the entry hostname, so no subdomain or cross-host URL can enter the list.",
      "Only http and https URLs are accepted here (unlike POST /scan, which takes the wider protocol set).",
    ],
    errors: [
      {
        code: 400,
        description:
          "Missing URL, URL over MAX_URL_LENGTH, unparseable URL, or a non-http(s) scheme",
      },
      { code: 401, description: "Unauthorized, or invalid/revoked API key" },
      {
        code: 403,
        description:
          "API key missing the scan:write scope, or terms acceptance pending",
      },
      { code: 429, description: "Rate limit" },
    ],
  },
  {
    id: "post-scan-discover",
    method: "POST",
    path: "/scan/discover",
    title: "Discover Subdomains",
    description:
      "Enumerate subdomains for a domain. Aggregates nine passive sources (crt.sh, HackerTarget, Subdomain.Center, RapidDNS, AlienVault OTX, Anubis, CertSpotter, urlscan.io, and the Wayback Machine) plus prefix DNS brute-force.",
    requestBody: `{
  "url": "https://example.com",
  "forceRefresh": false,
  "requestId": "a3f9c1e2-7b04-4d8a-9c31-5e6f0b2a8d47"
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
      "requestId (string, optional) is a caller-generated id for THIS request. Supply one and you can poll GET /scan/discover/progress/{requestId} while this POST is still in flight to watch which of the passive sources it is working through. Omit it and there is nothing to poll: the progress endpoint has no other way to find the run. This call still blocks until discovery finishes either way.",
    ],
    errors: [
      { code: 400, description: "Missing or invalid URL, or unparseable body" },
      { code: 401, description: "Unauthorized" },
      { code: 429, description: "Rate limit" },
    ],
  },
  {
    id: "get-scan-discover-progress",
    method: "GET",
    path: "/scan/discover/progress/{requestId}",
    title: "Discovery Progress",
    description:
      "Read-only peek at an in-flight POST /scan/discover, for the requestId that call was given. Poll it while the POST is still open to show real progress instead of a spinner. It never changes the POST's behaviour, and the POST's own response stays the source of truth for the result.",
    pathParams: [
      {
        name: "requestId",
        type: "string",
        required: true,
        description:
          "The same requestId you passed in the POST /scan/discover body",
      },
    ],
    responseExample: `{
  "stage": "dns_resolution",
  "stageIndex": 2,
  "stagesTotal": 4
}`,
    notes: [
      'stage runs querying_sources -> brute_force -> dns_resolution -> reachability, then "done". Before the run reaches this process it reads "queued".',
      'stagesTotal is 4 (DISCOVERY_STAGES in lib/scanner/discovery-progress.ts). stageIndex is that stage\'s 0-based position, and 4 once stage is "done", so stageIndex / stagesTotal is a usable progress fraction.',
      'An unknown requestId returns stage: "queued", stageIndex 0 rather than a 404, so a poll that starts before the POST registers looks the same as one with a typo in the id.',
      "Progress lives in process memory and is dropped 2 minutes after the last update. It is not shared between instances, so behind a load balancer a poll can land on a server that never saw the POST.",
      "Requires scan:read on the Bearer path (session auth also works).",
    ],
    errors: [
      { code: 401, description: "Unauthorized" },
      { code: 403, description: "API key missing the scan:read scope" },
    ],
  },
  {
    id: "get-history",
    method: "GET",
    path: "/history",
    title: "List Scan History",
    description:
      "Returns up to 100 most recent scans for the authenticated user. Retention is a per-plan admin setting and ships as unlimited on every plan, so by default nothing is aged out. GitHub repo scans are excluded from this list.",
    responseExample: `{
  "scans": [
    {
      "id": "4f3a91c07b2d4e6a8c15d0e2b7a93f68",
      "url": "https://example.com",
      "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
      "findings_count": 7,
      "duration": 1423,
      "scanned_at": "2026-03-10T15:30:00.000Z",
      "source": "api",
      "tags": ["production", "weekly-scan"]
    }
  ],
  "total": 7,
  "limit": 100,
  "truncated": false
}`,
    notes: [
      "id is an opaque, non-enumerable string. Treat it as a token, not a number: /history/{id} also accepts the legacy integer id, but this list only ever returns the opaque form.",
      "This list is your own scans only. There is no team clause on the query. For a teammate's scans use GET /api/v3/teams/member-scans?teamId=&userId=, and for a single scan a teammate owns use GET /history/{id}, which does honour team access.",
      "Use /history/{id} for full details (findings, response headers).",
    ],
    errors: [
      { code: 401, description: "Unauthorized, or invalid/revoked API key" },
      {
        code: 403,
        description:
          "API key is missing the scan:read scope, or the account has not accepted the current Terms",
      },
      { code: 429, description: "API key daily limit reached" },
    ],
  },
  {
    id: "get-history-id",
    method: "GET",
    path: "/history/{id}",
    title: "Get Scan Details",
    description:
      "Return full scan details: findings, response headers, scan metadata. Owner or same-team member can view.",
    pathParams: [
      {
        name: "id",
        type: "string",
        required: true,
        description:
          "The opaque scan id returned by GET /history. The legacy integer id is still accepted.",
      },
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
      "Permanently delete the authenticated user's scans and tags. Cannot be undone. GitHub repo scans are not touched: delete those individually.",
    responseExample: `{
  "message": "Resource deleted successfully"
}`,
    notes: [
      "The response carries no success flag and no count. A 200 is the confirmation.",
      "With a Bearer token this needs the scan:delete scope, which new keys do NOT get by default. Grant it in Profile -> Developer -> API Keys.",
    ],
    errors: [
      { code: 401, description: "Unauthorized, or invalid/revoked API key" },
      {
        code: 403,
        description:
          "API key is missing the scan:delete scope, or the account has not accepted the current Terms",
      },
      { code: 429, description: "API key daily limit reached" },
    ],
  },
  {
    id: "get-history-id-report",
    method: "GET",
    path: "/history/{id}/report?format={format}",
    title: "Export a Scan Report",
    description:
      "Generate a report over a completed scan, server-side, in the format you ask for. These are the same generators the UI runs in the browser, exposed here so CI can pull a SARIF file for GitHub code scanning, or a PDF or Markdown report, without driving a browser. See /docs/reports for what each format contains.",
    pathParams: [
      {
        name: "id",
        type: "number",
        required: true,
        description: "Scan (scan_history) id",
      },
    ],
    queryParams: [
      {
        name: "format",
        type: "string",
        description:
          "json | sarif | pdf | md (alias: markdown) | compliance. Anything else is a 400 naming the valid set.",
        default: "json",
      },
    ],
    responseExample: `# Response is the report file itself, not a JSON envelope.
# Content-Type and Content-Disposition are set per format:

format=sarif      -> application/sarif+json      vulnradar-example.com.sarif
format=md         -> text/markdown; charset=utf-8 vulnradar-example.com.md
format=compliance -> text/markdown; charset=utf-8 vulnradar-example.com-compliance.md
format=pdf        -> application/pdf             vulnradar-example.com.pdf
format=json       -> application/json            vulnradar-example.com.json`,
    notes: [
      "Same auth and access model as GET /history/{id}: a Bearer key with scan:read, or a session cookie. Owner, or a team member with read access to the scan.",
      "Every response carries Content-Disposition: attachment with a filename derived from the scanned host, so a browser or curl -O writes a sensibly named file.",
      "The owner's export has cross-rescan remediation status attached to each finding. A team-read viewer gets the stored findings as-is, because remediation state is private to the owner.",
      "compliance is the PCI DSS / SOC 2 / ISO 27001 / OWASP ASVS crosswalk, as Markdown.",
      "A scan the caller cannot read returns 404, not 403, so this endpoint cannot be used to probe which scan ids exist.",
    ],
    errors: [
      {
        code: 400,
        description: "Unsupported format (the body names the valid set)",
      },
      { code: 401, description: "Unauthorized, or invalid/revoked API key" },
      { code: 403, description: "API key is missing the scan:read scope" },
      { code: 404, description: "Scan not found, or no read access" },
    ],
  },
  {
    id: "get-scan-reputation",
    method: "GET",
    path: "/scan/reputation?host={host}",
    title: "Host Reputation Lookup",
    description:
      "Look up the cached reputation of a host from public scans, without scanning it. This is what the browser extension calls to badge the site you are on. A lightweight read, not a scan trigger.",
    queryParams: [
      {
        name: "host",
        type: "string",
        required: true,
        description: "Hostname to look up. Normalized server-side.",
      },
      {
        name: "url",
        type: "string",
        description:
          "The exact page you are asking about, when you have it. Prefers an exact-page match over the host-level fallback.",
      },
    ],
    responseExample: `{
  "known": true,
  "host": "example.com",
  "dangerScore": 5.4,
  "verdict": "caution",
  "severityCounts": { "critical": 0, "high": 1, "medium": 3, "low": 2, "info": 4 },
  "lastScannedAt": "2026-08-05T15:30:00.000Z",
  "scanId": 12345,
  "matchType": "exact",
  "scannedUrl": "https://example.com/pricing"
}`,
    notes: [
      "known: false means no public scan covers this host yet. Every other field is null in that case, including matchType.",
      'verdict is the canonical safe | caution | unsafe tier. Read it directly rather than re-deriving a tier from severityCounts: a naive "any high means unsafe" rule cannot tell an exploitable high from a hardening one like a missing HSTS header, so it flags hosts the scorer considers safe.',
      'matchType is "exact" when the result comes from a scan of the precise url you passed, and "host" when it is the host-level fallback: a scan of a DIFFERENT page on the same host. Pass url whenever you have it, because a scan of one page on a host like github.com is not the reputation of every other page on it.',
      'scannedUrl is only ever set for an "exact" match, where it just echoes back the url you supplied. It is null for a "host" match on purpose: returning someone else\'s scanned URL verbatim would leak whatever that URL contained, for instance a token in a password-reset link.',
      "Built only from PUBLIC scans. A scan created with isPublic: false never feeds this cache.",
      "Rate limited at the general API cap (100 requests / 60 min by default) keyed per user, not the heavier scan cap.",
      "Bearer callers need scan:read.",
    ],
    errors: [
      { code: 400, description: "Missing or unparseable host parameter" },
      { code: 401, description: "Unauthorized, or invalid/revoked API key" },
      {
        code: 403,
        description:
          "API key missing the scan:read scope, or terms acceptance pending",
      },
      { code: 429, description: "Rate limit" },
    ],
  },
  {
    id: "delete-history-id",
    method: "DELETE",
    path: "/history/{id}",
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
    path: "/history/{id}",
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
  "ttlSeconds": 360,
  "viewport": { "width": 1920, "height": 1080 }
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
  "expiresInSeconds": 360
}`,
    notes: [
      "ttlSeconds is clamped to Math.max(30, Math.min(requested, BROWSERBASE_MAX_TTL_SECONDS)): a 30 second floor and a ceiling that ships at 360 (6 minutes), admin-configurable. Omit it and you get BROWSERBASE_DEFAULT_TTL_SECONDS, which also ships at 360. Both were previously documented as 300, and the floor was not documented at all.",
      "ttl is accepted as a legacy alias for ttlSeconds. ttlSeconds wins if both are present.",
      "viewport ({ width, height }) sets the remote browser's resolution and defaults to 1920x1080. BrowserBase's own default is much larger, which makes everything look tiny inside the embedded viewer, so leave this alone unless you are rendering somewhere other than the popup.",
      "expiresInSeconds echoes back the clamped TTL that was actually applied, not what you asked for. Read it rather than assuming your ttlSeconds was honoured.",
      "Open the returned session.id at /browser/{id}?expiresIn={expiresInSeconds} to view in the popup. The iframe src is session.liveViewerUrl (debuggerFullscreenUrl + &navbar=false).",
      "Under the hood: we POST /v1/sessions to BrowserBase (with projectId + timeout + browserSettings, no startUrl), then open a CDP WebSocket (Node 22 built-in, to the create response's connectUrl) to send Page.navigate to the target URL, then GET /v1/sessions/{id}/debug for the iframe-embed URL. Best-effort: if CDP fails the browser stays on about:blank.",
      "BrowserBase does NOT accept a `?goto=` parameter: navigation must go through CDP. See https://docs.browserbase.com/platform/browser/observability/session-live-view for the embed pattern.",
      "Server-only: the BrowserBase API key is never sent to the client.",
      "The two 503s mean opposite things and a client must branch on the message. 'not configured' is permanent for this deployment, so retrying never helps; 'capacity is full' is transient, so retrying in a moment does. This card used to list only one 503.",
      "The 402 is the only one in the whole API. It fires when the plan's monthly BrowserBase minute allowance is spent, and no amount of retrying clears it before the next billing period.",
    ],
    errors: [
      {
        code: 400,
        description:
          "url is neither a public http(s) URL nor a public IPv4, or it failed the SSRF target check",
      },
      { code: 401, description: "Unauthorized" },
      {
        code: 402,
        description:
          "The plan's monthly BrowserBase minute quota is exhausted (permanent until the quota resets)",
      },
      {
        code: 429,
        description:
          "Per-user session-creation rate limit (20 / 60 min by default)",
      },
      {
        code: 500,
        description:
          "The session started but its ownership row could not be written, so it was torn back down",
      },
      {
        code: 502,
        description: "BrowserBase returned a session with no id",
      },
      {
        // Two distinct meanings share this status, so they share one row:
        // EndpointCard keys its error list by code and a second 503 entry
        // would collide. Branch on the message, not the status.
        code: 503,
        description:
          "Two meanings, distinguished by the message. 'BrowserBase is not configured on this server' is permanent for this deployment: do not retry. 'Live-browser capacity is full right now' is transient: retry in a moment.",
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
    notes: [
      "Ownership is enforced against the browser_sessions row: another user's session id is a 403, not a 404.",
    ],
    errors: [
      { code: 400, description: "Missing session id" },
      { code: 401, description: "Unauthorized" },
      { code: 403, description: "That session belongs to another user" },
      {
        code: 502,
        description: "BrowserBase read failed (network or upstream error)",
      },
      {
        code: 503,
        description: "BrowserBase is not configured on this server",
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
    notes: [
      "Ownership is enforced the same way as on GET: another user's session id is a 403.",
      "This call is what bills the session's metered seconds and releases its concurrency slot. A session nobody ends explicitly is reclaimed by the periodic cleanup sweep instead, so calling this promptly frees capacity for everyone on the deployment.",
    ],
    errors: [
      { code: 400, description: "Missing session id" },
      { code: 401, description: "Unauthorized" },
      { code: 403, description: "That session belongs to another user" },
      {
        code: 503,
        description: "BrowserBase is not configured on this server",
      },
    ],
  },
  {
    id: "get-version",
    method: "GET",
    path: "/api/version (not under /api/v3)",
    title: "Version Check",
    description: `Compare installed version against the latest GitHub release. Unauthenticated. Cached upstream of GitHub for 1 hour. This is the one endpoint on this page that does NOT sit under the /api/v3 base URL: it is version-independent by design, so the full path is ${APP_URL}/api/version. Composing it against the base URL the way every other card on this page works would give you ${APP_URL}/api/v3/api/version, which 404s.`,
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
      'When status is unknown, latest is always null and release_url points at the releases index rather than a specific tag. There are exactly two unknown paths (the GitHub call returned a non-2xx, or it threw/timed out) and both hardcode latest: null, so an updater must not dereference latest without checking status first. This note used to say latest "may still be populated from cache", which was never true.',
      "current is the compiled APP_VERSION and is always present, on every path. It is never cache-derived.",
      "The 1 hour cache is on the upstream GitHub fetch, not on this response. A cache hit produces a normal up-to-date/behind/ahead status, never unknown.",
      "Always 200. The failure modes are reported in the body via status: unknown, not as an HTTP error.",
    ],
    errors: [],
  },
  {
    id: "get-finding-types",
    method: "GET",
    path: "/finding-types",
    title: "Finding Types",
    description:
      "Returns the full catalogue of detection checks. Use this to display human-readable titles, categorize findings, or build SDKs that know every check ID ahead of time.",
    // The example used to show the legacy-only numbers (count 754, and the
    // six categories the page checks land in one release behind), which
    // contradicted the note below it. count is interpolated from the
    // generated constant so it cannot go stale again; the per-category map
    // has no generated equivalent, so it is the real combined
    // getCategoryCounts() output (legacy JSON + page checks).
    responseExample: `{
  "success": true,
  "count": ${EXACT_CHECK_COUNT},
  "categories": {
    "content": 155,
    "headers": 145,
    "code": 121,
    "secrets-extended": 62,
    "information-disclosure": 53,
    "vibe-code": 37,
    "cookies": 37,
    "api": 36,
    "client-side": 26,
    "configuration": 24,
    "email": 22,
    "supply-chain": 21,
    "dns": 19,
    "host-validation": 13,
    "tls": 11,
    "ssl": 7,
    "active-probes": 5,
    "reputation": 3
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
      `Backed by lib/scanner/checks-data/*.json (${EXACT_LEGACY_CHECK_COUNT} legacy checks) plus lib/scanner/checks/page-checks/ (${EXACT_PAGE_CHECK_COUNT} checks on the newer PageCheck architecture, described in Architecture): ${TOTAL_CHECKS_LABEL} entries across ${EXACT_CHECK_CATEGORY_COUNT} categories at the time of writing. Read count from the response rather than hardcoding it.`,
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
      "key_prefix": "vr_live_abc12345",
      "name": "CI",
      "daily_limit": 100,
      "created_at": "2026-03-10T15:30:00.000Z",
      "last_used_at": "2026-03-10T16:00:00.000Z",
      "revoked_at": null,
      "scopes": ["scan:write", "scan:read"],
      "usage_today": 12
    }
  ]
}`,
    notes: [
      "The prefix field is named key_prefix, not prefix.",
      "usage_today counts requests in the last 24 hours, not since midnight.",
      "scopes is null on keys created before scopes existed. A null there means the key behaves as if it had every scope.",
    ],
    errors: [{ code: 401, description: "Unauthorized (session required)" }],
  },
  {
    id: "post-keys",
    method: "POST",
    path: "/keys",
    title: "Create API Key",
    description:
      "Generate a new API key. The raw value is returned ONLY in this response, so copy and store it immediately. The number of active keys you can hold depends on your plan.",
    requestBody: `{
  "name": "CI",
  "scopes": ["scan:write", "scan:read"]
}`,
    responseExample: `{
  "key": {
    "id": 1,
    "key_prefix": "vr_live_abc12345",
    "name": "CI",
    "daily_limit": 100,
    "created_at": "2026-03-10T15:30:00.000Z",
    "scopes": ["scan:write", "scan:read"],
    "raw_key": "vr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  }
}`,
    notes: [
      "Returns HTTP 201, not 200. There is no top-level id or name: everything is under key.",
      "raw_key is shown exactly once. The server stores only the encrypted form + a SHA-256 fingerprint.",
      "daily_limit is your plan's API request allowance, not a per-key setting: 25 on Free, 100 on Core Supporter, 5,000 on Pro Supporter, effectively unlimited on Elite Supporter. It is re-read from your plan on every rotation.",
      "scopes is optional and defaults to scan:write + scan:read. scan:delete is deliberately not a default: request it explicitly if the key needs to delete history.",
    ],
    errors: [
      {
        code: 400,
        description:
          "Active-key limit for your plan reached, unknown scope requested, empty scope list, or invalid body",
      },
      { code: 401, description: "Unauthorized" },
      {
        code: 403,
        description: "API keys are disabled on this deployment",
      },
    ],
  },
  {
    id: "post-keys-rotate",
    method: "POST",
    path: "/keys/{id}/rotate",
    title: "Rotate API Key",
    description:
      "Replace the key's secret in place. The row is updated, not deleted and recreated: the id, name and scopes are preserved. Returns the new raw key once.",
    pathParams: [
      {
        name: "id",
        type: "number",
        required: true,
        description: "Key ID to rotate",
      },
    ],
    responseExample: `{
  "success": true,
  "key": {
    "id": 1,
    "key_prefix": "vr_live_def67890",
    "name": "CI",
    "daily_limit": 100,
    "created_at": "2026-03-10T15:30:00.000Z",
    "raw_key": "vr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "scopes": ["scan:write", "scan:read"]
  }
}`,
    notes: [
      "The id does not change. Anything keyed on it (audit records, per-key dashboards, allow-lists) keeps working across a rotation.",
      "Because the row survives, so does its usage history: today's consumed quota carries over to the rotated key rather than resetting.",
      "daily_limit is re-read from your current plan, so rotating a key after a plan change also updates its limit.",
      "Note the envelope differs from POST /keys: this one wraps the key in { success: true, key } and returns 200.",
    ],
    errors: [
      { code: 400, description: "Invalid key ID" },
      { code: 401, description: "Unauthorized" },
      { code: 404, description: "Key not found or already revoked" },
    ],
  },
  {
    id: "post-keys-revoke",
    method: "POST",
    path: "/keys/{id}/revoke",
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
      { code: 400, description: "Invalid key ID" },
      { code: 401, description: "Unauthorized" },
      { code: 404, description: "Key not found" },
    ],
  },
  {
    id: "get-domains",
    method: "GET",
    path: "/domains",
    title: "List Domains",
    description:
      "Your verified and pending domains, plus any assigned to a team you belong to.",
    responseExample: `{
  "domains": [
    {
      "id": 12,
      "domain": "example.com",
      "team_id": null,
      "status": "verified",
      "verification_method": "dns_txt",
      "created_at": "2026-08-01T00:00:00.000Z",
      "verified_at": "2026-08-01T00:05:00.000Z",
      "last_checked_at": "2026-08-01T00:05:00.000Z",
      "last_check_error": null,
      "verificationRecordName": "_vulnradar-verify.example.com"
    }
  ]
}`,
    errors: [{ code: 401, description: "Unauthorized" }],
  },
  {
    id: "post-domains",
    method: "POST",
    path: "/domains",
    title: "Add a Domain",
    description:
      "Add a domain (or subdomain) pending verification. Returns a fresh DNS TXT record to publish. Verifying a domain covers every subdomain under it; it does not require ownership proof up front, since publishing the returned token in DNS is exactly what proves it.",
    requestBody: `{
  "domain": "example.com"
}`,
    responseExample: `{
  "id": 12,
  "domain": "example.com",
  "status": "pending",
  "createdAt": "2026-08-01T00:00:00.000Z",
  "verificationRecordName": "_vulnradar-verify.example.com",
  "verificationRecordValue": "vulnradar-verify=<64-char token>"
}`,
    notes: [
      "domain accepts a bare domain, a www.-prefixed domain, or a full URL (only its hostname is used). It is NOT collapsed to its registrable root: adding blog.example.com verifies exactly that (and everything under it), not example.com.",
      "Publish the returned value as a TXT record at the returned name, then call POST /domains/{id}/verify.",
      "Re-adding a domain you already have a row for returns that row's existing instructions instead of creating a duplicate (status 200, alreadyExists: true).",
      "Rate-limited per account, 20 additions per hour by default. It is an admin setting, so a self-hosted instance may have raised or lowered it.",
    ],
    errors: [
      { code: 400, description: "Missing or invalid domain" },
      { code: 401, description: "Unauthorized" },
      {
        code: 403,
        description: "Domain verification is disabled on this deployment",
      },
      { code: 429, description: "Rate limit exceeded" },
    ],
  },
  {
    id: "post-domains-verify",
    method: "POST",
    path: "/domains/{id}/verify",
    title: "Verify a Domain Now",
    description:
      "Looks up the DNS TXT record right now and updates the domain's status. Safe to call repeatedly while fixing a typo'd record.",
    pathParams: [
      {
        name: "id",
        type: "number",
        required: true,
        description: "Domain ID to verify",
      },
    ],
    responseExample: `{
  "verified": true,
  "status": "verified"
}`,
    notes: [
      "DNS changes can take a few minutes to propagate -- a failed check is not final, just retry once the record has had time to spread.",
      "Rate-limited per account, 30 attempts per hour by default. It is an admin setting, so a self-hosted instance may have raised or lowered it.",
      "A verified domain is also periodically re-checked in the background (roughly every 30 days). If the TXT record no longer resolves -- the domain changed hands, DNS was repointed, or it expired -- status moves to reverify_failed and active-probes scope for it is revoked automatically until this endpoint is called again successfully.",
    ],
    errors: [
      { code: 400, description: "Invalid domain id" },
      { code: 401, description: "Unauthorized" },
      {
        code: 403,
        description:
          "Domain verification is disabled on this deployment, or you don't have write access to this domain",
      },
      { code: 404, description: "Domain not found" },
      { code: 429, description: "Rate limit exceeded" },
    ],
  },
  {
    id: "delete-domains",
    method: "DELETE",
    path: "/domains?id={id}",
    title: "Remove a Domain",
    description:
      "Removes a domain. Active Probing stops being allowed against it (and its subdomains) immediately.",
    queryParams: [
      {
        name: "id",
        type: "number",
        required: true,
        description: "Domain ID to remove",
      },
    ],
    responseExample: `{
  "success": true
}`,
    errors: [
      { code: 400, description: "Missing domain id" },
      { code: 401, description: "Unauthorized" },
      {
        code: 403,
        description: "You don't have permission to remove this domain",
      },
      { code: 404, description: "Domain not found" },
    ],
  },
];

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "authentication", label: "Authentication" },
  { id: "endpoints", label: "Endpoints" },
  ...endpoints.map((e) => ({ id: e.id, label: e.title, level: 2 })),
  { id: "code-examples", label: "Code Examples" },
  { id: "ci-cd", label: "CI/CD Gating" },
  { id: "rate-limiting", label: "Rate Limiting" },
  { id: "error-handling", label: "Error Handling" },
  { id: "best-practices", label: "Best Practices" },
];

const codeExamples: CodeExamples = {
  curl: {
    scan: `curl -X POST "${APP_URL}/api/v3/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "example.com", "portScan": true}'
# → { "scanId": 12345, "status": "running" }

# Poll until status is completed or failed
curl "${APP_URL}/api/v3/scan/status/12345" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    history: `curl -X GET "${APP_URL}/api/v3/history" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    detail: `# SCAN_ID is the opaque "id" string from GET /history
curl -X GET "${APP_URL}/api/v3/history/SCAN_ID" \\
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
    portScan: true
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
    detail: `// scanId is the opaque "id" string from GET /history, not a number
const response = await fetch(\`${APP_URL}/api/v3/history/\${scanId}\`, {
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

# The opaque "id" string from history.list(), not a number
result = client.history.get(scan_id)

print(result.url)
for finding in result.findings:
    print(finding.title, finding.severity)`,
  },
};

export default function APIDocsPage() {
  return (
    <div className="space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
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
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Prefer a machine-readable spec? The{" "}
            <Link
              href="/api/v3/openapi.json"
              className="text-primary underline-offset-2 hover:underline"
            >
              OpenAPI 3.1 description
            </Link>{" "}
            of this API lives at <InlineCode>/api/v3/openapi.json</InlineCode>.
            Import it into Postman, Insomnia, or Bruno, or try calls right in
            the browser on the{" "}
            <Link
              href="/docs/api/playground"
              className="text-primary underline-offset-2 hover:underline"
            >
              API playground
            </Link>
            .
          </p>
        </div>
      </DocsSection>

      <DocsSection id="authentication" title="Authentication">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
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
            <DocsCallout variant="warning" title="Keys leak, so rotate them">
              <p>
                Each plan caps how many active keys you can hold (one on the
                free tier, more on paid plans). Keep them out of version control
                and rotate with{" "}
                <InlineCode>POST /api/v3/keys/[id]/rotate</InlineCode>, which
                swaps the secret in place: the old secret stops working
                immediately, and the key&rsquo;s id, name, scopes and
                today&rsquo;s usage count carry over.
              </p>
            </DocsCallout>
            <DocsCallout variant="info" title="Scopes">
              <p>
                Each key carries scopes: <InlineCode>scan:write</InlineCode>{" "}
                (start scans), <InlineCode>scan:read</InlineCode> (read history
                and reports), and <InlineCode>scan:delete</InlineCode> (delete
                scans). New keys default to write and read; choose the set when
                you generate a key in Profile -&gt; Developer -&gt; API Keys. A
                route you call without the scope it needs returns 403 naming the
                missing one.
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

        <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              Try these calls in your browser
            </h3>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              The API Playground loads this same spec and sends real requests:
              pick an endpoint, paste a key, and read the live response. Your
              key stays in the browser and is never stored.
            </p>
          </div>
          <Link
            href="/docs/api/playground"
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:self-auto"
          >
            Open the API Playground
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

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

      <DocsSection id="code-examples" title="Code Examples">
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

        <CodeExampleTabs examples={codeExamples} />
      </DocsSection>

      <DocsSection id="ci-cd" title="CI/CD Gating">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Finding IDs are stable, so a scan can gate a pull request: fail the
          build when critical or high findings show up, without hand-rolling the
          poll loop yourself.
        </p>
        <CodeBlock
          code={`- uses: ${APP_REPO}/.github/actions/scan-gate@v3.7.2
  with:
    url: https://your-staging-url.com
    api-key: \${{ secrets.VULNRADAR_TOKEN }}
    # Optional, both default to 0:
    max-critical: 0
    max-high: 0`}
          language="yaml"
        />
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Store your API key as a repo secret named{" "}
          <InlineCode>VULNRADAR_TOKEN</InlineCode>, never hardcoded in the
          workflow. Self-hosting? Point <InlineCode>api-base-url</InlineCode> at
          your own deployment's <InlineCode>/api/v3</InlineCode>.
        </p>
        <DocsCallout variant="warning" title="Pin the ref, do not use @main">
          <p>
            This is a composite action: its only step is a shell block that runs
            inside your job, with your job&rsquo;s full secret set and{" "}
            <InlineCode>GITHUB_TOKEN</InlineCode> in the environment. Pinning to{" "}
            <InlineCode>@main</InlineCode> means every push to this
            repository&rsquo;s default branch executes in your pipeline
            immediately, unreviewed by you. Pin a release tag as shown, or a
            full 40-character commit SHA, which is stronger still because a tag
            can be moved:
          </p>
          <CodeBlock
            code={`- uses: ${APP_REPO}/.github/actions/scan-gate@7bdd3394793b13262f024e20a0fc081c56743616 # v3.7.2`}
            language="yaml"
          />
        </DocsCallout>

        <h3 className="pt-2 text-base font-medium text-foreground">
          GitLab CI
        </h3>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          The same gate as a GitLab CI job. Add{" "}
          <InlineCode>VULNRADAR_TOKEN</InlineCode> as a masked CI/CD variable,
          then include the template and set the URL:
        </p>
        <CodeBlock
          code={`include:
  - remote: "${APP_URL}/gitlab/vulnradar-scan.gitlab-ci.yml"

vulnradar_scan:
  variables:
    VR_URL: "https://your-staging-url.com"
    # Optional, both default to 0:
    VR_MAX_CRITICAL: "0"
    VR_MAX_HIGH: "0"`}
          language="yaml"
        />
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Prefer not to include a remote file? Copy the job straight from{" "}
          <Link
            href={`${APP_URL}/gitlab/vulnradar-scan.gitlab-ci.yml`}
            className="text-primary underline-offset-2 hover:underline"
          >
            the template
          </Link>{" "}
          into your own <InlineCode>.gitlab-ci.yml</InlineCode>. Self-hosting?
          Override <InlineCode>VR_API_BASE</InlineCode> with your deployment's{" "}
          <InlineCode>/api/v3</InlineCode>.
        </p>

        <DocsCallout variant="info" title="POST /scan does not return findings">
          The scan runs as a background job: the create call only returns a{" "}
          <InlineCode>scanId</InlineCode>, so any gate that reads{" "}
          <InlineCode>.summary</InlineCode> straight off that response is
          reading a field that doesn&apos;t exist yet. The action above polls{" "}
          <InlineCode>GET /scan/status/&#123;scanId&#125;</InlineCode> until{" "}
          <InlineCode>status</InlineCode> is <InlineCode>completed</InlineCode>{" "}
          before checking severity counts. Writing your own gate script outside
          GitHub Actions needs to do the same.
        </DocsCallout>
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <h3 className="text-base font-medium text-foreground">
              Headers on a successful response
            </h3>
            <CodeBlock
              code={`HTTP/1.1 200 OK
X-RateLimit-Limit: 150
X-RateLimit-Remaining: 147
X-RateLimit-Reset: 2026-03-12T00:00:00.000Z`}
              language="http"
            />
            <p className="text-xs text-muted-foreground">
              These three go out on a Bearer-authenticated{" "}
              <InlineCode>POST /scan</InlineCode> and{" "}
              <InlineCode>POST /scan/crawl</InlineCode>.{" "}
              <InlineCode>POST /scan/bulk</InlineCode> on the session path also
              sends <InlineCode>X-RateLimit-Used</InlineCode> and{" "}
              <InlineCode>X-RateLimit-Policy: daily</InlineCode>. Nothing else
              sends rate-limit headers on a 200: not the session path of{" "}
              <InlineCode>/scan</InlineCode>, and not any{" "}
              <InlineCode>/history</InlineCode> or{" "}
              <InlineCode>/scan/status</InlineCode> read. Every 429 from a scan
              endpoint carries the full five.
            </p>
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
            run with a Bearer key decrements that key&apos;s counter. The reset
            is midnight UTC for sessions and a rolling 24 hours for keys. Only
            the Bearer path reports its counters in headers on a successful
            scan; the session path returns the quota state in the 429 body when
            you run out.
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
                "Missing or invalid request body, an unparseable URL, or a target that fails the SSRF check by resolving to a private or link-local address. Check the field names and types.",
            },
            {
              code: "401",
              title: "Unauthorized",
              description:
                "No session cookie, no Bearer token, or the token is revoked or expired.",
            },
            {
              code: "402",
              title: "Payment Required",
              description:
                "Browserbase minute quota exhausted on POST /browser/sessions. No other endpoint uses this code.",
            },
            {
              code: "403",
              title: "Forbidden",
              description:
                "Authenticated but not authorised: another user's scan, a key missing the scope the route needs, an unaccepted Terms version, a target on the deployment's blocklist, a feature disabled on this deployment, or more crawl pages than your plan allows.",
            },
            {
              code: "404",
              title: "Not Found",
              description:
                "The resource does not exist, or it exists and is not visible to this caller.",
            },
            {
              code: "409",
              title: "Conflict",
              description:
                "The action collides with the resource's current state: cancelling a scan that already finished, an email already in use, or a backup or update already running.",
            },
            {
              code: "413",
              title: "Payload Too Large",
              description:
                "The request or the work it implies exceeds a hard cap, such as a repo too large for AI review or an oversized AI conversation.",
            },
            {
              code: "422",
              title: "Unprocessable Entity",
              description:
                "Login could not be confirmed on POST /scan/authenticated or an authenticated crawl (see authReport.reason), or the target could not be reached on the demo and port-scan endpoints. Not used for SSRF or private-IP rejections, which are 400.",
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
            {
              code: "502",
              title: "Bad Gateway",
              description:
                "An upstream this endpoint depends on failed or returned nothing: the AI endpoint, the browser service, or the target after a successful login.",
            },
            {
              code: "503",
              title: "Service Unavailable",
              description:
                "A dependency is not configured or not migrated on this deployment, such as Stripe on a billing route. Retrying will not help until the operator fixes it.",
            },
          ]}
        />
      </DocsSection>

      <DocsSection id="best-practices" title="Before You Ship This">
        <dl className="max-w-[80ch] divide-y divide-border/50 border-y border-border/50">
          {[
            {
              title: "Keep the key out of the repo",
              description:
                "Environment variable or secrets vault, never a literal. Rotate with POST /keys/[id]/rotate, which invalidates the old secret in the same call while keeping the key's id and scopes.",
            },
            {
              title: "Read X-RateLimit-Remaining, not the 429",
              description:
                "Slowing down at 20 remaining costs nothing. Discovering the limit by hitting it costs you the request and a Retry-After wait. The header is on Bearer scan responses; if you are calling with a session cookie there is nothing to read, so track your own count.",
            },
            {
              title: "Validate the target before you send it",
              description:
                "The server rejects localhost and private ranges with a 400, but a client-side check turns that round trip into a local error.",
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
