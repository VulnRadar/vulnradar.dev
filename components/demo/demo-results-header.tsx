"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  LayoutDashboard,
} from "lucide-react";
import { ROUTES, APP_NAME } from "@/lib/config/constants";
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

  const failedChecks = result.findings.filter(
    (f) => f.severity !== "info",
  ).length;
  const isPassing = failedChecks === 0;

  return (
    <section className="relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-8 sm:pt-16">
        <div className="text-center max-w-2xl mx-auto">
          <Badge
            variant="outline"
            className={`mb-5 gap-1.5 py-1 px-3 text-xs ${
              isPassing
                ? "border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400"
                : "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
            }`}
          >
            {isPassing ? (
              <CheckCircle className="h-3 w-3" />
            ) : (
              <AlertTriangle className="h-3 w-3" />
            )}
            {isPassing
              ? "All checks passed"
              : `${failedChecks} issue${failedChecks > 1 ? "s" : ""} found`}
          </Badge>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4 text-balance">
            {isPassing ? "Looking good!" : "Issues detected"}
          </h1>

          <p className="text-base text-muted-foreground mb-6">
            {APP_NAME} completed {result.findings.length} checks in{" "}
            {(result.duration / 1000).toFixed(1)}s
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
            <div className="flex items-center gap-4 px-4 py-2 rounded-lg bg-muted/50 border border-border/50 text-sm">
              <div className="flex items-center gap-1.5">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="font-medium">
                  {result.findings.length - failedChecks}
                </span>
                <span className="text-muted-foreground">passed</span>
              </div>
              <div className="w-px h-4 bg-border" />
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="font-medium">{failedChecks}</span>
                <span className="text-muted-foreground">issues</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button variant="outline" onClick={onScanAgain} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Scan Again
            </Button>
            {isLoggedIn ? (
              <Link href={ROUTES.DASHBOARD}>
                <Button className="gap-2">
                  <LayoutDashboard className="h-4 w-4" />
                  Go to Dashboard
                </Button>
              </Link>
            ) : (
              <Link href={ROUTES.SIGNUP}>
                <Button className="gap-2">
                  Create Free Account
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
