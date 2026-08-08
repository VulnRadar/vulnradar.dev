"use client";

import {
  BadgeCheck,
  Check,
  Clock,
  Copy,
  Gauge,
  ShieldCheck,
  Timer,
  type LucideIcon as LucideIconType,
} from "lucide-react";
import { useState } from "react";
import type { ScanResult } from "@/lib/scanner/types";
import { cn } from "@/lib/ui/utils";
import { SeverityDistribution } from "@/components/scanner/severity-badge";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { StatIcon, type StatTone } from "@/components/shared/stat-icon";

interface ScanSummaryProps {
  result: ScanResult;
  /** Pass true in DashboardResults to hide the URL/copy row (it has its own) */
  hideHeader?: boolean;
}

const VERDICT = {
  safe: {
    headline: "Nothing exploitable found",
    detail:
      "Everything flagged here is a hardening recommendation, not a way in. Fix them when convenient.",
    rail: "bg-[hsl(var(--success))]",
    text: "text-[hsl(var(--success))]",
  },
  caution: {
    headline: "Review before you trust this host",
    detail:
      "At least one finding could be exploitable depending on how the site is used. Read the high and critical entries first.",
    rail: "bg-[hsl(var(--severity-medium))]",
    text: "text-[hsl(var(--severity-medium))]",
  },
  unsafe: {
    headline: "Actively exploitable issues found",
    detail:
      "The scanner found problems an attacker can use right now. Treat the critical findings as work for today.",
    rail: "bg-[hsl(var(--severity-critical))]",
    text: "text-[hsl(var(--severity-critical))]",
  },
} as const;

function getRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function Stat({
  label,
  value,
  icon,
  tone = "muted",
}: {
  label: string;
  value: string;
  icon: LucideIconType;
  tone?: StatTone;
}) {
  return (
    <div className="flex min-w-0 flex-1 basis-24 items-center gap-2.5 px-3 py-2 sm:px-4">
      <StatIcon icon={icon} tone={tone} size="sm" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold tabular-nums text-foreground">
          {value}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}

export function ScanSummary({ result, hideHeader }: ScanSummaryProps) {
  const [copied, setCopied] = useState(false);
  const scanDate = new Date(result.scannedAt);
  const verdict = VERDICT[getSafetyRating(result.findings)];

  const counts = {
    critical: result.summary.critical || 0,
    high: result.summary.high || 0,
    medium: result.summary.medium || 0,
    low: result.summary.low || 0,
    info: result.summary.info || 0,
  };

  function copyUrl() {
    navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      {!hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
          <button
            type="button"
            onClick={copyUrl}
            className="group flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Copy scanned URL"
          >
            <span className="truncate font-mono text-sm text-foreground group-hover:text-primary transition-colors">
              {result.url.replace(/^https?:\/\//, "")}
            </span>
            {copied ? (
              <Check
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--success))]"
              />
            ) : (
              <Copy
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            )}
          </button>
          <span className="shrink-0 text-xs text-muted-foreground">
            {getRelativeTime(scanDate)}
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="relative">
          <span
            aria-hidden
            className={cn("absolute inset-y-0 left-0 w-1", verdict.rail)}
          />
          <div className="grid gap-5 py-4 pl-5 pr-4 sm:py-5 sm:pl-6 sm:pr-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-8">
            <div className="flex flex-col gap-1.5">
              <h2
                className={cn(
                  "text-base font-semibold leading-tight sm:text-lg",
                  verdict.text,
                )}
              >
                {verdict.headline}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {verdict.detail}
              </p>
              <p className="pt-1 text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">
                  {result.summary.total}
                </span>{" "}
                {result.summary.total === 1 ? "finding" : "findings"} total
              </p>
            </div>

            <SeverityDistribution counts={counts} className="lg:pt-1" />
          </div>
        </div>

        <div className="flex flex-wrap items-stretch divide-x divide-border border-t border-border bg-muted/30">
          {result.dangerScore !== undefined && (
            <Stat
              label="Risk score"
              value={`${result.dangerScore}/10`}
              icon={Gauge}
              tone="primary"
            />
          )}
          {result.engineConfidence !== undefined && (
            <Stat
              label="Engine confidence"
              value={`${result.engineConfidence}%`}
              icon={BadgeCheck}
              tone="primary"
            />
          )}
          {result.checksRun !== undefined && result.checksRun > 0 && (
            <Stat
              label="Checks run"
              value={result.checksRun.toLocaleString()}
              icon={ShieldCheck}
              tone="purple"
            />
          )}
          <Stat
            label="Scan duration"
            value={`${(result.duration / 1000).toFixed(1)}s`}
            icon={Timer}
            tone="muted"
          />
          <Stat
            label="Scanned"
            value={getRelativeTime(scanDate)}
            icon={Clock}
            tone="muted"
          />
        </div>
      </div>
    </div>
  );
}
