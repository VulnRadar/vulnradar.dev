import { useState } from "react";
import {
  ShieldX,
  RotateCcw,
  Mail,
  Globe,
  Copy,
  Check,
  WifiOff,
  ShieldOff,
  Clock,
  ServerCrash,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ROUTES } from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";

interface DashboardErrorStateProps {
  error: string;
  details?: string;
  url?: string;
  status?: number;
  onRetry: () => void;
}

type ErrorKind =
  | "blocked"
  | "network"
  | "rate_limit"
  | "validation"
  | "server"
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
    description: string;
    icon: typeof ShieldX;
    bg: string;
    fg: string;
    ring: string;
  }
> = {
  blocked: {
    title: "Target restricted",
    description:
      "We can't scan this URL. It points to private infrastructure, the loopback range, or is otherwise blocked by policy.",
    icon: ShieldOff,
    bg: "bg-amber-500/10",
    fg: "text-amber-500",
    ring: "border-amber-500/20",
  },
  network: {
    title: "Couldn't reach the target",
    description:
      "The scanner couldn't establish a connection. The URL may be down, behind a firewall, or blocking automated requests.",
    icon: WifiOff,
    bg: "bg-orange-500/10",
    fg: "text-orange-500",
    ring: "border-orange-500/20",
  },
  rate_limit: {
    title: "Rate limit hit",
    description:
      "You've reached your plan's daily scan limit. Try again later, or upgrade for a higher cap.",
    icon: Clock,
    bg: "bg-violet-500/10",
    fg: "text-violet-500",
    ring: "border-violet-500/20",
  },
  validation: {
    title: "Invalid input",
    description:
      "The URL or scan options weren't accepted. Check the format and try again.",
    icon: AlertCircle,
    bg: "bg-yellow-500/10",
    fg: "text-yellow-500",
    ring: "border-yellow-500/20",
  },
  server: {
    title: "Scanner error",
    description:
      "The scanner ran into an unexpected server-side problem. We've been notified. Try again in a moment.",
    icon: ServerCrash,
    bg: "bg-destructive/10",
    fg: "text-destructive",
    ring: "border-destructive/20",
  },
  generic: {
    title: "Scan failed",
    description:
      "Something went wrong while scanning. The details below may help diagnose the issue.",
    icon: ShieldX,
    bg: "bg-destructive/10",
    fg: "text-destructive",
    ring: "border-destructive/20",
  },
};

export function DashboardErrorState({
  error,
  details,
  url,
  status,
  onRetry,
}: DashboardErrorStateProps) {
  const [copied, setCopied] = useState(false);
  const kind = classifyError(error, status);
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
    <div className="flex flex-col items-center gap-6 py-10 sm:py-14 px-4 text-center">
      <p className="text-xs font-medium text-primary uppercase tracking-wider">
        Scan
      </p>

      <div
        className={cn(
          "flex items-center justify-center w-14 h-14 rounded-2xl border",
          meta.bg,
          meta.ring,
        )}
      >
        <Icon className={cn("h-7 w-7", meta.fg)} />
      </div>

      <div className="flex flex-col items-center gap-2 max-w-md">
        <h2 className="text-xl font-semibold text-foreground tracking-tight text-balance">
          {meta.title}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          {meta.description}
        </p>
      </div>

      {url && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-card/50 text-xs max-w-md">
          <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-mono text-foreground truncate">{url}</span>
          {status !== undefined && (
            <span
              className={cn(
                "ml-auto px-1.5 py-0.5 rounded font-mono tabular-nums text-[10px]",
                status >= 500
                  ? "bg-destructive/10 text-destructive"
                  : status >= 400
                    ? "bg-amber-500/10 text-amber-500"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {status}
            </span>
          )}
        </div>
      )}

      {/* Original error message from the API */}
      <div className="w-full max-w-md p-3.5 rounded-xl border border-border/50 bg-card/50 text-left">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            From the scanner
          </span>
          <button
            type="button"
            onClick={copyDetails}
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors shrink-0",
              copied
                ? "bg-emerald-500/10 text-emerald-500"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
            aria-label="Copy error details"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        </div>
        <p className="text-sm text-foreground leading-relaxed break-words">
          {error}
        </p>
        {details && (
          <details className="mt-2 group">
            <summary className="text-[10px] font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none list-none flex items-center gap-1">
              <span className="inline-block transition-transform group-open:rotate-90">
                ›
              </span>
              Show technical details
            </summary>
            <pre className="mt-2 p-2.5 rounded-md bg-muted/40 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-words">
              {details}
            </pre>
          </details>
        )}
      </div>

      {kind === "blocked" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mail className="h-3.5 w-3.5 shrink-0" />
          <span>
            Questions? Contact{" "}
            <Link
              href="mailto:support@vulnradar.dev"
              className="text-primary hover:underline"
            >
              support@vulnradar.dev
            </Link>
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onRetry} className="bg-transparent">
          <RotateCcw className="mr-2 h-4 w-4" />
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link href={ROUTES.DASHBOARD}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
