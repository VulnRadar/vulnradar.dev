"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Check,
  Clock,
  ExternalLink,
  Info,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  Gauge,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import type { ScanResult } from "@/lib/scanner/types";
import { cn } from "@/lib/ui/utils";
import { SEVERITY_LEVELS } from "@/lib/config/constants";
import { getSafetyRating } from "@/lib/scanner/safety-rating";

interface ScanSummaryProps {
  result: ScanResult;
  /** Pass true in DashboardResults to hide the URL/copy row (it has its own) */
  hideHeader?: boolean;
}

const severityCards = [
  {
    key: SEVERITY_LEVELS.CRITICAL,
    label: "Critical",
    icon: ShieldX,
    color: "text-red-500",
    bg: "bg-red-500/5",
    border: "border-red-500/10",
    barColor: "bg-red-500",
  },
  {
    key: SEVERITY_LEVELS.HIGH,
    label: "High",
    icon: ShieldAlert,
    color: "text-orange-500",
    bg: "bg-orange-500/5",
    border: "border-orange-500/10",
    barColor: "bg-orange-500",
  },
  {
    key: SEVERITY_LEVELS.MEDIUM,
    label: "Medium",
    icon: TriangleAlert,
    color: "text-yellow-500",
    bg: "bg-yellow-500/5",
    border: "border-yellow-500/10",
    barColor: "bg-yellow-500",
  },
  {
    key: SEVERITY_LEVELS.LOW,
    label: "Low",
    icon: AlertTriangle,
    color: "text-blue-500",
    bg: "bg-blue-500/5",
    border: "border-blue-500/10",
    barColor: "bg-blue-500",
  },
  {
    key: SEVERITY_LEVELS.INFO,
    label: "Info",
    icon: Info,
    color: "text-muted-foreground",
    bg: "bg-muted/30",
    border: "border-border",
    barColor: "bg-muted-foreground",
  },
];

const safetyConfig = {
  safe: {
    fullLabel: "Safe to Visit",
    description:
      "No exploitable vulnerabilities detected. Any findings are hardening recommendations.",
    icon: ShieldCheck,
    iconColor: "text-emerald-500",
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/20",
    textColor: "text-emerald-500",
    pillBg: "bg-emerald-500/10",
  },
  caution: {
    fullLabel: "Visit with Caution",
    description:
      "Potential security concerns detected. Review findings before entering sensitive information.",
    icon: ShieldAlert,
    iconColor: "text-yellow-500",
    bg: "bg-yellow-500/5",
    border: "border-yellow-500/20",
    textColor: "text-yellow-500",
    pillBg: "bg-yellow-500/10",
  },
  unsafe: {
    fullLabel: "Active Threats Detected",
    description:
      "Actively exploitable vulnerabilities found. Avoid entering personal information.",
    icon: ShieldX,
    iconColor: "text-red-500",
    bg: "bg-red-500/5",
    border: "border-red-500/20",
    textColor: "text-red-500",
    pillBg: "bg-red-500/10",
  },
};

function getRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ScanSummary({ result, hideHeader }: ScanSummaryProps) {
  const [copied, setCopied] = useState(false);
  const hasIssues = result.summary.total > 0;
  const scanDate = new Date(result.scannedAt);
  const safetyRating = getSafetyRating(result.findings);
  const config = safetyConfig[safetyRating];
  const SafetyIcon = config.icon;

  function copyUrl() {
    navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* URL + meta header — shown on history/shared/demo pages */}
      {!hideHeader && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <button
            onClick={copyUrl}
            className="group flex items-center gap-2 min-w-0 text-left hover:opacity-80 transition-opacity"
            title="Copy URL"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted shrink-0">
              {copied ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <span className="text-sm font-medium text-foreground truncate">
              {result.url.replace(/^https?:\/\//, "")}
            </span>
          </button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {getRelativeTime(scanDate)}
            </span>
            <span>{(result.duration / 1000).toFixed(1)}s</span>
          </div>
        </div>
      )}

      {/* Verdict card — full width, visually prominent */}
      <div className={cn("rounded-xl border p-4 sm:p-5", config.bg, config.border)}>
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex items-center justify-center w-12 h-12 rounded-xl shrink-0",
              config.pillBg,
            )}
          >
            <SafetyIcon className={cn("h-6 w-6", config.iconColor)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className={cn("text-base font-semibold", config.textColor)}>
                {config.fullLabel}
              </h2>
              <span
                className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded-full",
                  config.pillBg,
                  config.textColor,
                )}
              >
                {result.summary.total}{" "}
                {result.summary.total === 1 ? "issue" : "issues"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              {config.description}
            </p>
          </div>
        </div>

        {/* Meta chips: risk score, confidence, duration, time */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-border/30">
          {result.dangerScore !== undefined && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-background/60 rounded-full px-3 py-1 border border-border/40">
              <Gauge className="h-3 w-3 shrink-0" />
              <span className="font-medium text-foreground">
                {result.dangerScore}/10
              </span>{" "}
              risk
            </span>
          )}
          {result.engineConfidence !== undefined && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-background/60 rounded-full px-3 py-1 border border-border/40">
              <Sparkles className="h-3 w-3 shrink-0" />
              <span className="font-medium text-foreground">
                {result.engineConfidence}%
              </span>{" "}
              confidence
            </span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">
            {(result.duration / 1000).toFixed(1)}s
          </span>
          {hideHeader && (
            <span className="text-xs text-muted-foreground">
              {getRelativeTime(scanDate)}
            </span>
          )}
        </div>
      </div>

      {/* Severity breakdown grid */}
      <div className="grid grid-cols-5 gap-2">
        {severityCards.map(
          ({ key, label, icon: Icon, color, bg, border, barColor }) => {
            const count = result.summary[
              key as keyof typeof result.summary
            ] as number;
            const hasCount = count > 0;
            return (
              <div
                key={key}
                className={cn(
                  "relative flex flex-col items-center gap-1 rounded-xl border p-3 overflow-hidden",
                  hasCount ? bg : "bg-card/50",
                  hasCount ? border : "border-border/50",
                )}
              >
                {hasCount && (
                  <div
                    className={cn(
                      "absolute top-0 left-0 right-0 h-0.5",
                      barColor,
                    )}
                  />
                )}
                <Icon
                  className={cn(
                    "h-4 w-4",
                    hasCount ? color : "text-muted-foreground/40",
                  )}
                />
                <span
                  className={cn(
                    "text-xl font-bold tabular-nums leading-none",
                    hasCount ? "text-foreground" : "text-muted-foreground/40",
                  )}
                >
                  {count}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-medium uppercase tracking-wider",
                    hasCount ? color : "text-muted-foreground/40",
                  )}
                >
                  {label}
                </span>
              </div>
            );
          },
        )}
      </div>

      {/* Issue count summary for non-dashboard pages */}
      {!hideHeader && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl border p-4",
            hasIssues
              ? "bg-orange-500/5 border-orange-500/10"
              : "bg-emerald-500/5 border-emerald-500/10",
          )}
        >
          <div
            className={cn(
              "flex items-center justify-center w-10 h-10 rounded-xl shrink-0",
              hasIssues ? "bg-orange-500/10" : "bg-emerald-500/10",
            )}
          >
            {hasIssues ? (
              <ShieldAlert className="h-5 w-5 text-orange-500" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            )}
          </div>
          <div>
            <p
              className={cn(
                "text-2xl font-bold tabular-nums leading-none",
                hasIssues ? "text-orange-500" : "text-emerald-500",
              )}
            >
              {result.summary.total}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasIssues ? "Issues Found" : "All Clear"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
