"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Shield,
  Globe,
  Zap,
  Globe2,
  ListChecks,
  X,
} from "lucide-react";
import { TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";

type ScanMode = "quick" | "deep" | "bulk";

const SCAN_STEPS = [
  "Connecting to target...",
  "Checking HTTP security headers...",
  "Analyzing SSL/TLS configuration...",
  "Scanning for mixed content...",
  "Reviewing cookie security...",
  "Checking server information disclosure...",
  "Analyzing content security policies...",
  "Checking CORS configuration...",
  "Scanning for subresource integrity...",
  "Detecting sensitive file references...",
  "Analyzing cache control headers...",
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
    }, 1200);
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

  return (
    <div className="flex flex-col items-center gap-6 py-10 sm:py-12 px-4">
      <p className="text-xs font-medium text-primary uppercase tracking-wider">
        Scanning
      </p>

      {/* URL + mode + cancel row */}
      <div className="flex items-center justify-center gap-2 flex-wrap max-w-xl">
        {url && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-card/50 text-xs">
            <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="font-mono text-foreground truncate max-w-[260px]">
              {getHostname(url)}
            </span>
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary font-medium">
          <ModeIcon className="h-3 w-3" />
          {modeConfig[mode].label}
        </span>
      </div>

      {/* Spinner */}
      <div className="relative">
        <div className="absolute inset-[-8px] rounded-full border-2 border-primary/20 animate-ping" />
        <div className="absolute inset-[-4px] rounded-full border border-primary/10 animate-pulse" />
        <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 border border-primary/20">
          <Shield className="h-7 w-7 text-primary" />
        </div>
      </div>

      {/* Status text */}
      <div className="flex flex-col items-center gap-2 text-center max-w-md">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Scanning in progress
          </h2>
        </div>
        <p className="text-sm text-muted-foreground text-pretty">
          Running {TOTAL_CHECKS_LABEL} different vulnerability checks against
          the target. This usually takes a few seconds.
        </p>
      </div>

      {/* Elapsed + cancel */}
      <div className="flex items-center gap-3 text-xs">
        <span className="font-mono tabular-nums text-muted-foreground">
          Elapsed: {formatElapsed(elapsed)}
        </span>
        {onCancel && (
          <>
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          </>
        )}
      </div>

      {/* Progressive steps */}
      <div className="flex flex-col gap-2 w-full max-w-sm rounded-xl border border-border/50 bg-card/50 p-4">
        {SCAN_STEPS.map((step, i) => {
          const isActive = i === activeStep;
          const isPast = i < activeStep;

          return (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2.5 text-xs transition-all duration-300",
              )}
              style={{ opacity: isActive ? 1 : isPast ? 0.6 : 0.3 }}
            >
              <div
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-300",
                  isActive && "bg-primary scale-125",
                  isPast && "bg-primary/60",
                  !isActive && !isPast && "bg-muted-foreground/30",
                )}
              />
              <span
                className={cn(
                  isActive
                    ? "text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
