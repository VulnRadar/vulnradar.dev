"use client";

import { useEffect, useState } from "react";
import { Globe, Zap, Globe2, ListChecks, X } from "lucide-react";
import { cn } from "@/lib/ui/utils";

type ScanMode = "quick" | "deep" | "bulk";

const SCAN_STEPS = [
  "Connecting to target",
  "Analyzing HTTP security headers",
  "Verifying SSL/TLS certificate",
  "Reviewing cookie security flags",
  "Scanning for mixed content issues",
  "Checking content security policies",
  "Detecting information disclosure",
  "Verifying server configuration",
  "Validating DNS records",
  "Testing email authentication (SPF, DMARC, DKIM)",
  "Analyzing source code patterns (SAST)",
  "Scanning API surface and exposed secrets",
];

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `${minutes}m ${remSeconds}s`;
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface ScanningIndicatorProps {
  url?: string;
  mode?: ScanMode;
  onCancel?: () => void;
}

export function ScanningIndicator({
  url,
  mode = "quick",
  onCancel,
}: ScanningIndicatorProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const stepInterval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % SCAN_STEPS.length);
    }, 1400);
    const tickInterval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 500);
    return () => {
      clearInterval(stepInterval);
      clearInterval(tickInterval);
    };
  }, [startedAt]);

  const modeConfig = {
    quick: { label: "Quick scan", icon: Zap },
    deep: { label: "Deep crawl", icon: Globe2 },
    bulk: { label: "Bulk scan", icon: ListChecks },
  } as const;

  const ModeIcon = modeConfig[mode].icon;
  const stepNumber = activeStep + 1;
  const totalSteps = SCAN_STEPS.length;
  const percent = Math.round((stepNumber / totalSteps) * 100);

  return (
    <div className="flex flex-col items-center gap-6 py-8 sm:py-10 px-4 w-full">
      {/* URL + mode chip row */}
      <div className="flex items-center justify-center gap-2 flex-wrap max-w-xl">
        {url && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-card/50 text-xs">
            <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="font-mono text-foreground truncate max-w-[260px]">
              {getHostname(url)}
            </span>
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 ring-1 ring-primary/20 text-xs text-primary font-medium">
          <ModeIcon className="h-3 w-3" />
          {modeConfig[mode].label}
        </span>
      </div>

      {/* Circular progress + integrated status */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center justify-center w-28 h-28">
          {/* Background ring */}
          <svg
            className="absolute inset-0 -rotate-90"
            viewBox="0 0 100 100"
            aria-hidden
          >
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              className="text-muted/40"
            />
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${(percent / 100) * 276.46} 276.46`}
              className="text-primary transition-all duration-700 ease-out"
            />
          </svg>

          {/* Center content */}
          <div className="relative flex flex-col items-center">
            <span className="text-xl font-bold tabular-nums text-foreground leading-none">
              {percent}%
            </span>
            <span className="text-[10px] text-muted-foreground mt-1 tabular-nums">
              {formatElapsed(elapsed)}
            </span>
          </div>
        </div>

        {/* Current step */}
        <div className="flex flex-col items-center text-center max-w-md gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Step {stepNumber} of {totalSteps}
          </span>
          <p className="text-sm font-semibold text-foreground">
            {SCAN_STEPS[activeStep]}...
          </p>
        </div>
      </div>

      {/* Cancel */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-muted/60"
        >
          <X className="h-3.5 w-3.5" />
          Cancel scan
        </button>
      )}

      {/* Steps timeline */}
      <div className="w-full max-w-md rounded-xl border border-border/50 bg-card/30 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/60 bg-card/40 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Progress
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {stepNumber} / {totalSteps}
          </span>
        </div>
        <div className="p-2 max-h-48 overflow-y-auto">
          {SCAN_STEPS.map((step, i) => {
            const isActive = i === activeStep;
            const isPast = i < activeStep;

            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs transition-all duration-300",
                )}
              >
                <div
                  className={cn(
                    "shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300",
                    isActive && "bg-primary text-primary-foreground scale-110",
                    isPast && "bg-primary/20 text-primary",
                    !isActive && !isPast && "bg-muted/40 text-muted-foreground",
                  )}
                >
                  {isPast ? (
                    <svg
                      className="w-3 h-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <span className="text-[10px] font-bold tabular-nums">
                      {i + 1}
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    "transition-colors duration-300",
                    isActive && "text-foreground font-medium",
                    isPast && "text-muted-foreground",
                    !isActive && !isPast && "text-muted-foreground/60",
                  )}
                >
                  {step}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
