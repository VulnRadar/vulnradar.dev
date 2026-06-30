"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_URL, ROUTES } from "@/lib/config/constants";

const API_BASE = APP_URL.replace(/\/$/, "");

const CURL = `curl -X POST ${API_BASE}/api/v3/scan \\
  -H "Authorization: Bearer $VULNRADAR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com",
    "scanners": ["headers", "tls", "content"]
  }'`;

const RESPONSE = `{
  "url": "https://example.com",
  "scannedAt": "2025-06-23T19:02:11Z",
  "duration": 2841,
  "checksRun": 412,
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

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-border/60 bg-[#0a0a0a] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/50" />
          </div>
          <span className="text-xs font-mono text-white/50 ml-1">{label}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
          className="h-7 px-2 text-xs text-white/50 hover:text-white hover:bg-white/10 gap-1.5"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <pre className="p-4 overflow-x-auto text-[12px] leading-6 font-mono text-white/80">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function LandingApiExample() {
  return (
    <section className="py-16 sm:py-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-10 lg:gap-16 items-start">
          {/* Code on the left */}
          <div className="space-y-3 min-w-0">
            <CodeBlock code={CURL} label="curl" />
            <CodeBlock code={RESPONSE} label="response.json" />
            <p className="text-xs text-muted-foreground font-mono">
              <Terminal className="inline h-3 w-3 mr-1 -mt-0.5" />
              Full field reference at /docs/api, including all stable finding
              IDs and severity codes.
            </p>
          </div>

          {/* Text on the right */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
              One endpoint. Bearer token. JSON out.
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              The same engine the dashboard uses is exposed at{" "}
              <code className="text-xs px-1.5 py-0.5 rounded bg-muted text-foreground">
                /api/v3/scan
              </code>
              . Drop it into a GitHub Action or a cron job. The findings you
              get back are identical to what you see in the UI: same IDs, same
              severities, stable across runs.
            </p>

            <div className="space-y-3 text-sm text-muted-foreground mb-8">
              {[
                "Bearer-token auth, scoped per workspace and encrypted at rest.",
                "Free tier: 25 scans per day. Supporter tiers raise the cap.",
                "Bulk endpoint at /api/v3/scan/bulk scans up to 1000 URLs at once.",
                "Webhook fires on completion. Pipe to Slack, Discord, or your own handler.",
              ].map((point, i) => (
                <p key={i} className="flex gap-2.5 leading-relaxed">
                  <span className="text-primary shrink-0 mt-0.5 font-bold select-none">
                    ·
                  </span>
                  {point}
                </p>
              ))}
            </div>

            <Link
              href={ROUTES.DOCS_API}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Read the API docs
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
