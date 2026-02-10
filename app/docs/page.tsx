"use client"

import React from "react"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import {
  Copy,
  Check,
  BookOpen,
  Zap,
  Shield,
  Clock,
  Key,
  AlertTriangle,
  FileJson,
  Code2,
  Terminal,
  ChevronRight,
  ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"

const BASE_URL = "https://vulnradar.dev"

// ─── Code Block ────────────────────────────────────────────────
function CodeBlock({
  code,
  language,
  filename,
}: {
  code: string
  language: string
  filename?: string
}) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-xl overflow-hidden border border-border bg-card">
      <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/50 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" />
            <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" />
            <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" />
          </div>
          <span className="text-xs font-mono text-muted-foreground ml-2">
            {filename || language}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5"
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-green-500" />
              <span className="text-green-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </Button>
      </div>
      <pre className="p-4 overflow-x-auto">
        <code className="text-[13px] font-mono text-foreground leading-relaxed whitespace-pre">
          {code}
        </code>
      </pre>
    </div>
  )
}

// ─── Section wrapper ───────────────────────────────────────────
function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string
  title: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
          <Icon className="h-4.5 w-4.5 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground tracking-tight">
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

// ─── Inline Code ───────────────────────────────────────────────
function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded-md bg-secondary font-mono text-xs text-foreground">
      {children}
    </code>
  )
}

// ─── Table ─────────────────────────────────────────────────────
function DocTable({
  headers,
  rows,
}: {
  headers: string[]
  rows: (string | React.ReactNode)[][]
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/40">
              {headers.map((h) => (
                <th
                  key={h}
                  className="text-left py-3 px-4 text-foreground font-semibold text-xs uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border">
                {row.map((cell, j) => (
                  <td key={j} className="py-3 px-4 text-muted-foreground">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Sidebar navigation items ──────────────────────────────────
const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: BookOpen },
  { id: "authentication", label: "Authentication", icon: Key },
  { id: "rate-limits", label: "Rate Limits", icon: Clock },
  { id: "endpoint", label: "Endpoint", icon: Zap },
  { id: "response", label: "Response Format", icon: FileJson },
  { id: "history", label: "Scan History", icon: Clock },
  { id: "errors", label: "Error Codes", icon: AlertTriangle },
  { id: "examples", label: "Code Examples", icon: Code2 },
]

const LANG_TABS = [
  { id: "curl", label: "cURL", icon: Terminal },
  { id: "python", label: "Python", icon: Code2 },
  { id: "javascript", label: "JavaScript", icon: Code2 },
  { id: "go", label: "Go", icon: Code2 },
  { id: "ruby", label: "Ruby", icon: Code2 },
  { id: "php", label: "PHP", icon: Code2 },
]

// ─── Main page ─────────────────────────────────────────────────
export default function DocsPage() {
  const router = useRouter()
  const [activeSection, setActiveSection] = useState("overview")
  const [activeLang, setActiveLang] = useState("curl")
  const observerRef = useRef<IntersectionObserver | null>(null)

  // Intersection observer for active section tracking
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 },
    )

    const sections = document.querySelectorAll("section[id]")
    for (const section of sections) {
      observerRef.current.observe(section)
    }

    return () => observerRef.current?.disconnect()
  }, [])

  function scrollTo(id: string) {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <div className="flex-1 flex max-w-6xl mx-auto w-full">
        {/* Sidebar - hidden on mobile */}
        <aside className="hidden lg:flex flex-col w-56 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] border-r border-border py-6 px-4 overflow-y-auto">
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                  activeSection === item.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </button>
            ))}
          </nav>

        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-8 flex flex-col gap-14">
          {/* ── Overview ────────────────────────────────────── */}
          <Section id="overview" title="Overview" icon={BookOpen}>
            <p className="text-muted-foreground leading-relaxed">
              The VulnRadar API lets you programmatically scan any public website
              for security vulnerabilities. It runs{" "}
              <strong className="text-foreground">65+ different vulnerability checks</strong>{" "}
              across HTTP headers, SSL configuration, cookies, content analysis,
              and server configuration, returning a structured JSON report with
              severity ratings and actionable fix guidance.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  icon: Zap,
                  title: "Single Endpoint",
                  desc: "POST /api/scan",
                },
                {
                  icon: Shield,
                  title: "Bearer Auth",
                  desc: "API key in header",
                },
                {
                  icon: Clock,
                  title: "Rate Limited",
                  desc: "50 requests / 24h / key",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0">
                    <item.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <CodeBlock
              language="bash"
              filename="Quick Start"
              code={`curl -X POST ${BASE_URL}/api/scan \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"url": "https://example.com"}'`}
            />
          </Section>

          {/* ── Authentication ──────────────────────────────── */}
          <Section id="authentication" title="Authentication" icon={Key}>
            <p className="text-muted-foreground leading-relaxed">
              Every API request requires a valid API key passed in the{" "}
              <InlineCode>Authorization</InlineCode> header as a Bearer token.
              Generate keys from your{" "}
              <button
                onClick={() => router.push("/profile")}
                className="text-primary hover:underline font-medium"
              >
                profile page
              </button>
              .
            </p>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">
                  Key Format
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                API keys start with{" "}
                <InlineCode>vr_live_</InlineCode> followed by 48
                hex characters. You can have up to{" "}
                <strong className="text-foreground">3 active keys</strong> at a
                time, each with its own independent rate limit.
              </p>
            </div>
            <CodeBlock
              language="http"
              filename="Authorization Header"
              code={`POST /api/scan HTTP/1.1
Host: vulnradar.dev
Content-Type: application/json
Authorization: Bearer vr_live_a1b2c3d4e5f6...`}
            />
          </Section>

          {/* ── Rate Limits ─────────────────────────────────── */}
          <Section id="rate-limits" title="Rate Limits" icon={Clock}>
            <p className="text-muted-foreground leading-relaxed">
              Each API key has a{" "}
              <strong className="text-foreground">
                50-request rolling 24-hour window
              </strong>
              . With 3 keys, that gives you up to 150 requests per day.
              Rate limit status is returned in response headers on every
              request.
            </p>
            <DocTable
              headers={["Header", "Description", "Example"]}
              rows={[
                [
                  <InlineCode key="h1">X-RateLimit-Limit</InlineCode>,
                  "Max requests per 24h window",
                  <span key="e1" className="font-mono text-xs text-foreground">50</span>,
                ],
                [
                  <InlineCode key="h2">X-RateLimit-Remaining</InlineCode>,
                  "Requests left in current window",
                  <span key="e2" className="font-mono text-xs text-foreground">47</span>,
                ],
                [
                  <InlineCode key="h3">X-RateLimit-Reset</InlineCode>,
                  "ISO 8601 window reset timestamp",
                  <span key="e3" className="font-mono text-xs text-foreground">2026-02-09T...</span>,
                ],
                [
                  <InlineCode key="h4">Retry-After</InlineCode>,
                  "Seconds to wait (429 only)",
                  <span key="e4" className="font-mono text-xs text-foreground">3600</span>,
                ],
              ]}
            />
            <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-[hsl(var(--severity-medium))] mt-0.5 shrink-0" />
              <p className="text-sm text-muted-foreground leading-relaxed">
                When rate limited, you will receive a{" "}
                <InlineCode>429 Too Many Requests</InlineCode> response. The{" "}
                <InlineCode>Retry-After</InlineCode> header tells you how many
                seconds to wait before retrying.
              </p>
            </div>
          </Section>

          {/* ── Endpoint ────────────────────────────────────── */}
          <Section id="endpoint" title="Endpoint" icon={Zap}>
            <div className="flex items-center gap-3">
              <Badge className="bg-primary text-primary-foreground text-xs font-semibold px-2.5 py-1">
                POST
              </Badge>
              <code className="text-sm font-mono text-foreground font-semibold">
                {BASE_URL}/api/scan
              </code>
            </div>

            <h3 className="text-sm font-semibold text-foreground mt-2">
              Request Body
            </h3>
            <DocTable
              headers={["Field", "Type", "Required", "Description"]}
              rows={[
                [
                  <InlineCode key="f">url</InlineCode>,
                  "string",
                  <Badge key="r" variant="outline" className="text-xs text-primary border-primary/30">Required</Badge>,
                  "Full URL with protocol (https://example.com)",
                ],
              ]}
            />
            <CodeBlock
              language="json"
              filename="request.json"
              code={`{
  "url": "https://example.com"
}`}
            />
          </Section>

          {/* ── Response ────────────────────────────────────── */}
          <Section id="response" title="Response Format" icon={FileJson}>
            <p className="text-muted-foreground leading-relaxed">
              A successful scan returns a JSON object with metadata, a summary
              of findings by severity, and a detailed list of vulnerabilities
              sorted from most to least critical.
            </p>

            <h3 className="text-sm font-semibold text-foreground">
              Top-Level Fields
            </h3>
            <DocTable
              headers={["Field", "Type", "Description"]}
              rows={[
                [<InlineCode key="f1">url</InlineCode>, "string", "The scanned URL"],
                [<InlineCode key="f2">scannedAt</InlineCode>, "string", "ISO 8601 scan timestamp"],
                [<InlineCode key="f3">duration</InlineCode>, "number", "Scan duration in milliseconds"],
                [<InlineCode key="f4">summary</InlineCode>, "object", "Issue counts by severity (critical, high, medium, low, info, total)"],
                [<InlineCode key="f5">findings</InlineCode>, "array", "Detailed vulnerability objects"],
              ]}
            />

            <h3 className="text-sm font-semibold text-foreground mt-4">
              Finding Object
            </h3>
            <DocTable
              headers={["Field", "Type", "Description"]}
              rows={[
                [<InlineCode key="v1">id</InlineCode>, "string", "Unique finding identifier"],
                [<InlineCode key="v2">title</InlineCode>, "string", "Human-readable vulnerability title"],
                [<InlineCode key="v3">severity</InlineCode>, "string", "critical | high | medium | low | info"],
                [<InlineCode key="v4">category</InlineCode>, "string", "headers | ssl | cookies | content | configuration | information-disclosure"],
                [<InlineCode key="v5">description</InlineCode>, "string", "What was found"],
                [<InlineCode key="v6">evidence</InlineCode>, "string", "Specific evidence from the scan"],
                [<InlineCode key="v7">riskImpact</InlineCode>, "string", "What could go wrong if not fixed"],
                [<InlineCode key="v8">explanation</InlineCode>, "string", "Technical explanation for developers"],
                [<InlineCode key="v9">fixSteps</InlineCode>, "string[]", "Ordered remediation steps"],
                [<InlineCode key="v10">codeExamples</InlineCode>, "array", "Code snippets showing how to fix (label, language, code)"],
              ]}
            />

            <CodeBlock
              language="json"
              filename="response-200.json"
              code={`{
  "url": "https://example.com",
  "scannedAt": "2026-02-08T12:00:00.000Z",
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
      "id": "a1b2c3d4",
      "title": "Missing Content-Security-Policy",
      "severity": "high",
      "category": "headers",
      "description": "No Content-Security-Policy header detected.",
      "evidence": "Header 'Content-Security-Policy' not present.",
      "riskImpact": "Without CSP, the site is more vulnerable to XSS...",
      "explanation": "CSP is a security header that restricts...",
      "fixSteps": [
        "Add a Content-Security-Policy header",
        "Start with a restrictive policy"
      ],
      "codeExamples": [
        {
          "label": "Next.js",
          "language": "javascript",
          "code": "// next.config.mjs..."
        }
      ]
    }
  ]
}`}
            />
          </Section>

          {/* ── Scan History ──────────────────────────────── */}
          <Section id="history" title="Scan History" icon={Clock}>
            <p className="text-muted-foreground leading-relaxed">
              Every scan you run, whether via the web UI or the API, is
              automatically saved to your scan history. History is retained for{" "}
              <strong className="text-foreground">90 days</strong> and can be
              viewed from the{" "}
              <button
                onClick={() => router.push("/history")}
                className="text-primary hover:underline font-medium"
              >
                History page
              </button>
              .
            </p>

            <h3 className="text-sm font-semibold text-foreground mt-2">
              What Gets Stored
            </h3>
            <DocTable
              headers={["Field", "Description"]}
              rows={[
                ["URL", "The scanned target URL"],
                ["Summary", "Issue counts by severity (critical, high, medium, low, info)"],
                ["Full Findings", "Complete vulnerability details including evidence, fix steps, and code examples"],
                ["Duration", "How long the scan took in milliseconds"],
                ["Timestamp", "When the scan was performed"],
              ]}
            />

            <h3 className="text-sm font-semibold text-foreground mt-4">
              Features
            </h3>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground leading-relaxed">
              <li className="flex gap-2">
                <ChevronRight className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">Click any scan</strong> to
                  view the full results: the same severity summary, filterable
                  findings list, and detailed issue view with code examples you
                  see on a live scan.
                </span>
              </li>
              <li className="flex gap-2">
                <ChevronRight className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">Export any past scan</strong>{" "}
                  as a JSON report directly from the history detail view.
                </span>
              </li>
              <li className="flex gap-2">
                <ChevronRight className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">Search and filter</strong>{" "}
                  your history by URL to quickly find past scans.
                </span>
              </li>
              <li className="flex gap-2">
                <ChevronRight className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">Clear all history</strong>{" "}
                  at any time from the history page.
                </span>
              </li>
            </ul>

            <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-[hsl(var(--severity-medium))] mt-0.5 shrink-0" />
              <p className="text-sm text-muted-foreground leading-relaxed">
                History data is automatically cleaned up after 90 days. If
                you need to keep scan results permanently, export them as JSON
                using the export button on the scan detail view or via the
                data export feature on your profile page.
              </p>
            </div>
          </Section>

          {/* ── Errors ──────────────────────────────────────── */}
          <Section id="errors" title="Error Codes" icon={AlertTriangle}>
            <p className="text-muted-foreground leading-relaxed">
              All errors return a JSON body with an{" "}
              <InlineCode>error</InlineCode> field describing the issue.
            </p>
            <DocTable
              headers={["Status", "Meaning", "When It Happens"]}
              rows={[
                [
                  <Badge key="s1" variant="outline" className="font-mono text-xs">400</Badge>,
                  "Bad Request",
                  "Missing or invalid URL in request body",
                ],
                [
                  <Badge key="s2" variant="outline" className="font-mono text-xs">401</Badge>,
                  "Unauthorized",
                  "Missing, invalid, or revoked API key",
                ],
                [
                  <Badge key="s3" variant="outline" className="font-mono text-xs">422</Badge>,
                  "Unprocessable",
                  "Target URL is unreachable or timed out",
                ],
                [
                  <Badge key="s4" variant="outline" className="font-mono text-xs border-[hsl(var(--severity-medium))]/30 text-[hsl(var(--severity-medium))]">429</Badge>,
                  "Rate Limited",
                  "Exceeded 50 requests in 24h window",
                ],
                [
                  <Badge key="s5" variant="outline" className="font-mono text-xs border-destructive/30 text-destructive">500</Badge>,
                  "Server Error",
                  "Unexpected internal error",
                ],
              ]}
            />
            <CodeBlock
              language="json"
              filename="error-429.json"
              code={`{
  "error": "Rate limit exceeded. 50 requests per 24 hours.",
  "limit": 50,
  "used": 50,
  "remaining": 0,
  "resets_at": "2026-02-09T12:00:00.000Z"
}`}
            />
          </Section>

          {/* ── Code Examples ───────────────────────────────── */}
          <Section id="examples" title="Code Examples" icon={Code2}>
            <p className="text-muted-foreground leading-relaxed">
              Complete, copy-paste-ready examples in popular languages. Each
              example includes rate limit handling and error checking.
            </p>

            {/* Language tabs */}
            <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-secondary/50 border border-border">
              {LANG_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveLang(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    activeLang === tab.id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* cURL */}
            {activeLang === "curl" && (
              <CodeBlock
                language="bash"
                filename="scan.sh"
                code={`#!/bin/bash
API_KEY="vr_live_your_api_key_here"
TARGET_URL="https://example.com"

response=$(curl -s -w "\\n%{http_code}" -X POST ${BASE_URL}/api/scan \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $API_KEY" \\
  -d "{\\\"url\\\": \\\"$TARGET_URL\\\"}")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
  echo "$body" | python3 -m json.tool
  echo ""
  echo "Total issues: $(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['total'])")"
elif [ "$http_code" -eq 429 ]; then
  echo "Rate limited. Try again later."
else
  echo "Error ($http_code): $body"
fi`}
              />
            )}

            {/* Python */}
            {activeLang === "python" && (
              <CodeBlock
                language="python"
                filename="vulnradar_scan.py"
                code={`"""VulnRadar API - Python Example"""
import requests
import json
import sys

API_KEY = "vr_live_your_api_key_here"
BASE_URL = "${BASE_URL}"


def scan_url(target_url: str) -> dict | None:
    """Scan a URL for security vulnerabilities.
    
    Args:
        target_url: Full URL to scan (e.g. https://example.com)
    
    Returns:
        Scan results dict, or None if rate limited / error.
    """
    response = requests.post(
        f"{BASE_URL}/api/scan",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        json={"url": target_url},
        timeout=30,
    )

    # Print rate limit info
    remaining = response.headers.get("X-RateLimit-Remaining")
    limit = response.headers.get("X-RateLimit-Limit")
    if remaining and limit:
        print(f"Rate limit: {remaining}/{limit} requests remaining")

    # Handle rate limiting
    if response.status_code == 429:
        retry = response.headers.get("Retry-After", "unknown")
        print(f"Rate limited! Retry after {retry} seconds.")
        return None

    # Handle other errors
    if not response.ok:
        error = response.json().get("error", "Unknown error")
        print(f"Error ({response.status_code}): {error}")
        return None

    return response.json()


def print_report(result: dict) -> None:
    """Pretty-print a scan report."""
    summary = result["summary"]
    print(f"\\nScan: {result['url']}")
    print(f"Time: {result['scannedAt']}")
    print(f"Duration: {result['duration']}ms")
    print(f"\\nFindings: {summary['total']} total")
    print(f"  Critical: {summary['critical']}")
    print(f"  High:     {summary['high']}")
    print(f"  Medium:   {summary['medium']}")
    print(f"  Low:      {summary['low']}")
    print(f"  Info:     {summary['info']}")
    print(f"\\n{'─' * 50}")

    for finding in result["findings"]:
        sev = finding["severity"].upper().ljust(8)
        print(f"  [{sev}] {finding['title']}")
        print(f"             {finding['description'][:80]}...")
    print()


# ── Usage ───────────────────────────────────────────
if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"
    result = scan_url(url)
    if result:
        print_report(result)

        # Save JSON report
        with open("report.json", "w") as f:
            json.dump(result, f, indent=2)
        print("Report saved to report.json")`}
              />
            )}

            {/* JavaScript */}
            {activeLang === "javascript" && (
              <CodeBlock
                language="javascript"
                filename="vulnradar_scan.mjs"
                code={`/**
 * VulnRadar API - JavaScript / Node.js Example
 * Usage: node vulnradar_scan.mjs https://example.com
 */

const API_KEY = "vr_live_your_api_key_here";
const BASE_URL = "${BASE_URL}";

async function scanUrl(targetUrl) {
  const response = await fetch(\`\${BASE_URL}/api/scan\`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: \`Bearer \${API_KEY}\`,
    },
    body: JSON.stringify({ url: targetUrl }),
  });

  // Log rate limit info
  const remaining = response.headers.get("X-RateLimit-Remaining");
  const limit = response.headers.get("X-RateLimit-Limit");
  if (remaining && limit) {
    console.log(\`Rate limit: \${remaining}/\${limit} remaining\`);
  }

  // Handle rate limiting
  if (response.status === 429) {
    const retry = response.headers.get("Retry-After");
    console.error(\`Rate limited! Retry after \${retry}s\`);
    return null;
  }

  // Handle errors
  if (!response.ok) {
    const { error } = await response.json();
    throw new Error(\`\${response.status}: \${error}\`);
  }

  return response.json();
}

// ── Usage ────────────────────────────────────────
const url = process.argv[2] || "https://example.com";

try {
  const result = await scanUrl(url);
  if (!result) process.exit(1);

  const { summary, findings } = result;
  console.log(\`\\nScanned: \${result.url}\`);
  console.log(\`Found \${summary.total} issues (\${result.duration}ms)\`);
  console.log(\`  Critical: \${summary.critical} | High: \${summary.high} | Medium: \${summary.medium} | Low: \${summary.low}\\n\`);

  for (const f of findings) {
    console.log(\`  [\${f.severity.toUpperCase().padEnd(8)}] \${f.title}\`);
  }

  // Save report
  const fs = await import("node:fs");
  fs.writeFileSync("report.json", JSON.stringify(result, null, 2));
  console.log("\\nReport saved to report.json");
} catch (err) {
  console.error("Scan failed:", err.message);
  process.exit(1);
}`}
              />
            )}

            {/* Go */}
            {activeLang === "go" && (
              <CodeBlock
                language="go"
                filename="main.go"
                code={`package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
)

const (
	apiKey  = "vr_live_your_api_key_here"
	baseURL = "${BASE_URL}"
)

type ScanRequest struct {
	URL string \`json:"url"\`
}

type Finding struct {
	ID          string \`json:"id"\`
	Title       string \`json:"title"\`
	Severity    string \`json:"severity"\`
	Category    string \`json:"category"\`
	Description string \`json:"description"\`
}

type Summary struct {
	Critical int \`json:"critical"\`
	High     int \`json:"high"\`
	Medium   int \`json:"medium"\`
	Low      int \`json:"low"\`
	Info     int \`json:"info"\`
	Total    int \`json:"total"\`
}

type ScanResult struct {
	URL       string    \`json:"url"\`
	ScannedAt string    \`json:"scannedAt"\`
	Duration  int       \`json:"duration"\`
	Summary   Summary   \`json:"summary"\`
	Findings  []Finding \`json:"findings"\`
}

func scanURL(targetURL string) (*ScanResult, error) {
	body, _ := json.Marshal(ScanRequest{URL: targetURL})

	req, _ := http.NewRequest("POST", baseURL+"/api/scan", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// Print rate limit
	remaining := resp.Header.Get("X-RateLimit-Remaining")
	limit := resp.Header.Get("X-RateLimit-Limit")
	if remaining != "" {
		fmt.Printf("Rate limit: %s/%s remaining\\n", remaining, limit)
	}

	if resp.StatusCode == 429 {
		return nil, fmt.Errorf("rate limited, retry after %ss", resp.Header.Get("Retry-After"))
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("error: %d", resp.StatusCode)
	}

	var result ScanResult
	json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func main() {
	target := "https://example.com"
	if len(os.Args) > 1 {
		target = os.Args[1]
	}

	result, err := scanURL(target)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Scan failed: %v\\n", err)
		os.Exit(1)
	}

	fmt.Printf("\\nScanned: %s (%dms)\\n", result.URL, result.Duration)
	fmt.Printf("Found %d issues\\n\\n", result.Summary.Total)

	for _, f := range result.Findings {
		fmt.Printf("  [%-8s] %s\\n", strings.ToUpper(f.Severity), f.Title)
	}
}`}
              />
            )}

            {/* Ruby */}
            {activeLang === "ruby" && (
              <CodeBlock
                language="ruby"
                filename="vulnradar_scan.rb"
                code={`# VulnRadar API - Ruby Example
require "net/http"
require "json"
require "uri"

API_KEY  = "vr_live_your_api_key_here"
BASE_URL = "${BASE_URL}"

def scan_url(target_url)
  uri  = URI("#{BASE_URL}/api/scan")
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = uri.scheme == "https"

  request = Net::HTTP::Post.new(uri)
  request["Content-Type"]  = "application/json"
  request["Authorization"] = "Bearer #{API_KEY}"
  request.body = { url: target_url }.to_json

  response = http.request(request)

  # Rate limit info
  remaining = response["X-RateLimit-Remaining"]
  limit     = response["X-RateLimit-Limit"]
  puts "Rate limit: #{remaining}/#{limit} remaining" if remaining

  case response.code.to_i
  when 200
    JSON.parse(response.body)
  when 429
    retry_after = response["Retry-After"]
    abort "Rate limited! Retry after #{retry_after}s"
  else
    error = JSON.parse(response.body)["error"] rescue response.body
    abort "Error (#{response.code}): #{error}"
  end
end

# ── Usage ────────────────────────────────────────
target = ARGV[0] || "https://example.com"
result = scan_url(target)

summary = result["summary"]
puts "\\nScanned: #{result['url']} (#{result['duration']}ms)"
puts "Found #{summary['total']} issues"
puts "  Critical: #{summary['critical']} | High: #{summary['high']} | Medium: #{summary['medium']} | Low: #{summary['low']}"
puts ""

result["findings"].each do |f|
  puts "  [%-8s] %s" % [f["severity"].upcase, f["title"]]
end

# Save report
File.write("report.json", JSON.pretty_generate(result))
puts "\\nReport saved to report.json"`}
              />
            )}

            {/* PHP */}
            {activeLang === "php" && (
              <CodeBlock
                language="php"
                filename="vulnradar_scan.php"
                code={`<?php
/**
 * VulnRadar API - PHP Example
 * Usage: php vulnradar_scan.php https://example.com
 */

$apiKey  = "vr_live_your_api_key_here";
$baseUrl = "${BASE_URL}";

function scanUrl(string $targetUrl): ?array {
    global $apiKey, $baseUrl;

    $ch = curl_init("$baseUrl/api/scan");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            "Content-Type: application/json",
            "Authorization: Bearer $apiKey",
        ],
        CURLOPT_POSTFIELDS => json_encode(["url" => $targetUrl]),
        CURLOPT_TIMEOUT    => 30,
        CURLOPT_HEADERFUNCTION => function ($ch, $header) {
            if (stripos($header, "X-RateLimit-Remaining:") === 0) {
                echo "Rate limit remaining: " . trim(explode(":", $header, 2)[1]) . "\\n";
            }
            return strlen($header);
        },
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 429) {
        echo "Rate limited! Try again later.\\n";
        return null;
    }

    if ($httpCode !== 200) {
        $error = json_decode($response, true)["error"] ?? "Unknown error";
        echo "Error ($httpCode): $error\\n";
        return null;
    }

    return json_decode($response, true);
}

// ── Usage ────────────────────────────────────────
$target = $argv[1] ?? "https://example.com";
$result = scanUrl($target);

if ($result) {
    $s = $result["summary"];
    printf("\\nScanned: %s (%dms)\\n", $result["url"], $result["duration"]);
    printf("Found %d issues\\n", $s["total"]);
    printf("  Critical: %d | High: %d | Medium: %d | Low: %d\\n\\n",
        $s["critical"], $s["high"], $s["medium"], $s["low"]);

    foreach ($result["findings"] as $f) {
        printf("  [%-8s] %s\\n", strtoupper($f["severity"]), $f["title"]);
    }

    // Save report
    file_put_contents("report.json", json_encode($result, JSON_PRETTY_PRINT));
    echo "\\nReport saved to report.json\\n";
}
?>`}
              />
            )}
          </Section>

          {/* ── Bottom CTA ──────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center gap-4 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10">
              <Image
                src="/favicon.svg"
                alt="VulnRadar logo"
                width={24}
                height={24}
                className="h-6 w-6"
              />
            </div>
            <h3 className="text-lg font-bold text-foreground">
              Ready to start scanning?
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Generate an API key from your profile page and start integrating
              VulnRadar into your workflow.
            </p>
            <div className="flex gap-3">
              <Button onClick={() => router.push("/profile")}>
                <Key className="mr-2 h-4 w-4" />
                Get API Key
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push("/")}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Try the Scanner
              </Button>
            </div>
          </div>
        </main>
      </div>

      <Footer />
    </div>
  )
}
