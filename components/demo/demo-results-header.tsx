"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, LayoutDashboard, RefreshCw } from "lucide-react";
import { ROUTES } from "@/lib/config/constants";
import { useAuth } from "@/components/providers/auth-provider";
import type { ScanResult } from "@/lib/scanner/types";

interface DemoResultsHeaderProps {
  result: ScanResult;
  onScanAgain: () => void;
}

export function DemoResultsHeader({
  result,
  onScanAgain,
}: DemoResultsHeaderProps) {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;

  const issues = result.findings.filter((f) => f.severity !== "info").length;
  const isPassing = issues === 0;
  const seconds = (result.duration / 1000).toFixed(1);

  const stats: [string, string][] = [
    [`${seconds}s`, "elapsed"],
    [String(issues), issues === 1 ? "issue" : "issues"],
    ...(result.checksRun
      ? ([[result.checksRun.toLocaleString(), "checks run"]] as [
          string,
          string,
        ][])
      : []),
    [String(result.findings.length), "findings returned"],
  ];

  return (
    <section className="border-b border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-8 sm:pt-16">
        <p
          className={`font-mono text-xs uppercase tracking-wider mb-3 ${
            isPassing
              ? "text-[hsl(var(--success))]"
              : "text-[hsl(var(--warning))]"
          }`}
        >
          Scan complete
        </p>

        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-5 text-balance">
          {isPassing
            ? "Nothing to fix on this run"
            : `${issues} ${issues === 1 ? "issue" : "issues"} worth looking at`}
        </h1>

        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-y border-border/50 py-4 mb-6">
          {stats.map(([value, label]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <dt className="sr-only">{label}</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">
                {value}
              </dd>
              <span
                aria-hidden="true"
                className="text-sm text-muted-foreground"
              >
                {label}
              </span>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={onScanAgain} className="gap-2">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Run scan again
          </Button>
          {isLoggedIn ? (
            <Link href={ROUTES.DASHBOARD}>
              <Button className="gap-2">
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                Go to Dashboard
              </Button>
            </Link>
          ) : (
            <Link href={ROUTES.SIGNUP}>
              <Button className="gap-2">
                Scan your own site
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
