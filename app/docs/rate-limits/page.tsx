"use client";

import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";

import { Gauge, Clock, Zap, ShieldCheck } from "lucide-react";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "../layout";
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  CodeBlock,
  DocsTable,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "limits-by-plan", label: "Limits by Plan" },
  { id: "ip-rate-limits", label: "Per-IP Limits" },
  { id: "headers", label: "Rate Limit Headers" },
  { id: "handling", label: "Handling 429s" },
  { id: "best-practices", label: "Best Practices" },
];

const dailyQuotas = [
  {
    plan: "Free",
    scans: "25",
    api: "25",
    color: "text-muted-foreground",
  },
  {
    plan: "Core",
    scans: "100",
    api: "100",
    color: "text-blue-500",
  },
  {
    plan: "Pro",
    scans: "150",
    api: "5,000",
    color: "text-amber-500",
  },
  {
    plan: "Elite",
    scans: "500",
    api: "Unlimited",
    color: "text-primary",
    highlight: true,
  },
];

export default function RateLimitsPage() {
  const { setActiveSection, setTocItems } = useDocsContext();
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
        badge="API Limits"
        title="Rate Limits"
        description={`${APP_NAME} applies rate limits at two levels: per-IP limits on auth endpoints and per-user/per-key daily quotas on scan endpoints.`}
        stats={[
          { value: "Per Key", label: "Daily Quota" },
          { value: "Per IP", label: "Burst Limit" },
          { value: "Headers", label: "On Every Response" },
        ]}
      />

      <DocsSection id="overview" title="Overview">
        <p>
          Two separate limit systems protect the platform. They are enforced in
          different places and behave differently on overflow.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong>Per-IP rate limits</strong> —{" "}
            <code>lib/rate-limiting/rate-limit.ts</code>. Sliding window in the{" "}
            <code>rate_limits</code> table. Used by auth endpoints (signup,
            login, forgot-password), the API as a whole, and the scan routes.
          </li>
          <li>
            <strong>Per-plan daily quotas</strong> —{" "}
            <code>lib/rate-limiting/daily-limits.ts</code>. Tracks usage per
            user (session auth) or per API key (Bearer auth) for a 24-hour
            window. Limits come from <code>lib/billing/catalog.ts</code>.
          </li>
        </ul>
      </DocsSection>

      <DocsSection
        id="limits-by-plan"
        title="Daily Quotas by Plan"
        icon={Gauge}
      >
        <p className="text-muted-foreground">
          Two separate counters: <strong>scans/day</strong> enforced for
          session-authenticated users, and <strong>API requests/day</strong>{" "}
          enforced for Bearer-authenticated API keys.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {dailyQuotas.map((plan) => (
            <Card
              key={plan.plan}
              className={`p-4 border-border/50 bg-card/50 text-center ${plan.highlight ? "border-primary/30 bg-primary/5" : ""}`}
            >
              <div className={`text-xl font-bold mb-1 ${plan.color}`}>
                {plan.scans} / day
              </div>
              <div className="text-xs font-medium text-foreground">
                {plan.plan}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                scans via session
              </div>
            </Card>
          ))}
        </div>

        <DocsTable
          columns={[
            { key: "plan", header: "Plan" },
            { key: "scans", header: "Scans / day (session auth)" },
            { key: "api", header: "API requests / day (Bearer)" },
          ]}
          data={dailyQuotas}
        />

        <DocsCallout variant="info" title="Where the numbers come from">
          <p>
            Daily quotas are defined in <code>lib/billing/catalog.ts</code> (one
            entry per plan: <code>dailyScans</code> and{" "}
            <code>apiRequestsPerDay</code>). New API keys default to{" "}
            <code>CONFIG_DEFAULT_API_KEY_DAILY_LIMIT = 50</code> (
            <code>lib/config/config-values.ts</code>).
          </p>
        </DocsCallout>

        <DocsCallout variant="info" title="Staff accounts have no limit">
          <p>
            Users with role <code>admin</code>, <code>moderator</code>, or{" "}
            <code>support</code> are exempt from daily quotas (
            <code>daily-limits.ts</code> returns <code>Infinity</code>).
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="ip-rate-limits" title="Per-IP Limits">
        <p className="text-muted-foreground">
          IP-based rate limits are configured in{" "}
          <code>lib/config/config-values.ts</code> as{" "}
          <code>CONFIG_RATE_LIMIT_*_ATTEMPTS</code> +{" "}
          <code>_WINDOW_MINUTES</code> pairs. The window is converted to seconds
          at boot.
        </p>

        <DocsTable
          columns={[
            { key: "endpoint", header: "Endpoint" },
            { key: "attempts", header: "Max attempts" },
            { key: "window", header: "Window (min)" },
          ]}
          data={[
            {
              endpoint: "POST /api/v2/auth/login",
              attempts: "5",
              window: "15",
            },
            {
              endpoint: "POST /api/v2/auth/signup",
              attempts: "3",
              window: "60",
            },
            {
              endpoint: "POST /api/v2/auth/forgot-password",
              attempts: "3",
              window: "10",
            },
            {
              endpoint: "POST /api/v2/auth/2fa/verify",
              attempts: "5",
              window: "5",
            },
            {
              endpoint: "POST /api/v2/auth/2fa/email-send",
              attempts: "1",
              window: "1",
            },
            {
              endpoint: "API requests per IP (any /api/v2/*)",
              attempts: "100",
              window: "60",
            },
            {
              endpoint: "POST /api/v2/scan (and friends)",
              attempts: "100",
              window: "60",
            },
            {
              endpoint: "POST /api/v2/scan/bulk",
              attempts: "10",
              window: "60",
            },
          ]}
        />

        <DocsCallout variant="success" title="Crawl count semantics">
          <p>
            For Bearer-authenticated deep crawls (
            <code>/api/v2/scan/crawl</code>
            ), the call itself counts as <strong>1</strong> daily quota unit.
            For session-authenticated crawls, each scanned page counts as 1 unit
            (10 pages = 10 quota units). Discovery (
            <code>/api/v2/scan/crawl/discover</code>) counts as 1 unit
            regardless of how many URLs it returns.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="headers" title="Rate Limit Headers" icon={Clock}>
        <p className="text-muted-foreground">
          Every successful scan response includes rate-limit headers. A 429
          response includes the same headers plus <code>Retry-After</code>.
        </p>

        <Card className="p-6 border-border/40">
          <CodeBlock
            code={`HTTP/1.1 200 OK
X-RateLimit-Limit: 150
X-RateLimit-Remaining: 147
X-RateLimit-Used: 3
X-RateLimit-Policy: daily
X-RateLimit-Reset: 2026-03-12T00:00:00.000Z`}
            language="http"
          />

          <div className="mt-6 space-y-3">
            {[
              {
                header: "X-RateLimit-Limit",
                desc: "Your effective daily limit for this auth context",
              },
              {
                header: "X-RateLimit-Remaining",
                desc: "Units remaining in the current window",
              },
              {
                header: "X-RateLimit-Used",
                desc: "Units consumed in the current window",
              },
              {
                header: "X-RateLimit-Policy",
                desc: 'Always "daily" — distinguishes this from any future per-minute policies',
              },
              {
                header: "X-RateLimit-Reset",
                desc: "ISO 8601 timestamp at which the counter resets",
              },
              {
                header: "Retry-After",
                desc: "Seconds to wait (only on 429 responses)",
              },
            ].map((item) => (
              <div key={item.header} className="flex items-start gap-3">
                <code className="bg-secondary px-2 py-1 rounded text-xs font-mono flex-shrink-0">
                  {item.header}
                </code>
                <span className="text-sm text-muted-foreground">
                  {item.desc}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <DocsCallout variant="info" title="Reset semantics differ by auth">
          <p>
            For <strong>session auth</strong>, the daily counter resets at{" "}
            <strong>00:00 UTC</strong>. For <strong>API-key auth</strong>, the
            counter is a rolling 24-hour window anchored to the oldest usage in
            the current period. The same <code>X-RateLimit-Reset</code> header
            reflects whichever applies.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="handling" title="Handling 429 Responses" icon={Zap}>
        <p className="text-muted-foreground">
          When you exceed your quota, the API returns 429 with a structured
          body.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">429 response</h3>
          <CodeBlock
            code={`HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 43200

{
  "error": "Daily scan limit reached. Resets at 2026-03-12T00:00:00Z.",
  "limit": 150,
  "used": 150,
  "remaining": 0,
  "resets_at": "2026-03-12T00:00:00Z"
}`}
            language="http"
          />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">
            Exponential backoff (TypeScript)
          </h3>
          <CodeBlock
            code={`async function scanWithRetry(url: string, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch('${APP_URL}/api/v2/scan', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? '60');
      const wait = Math.min(retryAfter * 1000, 2 ** attempt * 1000);
      console.log(\`Rate limited. Waiting \${wait / 1000}s before retry.\`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    return response.json();
  }
  throw new Error('Rate limit retries exceeded');
}`}
            language="typescript"
          />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Python</h3>
          <CodeBlock
            code={`import requests
import time

def scan_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        response = requests.post(
            '${APP_URL}/api/v2/scan',
            headers={'Authorization': 'Bearer YOUR_API_KEY'},
            json={'url': url},
        )
        if response.status_code == 429:
            retry_after = int(response.headers.get('Retry-After', 60))
            wait = min(retry_after, 2 ** attempt)
            print(f"Rate limited. Waiting {wait}s.")
            time.sleep(wait)
            continue
        return response.json()
    raise Exception('Rate limit retries exceeded')`}
            language="python"
          />
        </Card>
      </DocsSection>

      <DocsSection
        id="best-practices"
        title="Best Practices"
        icon={ShieldCheck}
      >
        <Card className="p-6 border-border/40">
          <div className="grid gap-6 sm:grid-cols-2">
            {[
              {
                title: "Check Remaining proactively",
                desc: "Read X-RateLimit-Remaining after every call. Pause early instead of waiting for 429s.",
              },
              {
                title: "Batch via crawl",
                desc: "One crawl call is cheaper than N individual scans and shares one quota unit on the Bearer path.",
              },
              {
                title: "Cache results locally",
                desc: "Don't re-scan a target that hasn't changed. The /api/v2/finding-types endpoint exposes stable IDs.",
              },
              {
                title: "Spread requests",
                desc: "Distribute scans across the day rather than bursting all at once — easier to recover from a single 429.",
              },
              {
                title: "Use multiple keys",
                desc: "You can have up to 3 active API keys per user. Split workload by key to get separate quotas.",
              },
              {
                title: "Use the demo endpoint for testing",
                desc: "/api/v2/demo-scan is IP-rate-limited (CONFIG_DEMO_SCAN_LIMIT=5 per 12h) and doesn't require an account.",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="p-4 rounded-lg bg-secondary/20 border border-border/40"
              >
                <h4 className="font-semibold text-sm mb-2">{item.title}</h4>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </Card>
      </DocsSection>
    </div>
  );
}
