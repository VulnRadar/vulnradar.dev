import Link from "next/link";
import { Card } from "@/components/ui/card";

import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { STAFF_ROLES } from "@/lib/rate-limiting/daily-limits";
import { cn } from "@/lib/ui/utils";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
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
  { id: "ip-rate-limits", label: "Named Rate Limits" },
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
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
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
            <strong className="text-foreground">Named rate limits</strong>:{" "}
            <InlineCode>lib/rate-limiting/rate-limit.ts</InlineCode>. Sliding
            window in the <InlineCode>rate_limits</InlineCode> table. Each one
            names what it is keyed on, and it is not always the IP: the
            pre-login auth endpoints (signup, login, forgot-password) key on IP
            because there is no user yet, while almost everything after sign-in
            keys on the user id, so rotating source addresses does not reset it.
            See the table below for which is which.
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

        {/* Two per row on a phone. px-2.5 below sm had bought enough room for
            four cells at 375px, but not at 320px: there each cell is about
            52px of content box and "5,000/day" needs roughly 76px, so the last
            cell was still being shaved off by the row's overflow-hidden. */}
        <div className="flex flex-wrap divide-x divide-border/50 overflow-hidden rounded-lg border border-border/50 bg-card/50">
          {dailyQuotas.map((plan) => (
            <div
              key={plan.plan}
              className={cn(
                "flex min-w-0 flex-1 basis-1/2 flex-col gap-0.5 px-2.5 py-3 sm:basis-0 sm:px-4",
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
              {/* A plan name we wrote, so it wraps rather than clips. */}
              <span className="text-[11px] text-muted-foreground">
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
            <InlineCode>apiRequestsPerDay</InlineCode>). A new key&rsquo;s{" "}
            <InlineCode>daily_limit</InlineCode> is your plan&rsquo;s{" "}
            <InlineCode>apiRequestsPerDay</InlineCode>, not a separate per-key
            default: 25 on Free, 100 on Core Supporter, 5,000 on Pro Supporter,
            effectively unlimited on Elite Supporter. Rotating a key re-reads it
            from your current plan.
          </p>
        </DocsCallout>

        {/* This said staff accounts have NO limit, and named three roles.
            Both halves were wrong.

            Wrong on the behaviour: resolveUserPlan() tags a staff role as
            "staff", and getDailyLimit() resolves that tag to the Pro Supporter
            plan's real limits. Staff are on a plan, not exempt. The old copy
            promised Infinity, which is what the billing-disabled branch
            returns, not what a staff role returns.

            Wrong on the list: it named three of the seven roles in
            STAFF_ROLES, so billing, security_analyst, content_manager and ops
            were undocumented. The list is now rendered from that exported
            constant, so a role added there cannot go missing here. */}
        <DocsCallout variant="info" title="Staff accounts scan on a plan">
          <p>
            A user whose role is one of{" "}
            {STAFF_ROLES.map((role, i) => (
              <span key={role}>
                {i > 0 && (i === STAFF_ROLES.length - 1 ? " or " : ", ")}
                <InlineCode>{role}</InlineCode>
              </span>
            ))}{" "}
            is resolved to the <InlineCode>staff</InlineCode> plan tag, which
            carries the same daily allowance as Pro Supporter. That is a plan,
            not an exemption: staff still spend against a quota and can still
            run out. Only running {APP_NAME} with billing turned off makes a
            daily limit genuinely unlimited.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="ip-rate-limits" title="Named Rate Limits">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Every named limit below is admin-editable and configured in{" "}
          <InlineCode>lib/config/config-values.ts</InlineCode> as a{" "}
          <InlineCode>CONFIG_RATE_LIMIT_*_ATTEMPTS</InlineCode> +{" "}
          <InlineCode>_WINDOW_MINUTES</InlineCode> pair (the map from limit name
          to registry keys is <InlineCode>CONFIGURABLE_LIMITS</InlineCode> in{" "}
          <InlineCode>lib/rate-limiting/rate-limit.ts</InlineCode>). The window
          is converted to seconds when the limit is resolved. Every number in
          the table below is therefore a{" "}
          <strong className="text-foreground">shipped default</strong>, not a
          constant: the instance you are calling may have been tuned.
        </p>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          The <strong className="text-foreground">Keyed on</strong> column is
          the part that matters when you are sizing a client or reasoning about
          abuse. A limit keyed on the user is not reset by changing IP; a limit
          keyed on the IP is shared by everyone behind the same NAT or proxy.
          This table previously listed IP for all of them, and omitted nine
          limits that are enforced.
        </p>

        <DocsTable
          caption="Every enforced named rate limit, its shipped default, and what it counts against"
          columns={[
            { key: "endpoint", header: "Endpoint" },
            { key: "attempts", header: "Max attempts" },
            { key: "window", header: "Window (min)" },
            { key: "keyedOn", header: "Keyed on" },
          ]}
          data={[
            {
              endpoint: "POST /api/v3/auth/login",
              attempts: "5",
              window: "15",
              keyedOn: "IP",
            },
            {
              endpoint: "POST /api/v3/auth/signup",
              attempts: "3",
              window: "60",
              keyedOn: "IP",
            },
            {
              endpoint: "POST /api/v3/auth/forgot-password",
              attempts: "3",
              window: "10",
              keyedOn: "IP",
            },
            // The four rows below key on something other than the IP for the
            // same reason: an attacker who can rotate source addresses walks
            // straight past an IP bucket, so the thing being protected (one
            // email address, one account) is what the limit counts against.
            // They were inline literals in their route files with no setting
            // and no documentation until AUDIT-014#magic-08.
            {
              endpoint: "POST /api/v3/auth/signup (per email address)",
              attempts: "5",
              window: "60",
              keyedOn: "email address",
            },
            {
              endpoint: "POST /api/v3/auth/forgot-password (per email address)",
              attempts: "3",
              window: "60",
              keyedOn: "email address",
            },
            {
              endpoint: "POST /api/v3/domains",
              attempts: "20",
              window: "60",
              keyedOn: "user",
            },
            {
              endpoint: "POST /api/v3/domains/{id}/verify",
              attempts: "30",
              window: "60",
              keyedOn: "user",
            },
            {
              endpoint: "POST /api/v3/auth/2fa/verify",
              attempts: "5",
              window: "5",
              keyedOn: "user + IP, and user alone",
            },
            {
              // Was published as covering "any /api/v3/*", which middleware
              // does not do: this bucket is applied per route, on a handful of
              // them. Documenting a blanket limit that does not exist both
              // over-promises protection and misleads anyone sizing their own
              // client against it.
              endpoint: "API requests (on rate-limited routes)",
              attempts: "100",
              window: "60",
              keyedOn: "IP or user, per route",
            },
            {
              endpoint: "POST /api/v3/scan (and friends)",
              attempts: "100",
              window: "60",
              keyedOn: "user",
            },
            {
              endpoint: "POST /api/v3/scan/bulk",
              attempts: "10",
              window: "60",
              keyedOn: "user",
            },
            {
              endpoint: "POST /api/v3/browser/sessions",
              attempts: "20",
              window: "60",
              keyedOn: "user",
            },
            {
              endpoint: "POST /api/v3/ai/chat",
              attempts: "60",
              window: "60",
              keyedOn: "user",
            },
            {
              endpoint:
                "POST /api/v3/scan/verify and /api/v3/scan/verify-batch (one shared bucket)",
              attempts: "20",
              window: "60",
              keyedOn: "user",
            },
            {
              endpoint: "POST /api/v3/history/{id}/summary",
              attempts: "20",
              window: "60",
              keyedOn: "user",
            },
            {
              endpoint: "Admin PATCH re-auth",
              attempts: "10",
              window: "15",
              keyedOn: "user + IP",
            },
            {
              endpoint: "POST /api/v3/billing/verify",
              attempts: "5",
              window: "5",
              keyedOn: "user",
            },
            {
              endpoint: "POST /api/v3/teams/members (invites)",
              attempts: "20",
              window: "60",
              keyedOn: "user",
            },
            {
              endpoint: "/api/v3/scan/tags",
              attempts: "60",
              window: "60",
              keyedOn: "user",
            },
            {
              endpoint: "GET /api/v3/public-scans",
              attempts: "60",
              window: "1",
              keyedOn: "IP",
            },
          ]}
        />

        <DocsCallout
          variant="info"
          title="2FA email resend is a cooldown, not a rate limit"
        >
          <p>
            This table used to carry a row for{" "}
            <InlineCode>POST /api/v3/auth/2fa/email-send</InlineCode> at 1
            attempt / 1 minute, described as an IP limit configured by a{" "}
            <InlineCode>CONFIG_RATE_LIMIT_*</InlineCode> pair. No such pair
            exists, so an operator went looking for a setting that was never
            there. The route uses a different mechanism entirely: it reads{" "}
            <InlineCode>EMAIL_2FA_RESEND_COOLDOWN_SECONDS</InlineCode> (default{" "}
            <InlineCode>60</InlineCode>, admin-editable) and refuses with a 429
            if a code row for that user was created inside the window. It is
            keyed on the user id from the pending-2FA cookie, not the IP, and it
            does not use the sliding-window table at all.
          </p>
        </DocsCallout>

        <DocsCallout variant="success" title="Crawl count semantics">
          <p>
            For Bearer-authenticated deep crawls (
            <InlineCode>/api/v3/scan/crawl</InlineCode>
            ), the call itself counts as{" "}
            <strong className="text-foreground">1</strong> daily quota unit. For
            session-authenticated crawls, each scanned page counts as 1 unit (10
            pages = 10 quota units). Discovery (
            <InlineCode>/api/v3/scan/crawl/discover</InlineCode>) costs{" "}
            <strong className="text-foreground">no</strong> daily quota: it
            fetches and parses links, it does not scan, so nothing in that route
            touches the daily counter. It is still frequency-limited, at the
            scan cap and in its own{" "}
            <InlineCode>crawl-discover:&#123;userId&#125;</InlineCode> bucket.
            This paragraph used to say discovery cost 1 unit, which contradicted
            the API reference and overstated the price of previewing a crawl.
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
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          A 429 from a scan endpoint carries the full set below. Whether{" "}
          <InlineCode>Retry-After</InlineCode> comes with it depends on which
          limit you hit: an API key&rsquo;s own daily cap adds it, the account
          quota does not, because that one always resets at midnight UTC. On a{" "}
          <strong className="text-foreground">successful</strong> response the
          coverage is narrower than you might expect:{" "}
          <InlineCode>POST /scan</InlineCode> and{" "}
          <InlineCode>POST /scan/crawl</InlineCode> send{" "}
          <InlineCode>Limit</InlineCode>, <InlineCode>Remaining</InlineCode> and{" "}
          <InlineCode>Reset</InlineCode> only when the caller used a Bearer key;{" "}
          <InlineCode>POST /scan/bulk</InlineCode> on the session path sends all
          five. A session-authenticated single scan, and every{" "}
          <InlineCode>/history</InlineCode> or{" "}
          <InlineCode>/scan/status</InlineCode> read, sends none. If you are
          calling with a session cookie, track your own count rather than
          waiting for a header that will not arrive.
        </p>

        <Card className="p-6 border-border/40">
          <CodeBlock
            code={`HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 150
X-RateLimit-Remaining: 0
X-RateLimit-Used: 150
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
                title: "Use multiple keys, but know what they split",
                desc: "How many active keys you can hold is per plan, not a flat 3: Free 1, Core Supporter 3, Pro Supporter 10, Elite Supporter unlimited. Going over is a 400 from the key-creation endpoint. Each key carries its own daily API-request budget, so splitting a workload across keys does buy separate request budgets. It does not multiply your scans: the daily scan quota and the named rate limits above are keyed on the account, so a second key shares them.",
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
