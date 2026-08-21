"use client";

import {
  BadgeCheck,
  Check,
  Clock,
  Copy,
  Gauge,
  HelpCircle,
  Lock,
  MessageCircle,
  ShieldCheck,
  Timer,
  type LucideIcon as LucideIconType,
} from "lucide-react";
import { useState } from "react";
import type { ScanResult } from "@/lib/scanner/types";
import { cn } from "@/lib/ui/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { copyToClipboard } from "@/lib/ui/clipboard";
import { formatRelativeTime as getRelativeTime } from "@/lib/ui/relative-time";
import { SeverityDistribution } from "@/components/scanner/severity-badge";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { StatIcon, type StatTone } from "@/components/shared/stat-icon";
import { useAuth } from "@/components/providers/auth-provider";
import { askAiChatAbout } from "@/lib/ai/chat-bridge";

interface ScanSummaryProps {
  result: ScanResult;
  /** Pass true in DashboardResults to hide the URL/copy row (it has its own) */
  hideHeader?: boolean;
  /**
   * Hide the "Scan duration" stat. host_reputation (the public
   * /host/[hostname] page's data source) never stores a duration, only the
   * findings snapshot, so showing one there would mean fabricating a number
   * rather than reporting it.
   */
  hideDuration?: boolean;
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

/** Seeds the floating AI chat with this scan's summary so "Ask about this" continues as a normal conversation there. */
function buildAskPrompt(result: ScanResult, summary: string): string {
  const s = result.summary;
  return `Let's talk about this scan's summary for ${result.url}:\n\n"${summary}"\n\n(danger score ${result.dangerScore ?? "n/a"}/10, ${s.critical} critical / ${s.high} high / ${s.medium} medium / ${s.low} low / ${s.info} info findings)`;
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

/**
 * Tier colors for the SSL grade badge: A/A+ green, B blue (brand), C amber,
 * D/F red. The icon tone and the value text share one color per tier.
 */
function sslGradeStyle(grade: string): {
  tone: StatTone;
  valueClass: string;
} {
  const g = grade.toUpperCase();
  if (g === "A+" || g === "A")
    return { tone: "success", valueClass: "text-[hsl(var(--success))]" };
  if (g === "B") return { tone: "primary", valueClass: "text-primary" };
  if (g === "C")
    return {
      tone: "severity-medium",
      valueClass: "text-[hsl(var(--severity-medium))]",
    };
  return { tone: "destructive", valueClass: "text-destructive" };
}

/** SSL/TLS letter-grade cell, mirroring Stat's layout but colored by tier.
 * The "?" opens a plain-language explainer of what the grade measures. */
function SslGradeStat({ grade }: { grade: string }) {
  const style = sslGradeStyle(grade);
  return (
    <div className="flex min-w-0 flex-1 basis-24 items-center gap-2 px-3 py-2 sm:px-4">
      <StatIcon icon={Lock} tone={style.tone} size="sm" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "truncate text-sm font-semibold tabular-nums",
            style.valueClass,
          )}
        >
          {grade}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          SSL grade
        </span>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="What does the SSL grade mean?"
            className={cn(
              "ml-0.5 shrink-0 rounded-full p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <HelpCircle aria-hidden className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 text-left">
          <p className="text-xs font-semibold text-foreground">SSL/TLS grade</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            A letter grade for this site&apos;s HTTPS setup, in the style of SSL
            Labs. It comes from the TLS protocol version, the certificate&apos;s
            validity and chain, the key strength, and the negotiated cipher.
            Only sites served over HTTPS are graded.
          </p>
          <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-[11px]">
            <span className="font-semibold text-[hsl(var(--success))]">
              A+ / A
            </span>
            <span className="text-muted-foreground">Strong, modern TLS</span>
            <span className="font-semibold text-primary">B</span>
            <span className="text-muted-foreground">
              Solid, with minor gaps
            </span>
            <span className="font-semibold text-[hsl(var(--severity-medium))]">
              C
            </span>
            <span className="text-muted-foreground">
              Dated config worth fixing
            </span>
            <span className="font-semibold text-destructive">D / F</span>
            <span className="text-muted-foreground">
              Weak or broken: expired, self-signed, or an old protocol
            </span>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ScanSummary({
  result,
  hideHeader,
  hideDuration,
}: ScanSummaryProps) {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;
  const [copied, setCopied] = useState(false);
  const scanDate = new Date(result.scannedAt);
  const verdict = VERDICT[getSafetyRating(result.findings)];
  const aiSummary = result.aiSummary;

  const counts = {
    critical: result.summary.critical || 0,
    high: result.summary.high || 0,
    medium: result.summary.medium || 0,
    low: result.summary.low || 0,
    info: result.summary.info || 0,
  };

  async function copyUrl() {
    if (await copyToClipboard(result.url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
          <button
            type="button"
            onClick={copyUrl}
            className="group flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
          <div className="grid grid-cols-1 gap-5 py-4 pl-5 pr-4 sm:py-5 sm:pl-6 sm:pr-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-8">
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
          {result.sslGrade && <SslGradeStat grade={result.sslGrade} />}
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
          {!hideDuration && (
            <Stat
              label="Scan duration"
              value={`${(result.duration / 1000).toFixed(1)}s`}
              icon={Timer}
              tone="muted"
            />
          )}
          <Stat
            label="Scanned"
            value={getRelativeTime(scanDate)}
            icon={Clock}
            tone="muted"
          />
        </div>
      </div>

      {aiSummary && (
        <div className="rounded-md border border-border bg-card px-4 py-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              AI summary
            </p>
            {isLoggedIn && (
              <button
                type="button"
                onClick={() =>
                  askAiChatAbout(buildAskPrompt(result, aiSummary))
                }
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                <MessageCircle aria-hidden className="h-3.5 w-3.5" />
                Ask about this
              </button>
            )}
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">
            {aiSummary}
          </p>
        </div>
      )}
    </div>
  );
}
