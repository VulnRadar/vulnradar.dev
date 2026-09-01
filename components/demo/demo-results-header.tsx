"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, LayoutDashboard, RefreshCw } from "lucide-react";
import { ROUTES } from "@/lib/config/client-constants";
import { useAuth } from "@/components/providers/auth-provider";
import type { ScanResult } from "@/lib/scanner/types";

interface DemoResultsHeaderProps {
  result: ScanResult;
  onScanAgain: () => void;
}

/**
 * The band above the demo's report.
 *
 * It used to open with a headline that restated the verdict ("3 issues worth
 * looking at") and a hand-rolled row of four numbers: elapsed, issues, checks
 * run, findings returned. Both duplicated the ScanSummary card rendered
 * directly beneath by the shared result renderer, which states the verdict in
 * a coloured panel and carries risk score, SSL grade, engine confidence,
 * checks run, duration and scan time as proper stat cells. So the page opened
 * with two verdicts and two stat strips in two different visual languages, one
 * of them bare monospace text, which is what made it read as unfinished beside
 * the real dashboard.
 *
 * What it never showed was the target. Every other result surface prints the
 * scanned URL (dashboard-results, history-detail-header, the /host and /shared
 * reports) because ScanResultDetail passes `hideHeader` to ScanSummary on the
 * assumption that the page supplies one. The demo supplied none, and since the
 * hero started accepting a typed URL, a visitor scanning their own site got a
 * report that never named the host. That is the h1 now.
 */
export function DemoResultsHeader({
  result,
  onScanAgain,
}: DemoResultsHeaderProps) {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;

  const issues = result.findings.filter((f) => f.severity !== "info").length;
  const isPassing = issues === 0;
  const target = result.url.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <section className="border-b border-border/50">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-12 sm:px-6 sm:pt-16">
        <p
          className={`mb-3 font-mono text-xs uppercase tracking-wider ${
            isPassing
              ? "text-[hsl(var(--success))]"
              : "text-[hsl(var(--warning))]"
          }`}
        >
          Scan complete
        </p>

        <h1 className="mb-4 break-all font-mono text-3xl font-semibold tracking-tight sm:text-4xl">
          {target}
        </h1>

        <p className="mb-6 max-w-2xl leading-relaxed text-muted-foreground">
          {isPassing
            ? "Nothing came back on this run. The whole report is below, exactly as the scanner produced it."
            : `The scanner returned ${issues} ${issues === 1 ? "issue" : "issues"} plus whatever it noted for information. Everything it found is below, unfiltered.`}
        </p>

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
