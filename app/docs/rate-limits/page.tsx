"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";

import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";
import { useDocsContext, type TocItem } from "@/components/docs/docs-shell";
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  CodeBlock,
  DocsTable,
  InlineCode,
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
    color: "text-[hsl(var(--severity-low))]",
  },
  {
    plan: "Pro",
    scans: "150",
    api: "5,000",
    color: "text-[hsl(var(--warning))]",
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
        id="top"
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
        <p className="text-sm text-muted-foreground">
          Two separate limit systems protect the platform. They are enforced in
          different places and behave differently on overflow.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Per-IP rate limits</strong>:{" "}
            <InlineCode>lib/rate-limiting/rate-limit.ts</InlineCode>. Sliding
            window in the <InlineCode>rate_limits</InlineCode> table. Used by
            auth endpoints (signup, login, forgot-password), the API as a whole,
            and the scan routes.
          </li>
          <li>
            <strong className="text-foreground">Per-plan daily quotas</strong>:{" "}
            <InlineCode>lib/rate-limiting/daily-limits.ts</InlineCode>. Tracks
            usage per user (session auth) or per API key (Bearer auth) for a
            24-hour window. Limits come from{" "}
            <InlineCode>lib/billing/catalog.ts</InlineCode>.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="limits-by-plan" title="Daily Quotas by Plan">
        <p className="text-sm text-muted-foreground">
          Two separate counters:{" "}
          <strong className="text-foreground">scans/day</strong> enforced for
          session-authenticated users, and{" "}
          <strong className="text-foreground">API requests/day</strong> enforced
          for Bearer-authenticated API keys.
        </p>

        <div className="flex divide-x divide-border/50 overflow-hidden rounded-lg border border-border/50 bg-card/50">
          {dailyQuotas.map((plan) => (
            <div
              key={plan.plan}
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3",
                plan.highlight && "bg-primary/5",
              )}
            >
              <span
                className={cn(
                  "text-lg font-semibold tabular-nums leading-none",
                  plan.color,
                )}
              >
                {plan.scans}
                <span className="text-xs font-normal text-muted-foreground">
                  /day
                </span>
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {plan.plan}
              </span>
            </div>
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
            Daily quotas are defined in{" "}
            <InlineCode>lib/billing/catalog.ts</InlineCode> (one entry per plan:{" "}
            <InlineCode>dailyScans</InlineCode> and{" "}
            <InlineCode>apiRequestsPerDay</InlineCode>). New API keys default to{" "}
            <InlineCode>CONFIG_DEFAULT_API_KEY_DAILY_LIMIT = 50</InlineCode> (
            <InlineCode>lib/config/config-values.ts</InlineCode>).
          </p>
        </DocsCallout>

        <DocsCallout variant="info" title="Staff accounts have no limit">
          <p>
            Users with role <InlineCode>admin</InlineCode>,{" "}
            <InlineCode>moderator</InlineCode>, or{" "}
            <InlineCode>support</InlineCode> are exempt from daily quotas (
            <InlineCode>daily-limits.ts</InlineCode> returns{" "}
            <InlineCode>Infinity</InlineCode>).
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="ip-rate-limits" title="Per-IP Limits">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          IP-based rate limits are configured in{" "}
          <InlineCode>lib/config/config-values.ts</InlineCode> as{" "}
          <InlineCode>CONFIG_RATE_LIMIT_*_ATTEMPTS</InlineCode> +{" "}
          <InlineCode>_WINDOW_MINUTES</InlineCode> pairs. The window is
          converted to seconds at boot.
        </p>

        <DocsTable
          columns={[
            { key: "endpoint", header: "Endpoint" },
            { key: "attempts", header: "Max attempts" },
            { key: "window", header: "Window (min)" },
          ]}
          data={[
            {
              endpoint: "POST /api/v3/auth/login",
              attempts: "5",
              window: "15",
            },
            {
              endpoint: "POST /api/v3/auth/signup",
              attempts: "3",
              window: "60",
            },
            {
              endpoint: "POST /api/v3/auth/forgot-password",
              attempts: "3",
              window: "10",
            },
            {
              endpoint: "POST /api/v3/auth/2fa/verify",
              attempts: "5",
              window: "5",
            },
            {
              endpoint: "POST /api/v3/auth/2fa/email-send",
              attempts: "1",
              window: "1",
            },
            {
              endpoint: "API requests per IP (any /api/v3/*)",
              attempts: "100",
              window: "60",
            },
            {
              endpoint: "POST /api/v3/scan (and friends)",
              attempts: "100",
              window: "60",
            },
            {
              endpoint: "POST /api/v3/scan/bulk",
              attempts: "10",
              window: "60",
            },
          ]}
        />

        <DocsCallout variant="success" title="Crawl count semantics">
          <p>
            For Bearer-authenticated deep crawls (
            <InlineCode>/api/v3/scan/crawl</InlineCode>
            ), the call itself counts as{" "}
            <strong className="text-foreground">1</strong> daily quota unit. For
            session-authenticated crawls, each scanned page counts as 1 unit (10
            pages = 10 quota units). Discovery (
            <InlineCode>/api/v3/scan/crawl/discover</InlineCode>) counts as 1
            unit regardless of how many URLs it returns.
          </p>
        </DocsCallout>

        <DocsCallout variant="info" title="Not the same as IP session binding">
          <p>
            These are frequency limits: how often a given IP or key may call an
            endpoint. A separate, optional setting can additionally bind a
            session or API key to the subnet it started on and end it on a
            mismatch. That is an identity check, off by default, documented on
            the{" "}
            <Link
              href="/docs/config"
              className="text-primary underline-offset-2 hover:underline"
            >
              Configuration
            </Link>{" "}
            page, not a rate limit.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="headers" title="Rate Limit Headers">
        <p className="text-sm text-muted-foreground">
          Every successful scan response includes rate-limit headers. A 429
          response includes the same headers plus{" "}
          <InlineCode>Retry-After</InlineCode>.
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
                desc: 'Always "daily": distinguishes this from any future per-minute policies',
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
                <InlineCode className="shrink-0">{item.header}</InlineCode>
                <span className="text-sm text-muted-foreground">
                  {item.desc}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <DocsCallout variant="info" title="Reset semantics differ by auth">
          <p>
            For <strong className="text-foreground">session auth</strong>, the
            daily counter resets at{" "}
            <strong className="text-foreground">00:00 UTC</strong>. For{" "}
            <strong className="text-foreground">API-key auth</strong>, the
            counter is a rolling 24-hour window anchored to the oldest usage in
            the current period. The same{" "}
            <InlineCode>X-RateLimit-Reset</InlineCode> header reflects whichever
            applies.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="handling" title="Handling 429 Responses">
        <p className="text-sm text-muted-foreground">
          When you exceed your quota, the API returns 429 with a structured
          body.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">429 response</h3>
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
          <h3 className="text-base font-semibold mb-4">
            Exponential backoff (TypeScript)
          </h3>
          <CodeBlock
            code={`async function scanWithRetry(url: string, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch('${APP_URL}/api/v3/scan', {
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
          <h3 className="text-base font-semibold mb-4">Python</h3>
          <CodeBlock
            code={`import requests
import time

def scan_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        response = requests.post(
            '${APP_URL}/api/v3/scan',
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

      <DocsSection id="best-practices" title="Best Practices">
        <Card className="p-6 border-border/40">
          <ol className="flex flex-col gap-4">
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
                desc: "Don't re-scan a target that hasn't changed. The /api/v3/finding-types endpoint exposes stable IDs.",
              },
              {
                title: "Spread requests",
                desc: "Distribute scans across the day rather than bursting all at once. It is easier to recover from a single 429.",
              },
              {
                title: "Use multiple keys",
                desc: "You can have up to 3 active API keys per user. Split workload by key to get separate quotas.",
              },
              {
                title: "Use the demo endpoint for testing",
                desc: "/api/v3/demo-scan is IP-rate-limited (CONFIG_DEMO_SCAN_LIMIT=5 per 12h) and doesn't require an account.",
              },
            ].map((item, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 pt-px font-mono text-xs tabular-nums text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="text-sm leading-relaxed">
                  <span className="font-medium text-foreground">
                    {item.title}.
                  </span>{" "}
                  <span className="text-muted-foreground">{item.desc}</span>
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </DocsSection>
    </div>
  );
}
