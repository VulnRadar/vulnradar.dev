"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock,
  Copy,
  KeyRound,
  RotateCcw,
  ServerCrash,
  ShieldOff,
  ShieldX,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { BILLING_ENABLED, ROUTES, SUPPORT_EMAIL } from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";

interface DashboardErrorStateProps {
  error: string;
  details?: string;
  url?: string;
  status?: number;
  onRetry: () => void;
  /**
   * Skips the heuristic classifier below for cases the caller already knows
   * the exact kind of, such as a structured 422 from an authenticated scan.
   */
  forcedKind?: ErrorKind;
}

export type ErrorKind =
  | "blocked"
  | "network"
  | "rate_limit"
  | "validation"
  | "server"
  | "auth_failed"
  | "generic";

function classifyError(error: string, status?: number): ErrorKind {
  const e = error.toLowerCase();
  if (
    e.includes("cannot be scanned") ||
    e.includes("blocked") ||
    e.includes("not allowed") ||
    e.includes("private") ||
    e.includes("loopback")
  ) {
    return "blocked";
  }
  if (
    e.includes("failed to connect") ||
    e.includes("network") ||
    e.includes("timeout") ||
    e.includes("econnrefused") ||
    e.includes("enotfound") ||
    e.includes("etimedout")
  ) {
    return "network";
  }
  if (status === 429 || e.includes("rate limit") || e.includes("too many")) {
    return "rate_limit";
  }
  if (
    e.includes("invalid") ||
    e.includes("valid domain") ||
    e.includes("please enter") ||
    status === 400
  ) {
    return "validation";
  }
  if (status !== undefined && status >= 500) {
    return "server";
  }
  return "generic";
}

const ERROR_META: Record<
  ErrorKind,
  {
    title: string;
    /** What happened, then what to do about it. */
    description: string;
    icon: typeof ShieldX;
    rail: string;
    accent: string;
  }
> = {
  blocked: {
    title: "That target is off limits",
    description:
      "The URL resolves to private, loopback or otherwise reserved address space. Scanning it would hit infrastructure the scanner is not allowed to reach. Point it at a publicly resolvable hostname instead.",
    icon: ShieldOff,
    rail: "bg-[hsl(var(--severity-medium))]",
    accent: "text-[hsl(var(--severity-medium))]",
  },
  network: {
    title: "The target never answered",
    description:
      "No TCP connection, so nothing could be checked. The host may be down, behind a firewall, or dropping requests it does not recognise. Confirm it loads in a browser, then run the scan again.",
    icon: WifiOff,
    rail: "bg-destructive",
    accent: "text-destructive",
  },
  rate_limit: {
    title: "You have used up this window's scans",
    description: BILLING_ENABLED
      ? "The daily scan limit for your plan is spent. It resets on a rolling window, so waiting works. A higher plan raises the cap if you need it sooner."
      : "The scan rate limit for this deployment is spent. It resets on a rolling window, so waiting a few minutes is enough.",
    icon: Clock,
    rail: "bg-primary",
    accent: "text-primary",
  },
  validation: {
    title: "The scanner rejected that input",
    description:
      "The URL or the scan options did not pass validation. Drop the scheme and any trailing path, so example.com rather than https://example.com/page?a=1, and try again.",
    icon: AlertCircle,
    rail: "bg-[hsl(var(--severity-medium))]",
    accent: "text-[hsl(var(--severity-medium))]",
  },
  server: {
    title: "The scanner broke, not your target",
    description:
      "Something failed server-side partway through the run. The error is logged with the reference below. Retrying usually works, since these are almost always transient.",
    icon: ServerCrash,
    rail: "bg-destructive",
    accent: "text-destructive",
  },
  auth_failed: {
    title: "Login failed before the scan ran",
    description:
      "The login could not sign in, so nothing was scanned. Nothing partial was saved. Check the login details and try again.",
    icon: KeyRound,
    rail: "bg-[hsl(var(--severity-medium))]",
    accent: "text-[hsl(var(--severity-medium))]",
  },
  generic: {
    title: "The scan did not finish",
    description:
      "The run stopped before results could be assembled. The scanner's own message is below and usually names the cause.",
    icon: ShieldX,
    rail: "bg-destructive",
    accent: "text-destructive",
  },
};

export function DashboardErrorState({
  error,
  details,
  url,
  status,
  onRetry,
  forcedKind,
}: DashboardErrorStateProps) {
  const [copied, setCopied] = useState(false);
  const kind = forcedKind ?? classifyError(error, status);
  const meta = ERROR_META[kind];
  const Icon = meta.icon;

  function copyDetails() {
    const text = [
      `Error: ${error}`,
      url ? `URL: ${url}` : null,
      status ? `Status: ${status}` : null,
      details ? `\nDetails:\n${details}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="pt-8">
      <div className="relative overflow-hidden rounded-md border border-border bg-card">
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-1", meta.rail)}
        />
        <div className="flex flex-col gap-4 py-5 pl-5 pr-4 sm:pl-6 sm:pr-5">
          <div className="flex items-start gap-3">
            <Icon
              aria-hidden
              className={cn("mt-0.5 h-5 w-5 shrink-0", meta.accent)}
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-foreground">
                {meta.title}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {meta.description}
              </p>
            </div>
          </div>

          {/* Target line */}
          {url && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-muted/40 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {url}
              </span>
              {status !== undefined && (
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
                    status >= 500
                      ? "bg-destructive/10 text-destructive"
                      : status >= 400
                        ? "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))]"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  HTTP {status}
                </span>
              )}
            </div>
          )}

          {/* Raw message from the scanner */}
          <div className="overflow-hidden rounded border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Scanner output
              </span>
              <button
                type="button"
                onClick={copyDetails}
                aria-label="Copy error details"
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                  copied
                    ? "text-[hsl(var(--success))]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {copied ? (
                  <>
                    <Check aria-hidden className="h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy aria-hidden className="h-3 w-3" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <p className="break-words px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
              {error}
            </p>
            {details && (
              <details className="group border-t border-border">
                <summary className="flex cursor-pointer list-none select-none items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
                  <span
                    aria-hidden
                    className="inline-block transition-transform group-open:rotate-90"
                  >
                    &rsaquo;
                  </span>
                  Stack and request details
                </summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                  {details}
                </pre>
              </details>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onRetry} className="h-9 gap-2">
              <RotateCcw aria-hidden className="h-4 w-4" />
              Try again
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-9 gap-2 border-border/60 bg-muted/40"
            >
              <Link href={ROUTES.DASHBOARD}>
                <ArrowLeft aria-hidden className="h-4 w-4" />
                Back to scanner
              </Link>
            </Button>
            {(kind === "blocked" || kind === "server") && (
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="ml-auto rounded text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Think this is wrong? Mail {SUPPORT_EMAIL}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
