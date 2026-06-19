"use client";

import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";

import { Gauge, Clock, Zap, ShieldCheck } from "lucide-react";
import { APP_NAME, APP_URL, BILLING_ENABLED } from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "../layout";
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  CodeBlock,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "limits-by-plan", label: "Limits by Plan" },
  { id: "headers", label: "Rate Limit Headers" },
  { id: "handling", label: "Handling Rate Limits" },
  { id: "best-practices", label: "Best Practices" },
];

const planLimits = [
  { plan: "Free", daily: "25", color: "text-muted-foreground" },
  { plan: "Core", daily: "100", color: "text-blue-500" },
  { plan: "Pro", daily: "5,000", color: "text-amber-500" },
  { plan: "Elite", daily: "Unlimited", color: "text-primary", highlight: true },
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
      {/* Hero */}
      <DocsHero
        badge="API Limits"
        title="Rate Limits"
        description={`${APP_NAME} implements rate limiting to ensure fair usage and platform stability. Rate limits apply per API key and reset daily at midnight UTC.`}
        stats={[
          { value: "Daily", label: "Reset Period" },
          { value: "Per Key", label: "Limit Scope" },
          { value: "UTC", label: "Reset Time" },
        ]}
      />

      {/* Limits by Plan */}
      <DocsSection id="limits-by-plan" title="Limits by Plan" icon={Gauge}>
        <p className="text-muted-foreground">
          API rate limits vary by subscription plan. Each API key has its own
          independent limit.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {planLimits.map((plan) => (
            <Card
              key={plan.plan}
              className={`p-4 border-border/50 bg-card/50 text-center ${plan.highlight ? "border-primary/30 bg-primary/5" : ""}`}
            >
              <div className={`text-xl font-bold mb-1 ${plan.color}`}>
                {plan.daily}
              </div>
              <div className="text-xs font-medium text-foreground">
                {plan.plan}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                scans/day
              </div>
            </Card>
          ))}
        </div>

        {BILLING_ENABLED && (
          <DocsCallout variant="info" title="Upgrade for Higher Limits">
            <p>
              Need more scans?{" "}
              <a href="/pricing" className="text-primary hover:underline">
                View pricing
              </a>{" "}
              to upgrade your plan and unlock higher rate limits.
            </p>
          </DocsCallout>
        )}

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">What Counts Against Your Limit</h3>
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-sm mb-2 text-green-500">
                Counts as 1 Request
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>
                  Single URL scan (
                  <code className="bg-secondary px-1 rounded text-xs">
                    POST /scan
                  </code>
                  )
                </li>
                <li>
                  URL discovery (
                  <code className="bg-secondary px-1 rounded text-xs">
                    POST /scan/crawl/discover
                  </code>
                  ) - Free
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-2 text-amber-500">
                Counts as Multiple
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>Deep crawl - 1 per page scanned</li>
                <li>10-page crawl = 10 requests</li>
              </ul>
            </div>
          </div>
        </Card>

        <DocsCallout variant="success" title="Web Sessions Are Separate">
          <p>
            Scans performed through the web interface use a separate rate limit
            pool. API limits only apply to API key requests.
          </p>
        </DocsCallout>
      </DocsSection>

      {/* Rate Limit Headers */}
      <DocsSection id="headers" title="Rate Limit Headers" icon={Clock}>
        <p className="text-muted-foreground">
          Every API response includes headers to help you track your usage.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Response Headers</h3>
          <CodeBlock
            code={`X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 2026-03-11T00:00:00.000Z
Retry-After: 43200`}
            language="http"
          />

          <div className="mt-6 space-y-3">
            {[
              { header: "X-RateLimit-Limit", desc: "Your plan's daily limit" },
              {
                header: "X-RateLimit-Remaining",
                desc: "Requests remaining today",
              },
              {
                header: "X-RateLimit-Reset",
                desc: "When the limit resets (ISO 8601)",
              },
              {
                header: "Retry-After",
                desc: "Seconds until reset (only on 429)",
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
      </DocsSection>

      {/* Handling Rate Limits */}
      <DocsSection id="handling" title="Handling Rate Limits" icon={Zap}>
        <p className="text-muted-foreground">
          When you exceed your rate limit, the API returns a 429 status code.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">429 Response</h3>
          <CodeBlock
            code={`HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 43200

{
  "error": "Rate limit exceeded",
  "limit": 100,
  "used": 100,
  "remaining": 0,
  "resets_at": "2026-03-11T00:00:00.000Z"
}`}
          />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Exponential Backoff Example</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Implement exponential backoff to gracefully handle rate limits:
          </p>
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
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
      const waitTime = Math.min(retryAfter * 1000, Math.pow(2, attempt) * 1000);
      console.log(\`Rate limited. Waiting \${waitTime / 1000}s...\`);
      await new Promise(r => setTimeout(r, waitTime));
      continue;
    }

    return response.json();
  }
  throw new Error('Max retries exceeded');
}`}
            language="typescript"
          />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Python Example</h3>
          <CodeBlock
            code={`import requests
import time

def scan_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        response = requests.post(
            '${APP_URL}/api/v2/scan',
            headers={'Authorization': 'Bearer YOUR_API_KEY'},
            json={'url': url}
        )
        
        if response.status_code == 429:
            retry_after = int(response.headers.get('Retry-After', 60))
            wait_time = min(retry_after, 2 ** attempt)
            print(f"Rate limited. Waiting {wait_time}s...")
            time.sleep(wait_time)
            continue
        
        return response.json()
    
    raise Exception('Max retries exceeded')`}
            language="python"
          />
        </Card>
      </DocsSection>

      {/* Best Practices */}
      <DocsSection
        id="best-practices"
        title="Best Practices"
        icon={ShieldCheck}
      >
        <Card className="p-6 border-border/40">
          <div className="grid gap-6 sm:grid-cols-2">
            {[
              {
                title: "Check Headers Proactively",
                desc: "Monitor X-RateLimit-Remaining to pause before hitting limits.",
              },
              {
                title: "Use Bulk Operations",
                desc: "For multiple URLs, consider deep crawl to optimize request count.",
              },
              {
                title: "Cache Results",
                desc: "Store scan results locally to avoid re-scanning unchanged URLs.",
              },
              {
                title: "Spread Requests",
                desc: "Distribute scans throughout the day instead of bursting.",
              },
              {
                title: "Use Multiple Keys",
                desc: "Create separate API keys for different projects or teams.",
              },
              {
                title: "Handle 429 Gracefully",
                desc: "Implement retry logic with exponential backoff.",
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

        <DocsCallout variant="info" title="Need Higher Limits?">
          <p>
            If you regularly hit rate limits, consider upgrading your plan or
            contact us for enterprise options with custom limits.
          </p>
        </DocsCallout>
      </DocsSection>
    </div>
  );
}
