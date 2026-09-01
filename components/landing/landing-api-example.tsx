"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_URL, ROUTES } from "@/lib/config/client-constants";
import { EXACT_CHECK_COUNT } from "@/lib/config/check-stats.generated";
import { copyToClipboard } from "@/lib/ui/clipboard";

const API_BASE = APP_URL.replace(/\/$/, "");

const CURL = `curl -X POST ${API_BASE}/api/v3/scan \\
  -H "Authorization: Bearer $VULNRADAR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com",
    "scanners": ["headers", "tls", "content"]
  }'`;

function responseSample(checksRun: number) {
  return `{
  "url": "https://example.com",
  "scannedAt": "2026-06-23T19:02:11Z",
  "duration": 2841,
  "checksRun": ${checksRun},
  "summary": {
    "high": 1, "medium": 3, "low": 2, "info": 4, "total": 10
  },
  "findings": [
    {
      "id": "hsts-missing",
      "title": "Missing HTTP Strict Transport Security",
      "severity": "high",
      "category": "headers",
      "evidence": "Header 'Strict-Transport-Security' not present.",
      "fixSteps": [
        "Add Strict-Transport-Security to all HTTPS responses.",
        "Set max-age to at least 31536000."
      ]
    }
  ]
}`;
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-xl border border-border/60 bg-muted/40 overflow-hidden min-w-0">
      <div className="flex items-center justify-between gap-2 pl-4 pr-2 py-2 border-b border-border/60">
        <span className="font-mono text-xs text-muted-foreground">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Copy ${label} snippet`}
          onClick={async () => {
            if (await copyToClipboard(code)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }
          }}
          className="h-7 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span className="sr-only sm:not-sr-only">
            {copied ? "Copied" : "Copy"}
          </span>
        </Button>
      </div>
      <pre className="p-4 overflow-x-auto text-xs leading-6 font-mono text-foreground/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface LandingApiExampleProps {
  checkCount: string;
}

export function LandingApiExample({ checkCount }: LandingApiExampleProps) {
  return (
    <section className="py-16 sm:py-24 border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-10 lg:gap-14 items-start">
          <div className="space-y-3 min-w-0">
            <CodeBlock code={CURL} label="request.sh" />
            <CodeBlock
              code={responseSample(EXACT_CHECK_COUNT)}
              label="response.json"
            />
          </div>

          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4 text-balance">
              One endpoint. Bearer token. JSON out.
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              The engine behind the dashboard sits at{" "}
              <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted border border-border/60 text-foreground">
                /api/v3/scan
              </code>
              . Same IDs, same severities, same evidence you see in the
              interface. Drop it in a GitHub Action or a cron job and stop
              opening the site to check.
            </p>

            <dl className="space-y-3 text-sm border-t border-border/50 pt-5 mb-7">
              {[
                [
                  "Auth",
                  "Bearer tokens with scan:write, scan:read, and scan:delete scopes per key, encrypted at rest",
                ],
                ["Bulk", "/api/v3/scan/bulk takes up to 100 URLs per request"],
                [
                  "Webhooks",
                  "Fire on completion into Slack, Discord, or your own handler",
                ],
                ["Reference", "Every field and every finding ID is documented"],
                [
                  "Playground",
                  "Send live calls in the browser and copy each one as curl, Python, JavaScript, Go, PHP, Java, Ruby, or C#",
                ],
              ].map(([term, def]) => (
                <div key={term} className="flex gap-3">
                  <dt className="font-mono text-xs uppercase tracking-wider text-muted-foreground w-[76px] shrink-0 pt-0.5">
                    {term}
                  </dt>
                  <dd className="text-muted-foreground leading-relaxed">
                    {def}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Link
                href={ROUTES.API_PLAYGROUND}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                Try it in the playground
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href={ROUTES.DOCS_API}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-4 rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                Read the API docs
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
