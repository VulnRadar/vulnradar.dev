"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_URL, ROUTES } from "@/lib/config/constants";

const API_BASE = APP_URL.replace(/\/$/, "");

const CURL = `curl -X POST ${API_BASE}/api/v2/scan \\
  -H "Authorization: Bearer $VULNRADAR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com",
    "scanners": ["headers", "tls", "content"]
  }'`;

const RESPONSE = `{
  "url": "https://example.com",
  "scannedAt": "2024-06-23T19:02:11.214Z",
  "duration": 2841,
  "checksRun": 412,
  "summary": {
    "critical": 0, "high": 1, "medium": 0, "low": 0, "info": 0, "total": 1
  },
  "findings": [
    {
      "id": "vuln-1719169331214-1",
      "title": "Missing HTTP Strict Transport Security (HSTS)",
      "severity": "high",
      "category": "headers",
      "description": "The server does not send the Strict-Transport-Security header, which tells browsers to only connect via HTTPS.",
      "evidence": "Header 'Strict-Transport-Security' is not present in the response.",
      "riskImpact": "Attackers could intercept traffic via man-in-the-middle attacks by downgrading the connection from HTTPS to HTTP.",
      "explanation": "HSTS instructs browsers to only access the site over HTTPS for a specified duration.",
      "fixSteps": [
        "Add the Strict-Transport-Security header to all HTTPS responses.",
        "Set a max-age of at least 31536000 (1 year).",
        "Consider adding includeSubDomains and preload directives."
      ],
      "codeExamples": [
        {
          "label": "Nginx",
          "language": "nginx",
          "code": "add_header Strict-Transport-Security \"max-age=63072000; includeSubDomains; preload\" always;"
        }
      ],
      "references": []
    }
  ]
}`;

function Snippet({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="rounded-xl border border-border/60 bg-[#0a0a0a] overflow-hidden min-w-0 max-w-full">
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-white/10 bg-white/[0.03]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="flex gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
          </div>
          <span className="text-xs font-mono text-white/60 ml-1.5 truncate">
            {label}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopy}
          className="h-7 px-2 text-xs text-white/60 hover:text-white hover:bg-white/10 gap-1.5 shrink-0"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Copy</span>
            </>
          )}
        </Button>
      </div>
      <pre className="p-3 sm:p-4 overflow-x-auto text-[11px] sm:text-[12.5px] leading-6 font-mono text-white/85 max-w-full">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function LandingApiExample() {
  return (
    <section className="py-16 sm:py-24 border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-10 lg:gap-14 items-start min-w-0">
        <div>
          <p className="text-xs font-medium text-primary uppercase tracking-wider mb-3">
            Developer API
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4 text-balance">
            One endpoint. Bearer auth. JSON in, JSON out.
          </h2>
          <p className="text-muted-foreground mb-6 text-pretty">
            The same engine the dashboard uses is exposed at{" "}
            <code className="text-xs px-1.5 py-0.5 rounded bg-muted text-foreground">
              /api/v2/scan
            </code>
            . Drop it into a CI step, a GitHub Action, or a cron. Findings are
            identical to what you see in the UI, with stable IDs and severities
            you can compare over time.
          </p>
          <ul className="space-y-2.5 text-sm text-muted-foreground">
            <li className="flex gap-2.5 min-w-0">
              <span
                aria-hidden
                className="text-primary shrink-0 mt-0.5 text-base leading-none font-bold"
              >
                •
              </span>
              <span className="break-words">
                Bearer-token auth, encrypted at rest, scoped per workspace.
              </span>
            </li>
            <li className="flex gap-2.5 min-w-0">
              <span
                aria-hidden
                className="text-primary shrink-0 mt-0.5 text-base leading-none font-bold"
              >
                •
              </span>
              <span className="break-words">
                Rate-limited per plan. Free: 25 scans/day. Supporter tiers raise
                the cap.
              </span>
            </li>
            <li className="flex gap-2.5 min-w-0">
              <span
                aria-hidden
                className="text-primary shrink-0 mt-0.5 text-base leading-none font-bold"
              >
                •
              </span>
              <span className="break-words">
                Webhooks fire on completion. Pipe to Slack, Discord, or your own
                endpoint.
              </span>
            </li>
            <li className="flex gap-2.5 min-w-0">
              <span
                aria-hidden
                className="text-primary shrink-0 mt-0.5 text-base leading-none font-bold"
              >
                •
              </span>
              <span className="break-words">
                1000-URL bulk endpoint at{" "}
                <code className="text-[11px] px-1 py-0.5 rounded bg-muted text-foreground break-all">
                  /api/v2/scan/bulk
                </code>{" "}
                for fleet-wide sweeps. CSV or JSON output.
              </span>
            </li>
          </ul>
          <Link
            href={ROUTES.DOCS_API}
            className="mt-6 inline-flex items-center text-sm font-medium text-primary hover:underline"
          >
            Read the API reference
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Link>
        </div>

        <div className="space-y-4 min-w-0">
          <Snippet code={CURL} label="curl" />
          <Snippet code={RESPONSE} label="response.json" />
          <p className="text-xs text-muted-foreground font-mono break-words">
            <Terminal className="inline h-3 w-3 -mt-0.5 mr-1" />
            Every field is documented at /docs/api, including all stable finding
            IDs and severity codes.
          </p>
        </div>
      </div>
    </section>
  );
}
