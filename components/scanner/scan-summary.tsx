"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  ScanSearch,
  Check,
} from "lucide-react";
import { useState } from "react";
import type { ScanResult } from "@/lib/scanner/types";
import { cn } from "@/lib/ui/utils";
import { SEVERITY_LEVELS, TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { getSafetyRating } from "@/lib/scanner/safety-rating";

interface ScanSummaryProps {
  result: ScanResult;
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

export function ScanSummary({ result }: ScanSummaryProps) {
  const [copied, setCopied] = useState(false);
  const hasIssues = result.summary.total > 0;
  const scanDate = new Date(result.scannedAt);
  const safetyRating = getSafetyRating(result.findings);

  const safetyConfig = {
    safe: {
      label: "Safe",
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
      label: "Caution",
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
      label: "Unsafe",
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

  const config = safetyConfig[safetyRating];
  const SafetyIcon = config.icon;

  function copyUrl() {
    navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Format relative time
  function getRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Main Summary Card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header with URL and meta */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={copyUrl}
              className="group flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
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
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {getRelativeTime(scanDate)}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5">
              {(result.duration / 1000).toFixed(1)}s
            </span>
          </div>
        </div>

        {/* Safety Rating + Issue Count */}
        <div className="flex flex-col sm:flex-row gap-4 p-4">
          {/* Safety Rating */}
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border p-4 flex-1",
              config.bg,
              config.border,
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center w-12 h-12 rounded-xl shrink-0",
                config.pillBg,
              )}
            >
              <SafetyIcon className={cn("h-6 w-6", config.iconColor)} />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn("text-sm font-semibold", config.textColor)}>
                  {config.fullLabel}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {config.description}
              </p>
            </div>
          </div>

          {/* Issue Count */}
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border p-4 sm:w-48 shrink-0",
              hasIssues
                ? "bg-orange-500/5 border-orange-500/10"
                : "bg-emerald-500/5 border-emerald-500/10",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center w-12 h-12 rounded-xl shrink-0",
                hasIssues ? "bg-orange-500/10" : "bg-emerald-500/10",
              )}
            >
              {hasIssues ? (
                <ShieldAlert className="h-6 w-6 text-orange-500" />
              ) : (
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <span
                className={cn(
                  "text-2xl font-bold tabular-nums",
                  hasIssues ? "text-orange-500" : "text-emerald-500",
                )}
              >
                {result.summary.total}
              </span>
              <span className="text-xs text-muted-foreground">
                {hasIssues ? "Issues Found" : "All Clear"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Severity Breakdown */}
      <div className="grid grid-cols-5 gap-2">
        {severityCards.map(
          ({ key, label, icon: Icon, color, bg, border, barColor }) => {
            const count = result.summary[key];
            const hasCount = count > 0;
            return (
              <div
                key={key}
                className={cn(
                  "relative flex flex-col items-center gap-1 rounded-xl border p-3 transition-all overflow-hidden",
                  hasCount ? bg : "bg-card/50",
                  hasCount ? border : "border-border/50",
                  hasCount && "ring-1 ring-inset ring-white/5",
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
                    hasCount ? color : "text-muted-foreground/50",
                  )}
                />
                <span
                  className={cn(
                    "text-xl font-bold tabular-nums leading-none",
                    hasCount ? "text-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {count}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-medium uppercase tracking-wider",
                    hasCount ? color : "text-muted-foreground/50",
                  )}
                >
                  {label}
                </span>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}
