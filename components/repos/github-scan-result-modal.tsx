"use client";

import {
  AlertTriangle,
  FileCode2,
  GitBranch,
  Loader2,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/ui/utils";
import {
  SEVERITY_ORDER,
  SEVERITY_TONE,
  SeverityDistribution,
} from "@/components/scanner/severity-badge";
import { Stat } from "@/components/scanner/scan-summary";
import type { Severity } from "@/lib/scanner/types";
import type { GithubScanOutcome } from "./types";

interface GithubScanResultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True while POST /api/v3/scan/github is in flight. */
  loading: boolean;
  /** Full name of the repo being scanned, for the loading copy. */
  repoFullName: string | null;
  /** Set when the request rejects; clears the result view in favour of this message. */
  error: string | null;
  /** Set once the request resolves successfully. */
  outcome: GithubScanOutcome | null;
}

/**
 * Shown for the whole lifetime of a repo scan (loading -> error/result),
 * styled after AiVerifyResultModal's anatomy (rail + headline/detail next to
 * SeverityDistribution, then a divided stat-bar row) so a repo scan reads as
 * the same kind of result as any other AI-backed action in this app. The
 * "AI review" stat exists specifically so it's never ambiguous whether the
 * AI code review pass actually ran -- it either shows real token usage or
 * says "Skipped" with why, instead of the page just going quiet while the
 * request is in flight.
 */
export function GithubScanResultModal({
  open,
  onOpenChange,
  loading,
  repoFullName,
  error,
  outcome,
}: GithubScanResultModalProps) {
  const findings = outcome?.result.findings ?? [];
  const counts = SEVERITY_ORDER.reduce(
    (acc, s) => {
      acc[s] = findings.filter((f) => f.severity === s).length;
      return acc;
    },
    {} as Record<Severity, number>,
  );
  const worst = SEVERITY_ORDER.find((s) => counts[s] > 0);

  let railClass = "bg-[hsl(var(--success))]";
  let textClass = "text-[hsl(var(--success))]";
  let headline = "No issues found";
  let detail =
    "Pattern-based secret detection and AI code review both ran clean.";

  if (worst === "critical" || worst === "high") {
    const tone = SEVERITY_TONE[worst];
    railClass = tone.solid;
    textClass = tone.text;
    headline = `${findings.length} ${findings.length === 1 ? "finding" : "findings"}`;
    detail = `Read the ${worst} entries first.`;
  } else if (worst) {
    railClass = SEVERITY_TONE.medium.solid;
    textClass = SEVERITY_TONE.medium.text;
    headline = `${findings.length} ${findings.length === 1 ? "finding" : "findings"}`;
    detail = "Nothing immediately exploitable, but worth a look.";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        {loading ? (
          <div className="flex items-start gap-3 p-6">
            <Loader2
              aria-hidden
              className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary"
            />
            <DialogHeader className="min-w-0 text-left">
              <DialogTitle>Scanning {repoFullName}</DialogTitle>
              <DialogDescription>
                Running pattern-based secret detection and an AI code review
                over the repo&apos;s source. Larger repos can take up to a
                minute.
              </DialogDescription>
            </DialogHeader>
          </div>
        ) : error ? (
          <div className="p-6">
            <DialogHeader className="text-left">
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle
                  className="h-5 w-5 text-destructive"
                  aria-hidden="true"
                />
                Scan failed
              </DialogTitle>
              <DialogDescription>{error}</DialogDescription>
            </DialogHeader>
          </div>
        ) : outcome ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{headline}</DialogTitle>
              <DialogDescription>{detail}</DialogDescription>
            </DialogHeader>
            {/* Mirrors AiVerifyResultModal's card anatomy so this reads as
                the same kind of result, not a different component. */}
            <div className="relative">
              <span
                aria-hidden
                className={cn("absolute inset-y-0 left-0 w-1", railClass)}
              />
              <div className="grid grid-cols-1 gap-5 py-4 pl-5 pr-4 sm:py-5 sm:pl-6 sm:pr-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6">
                <div className="flex flex-col gap-1.5">
                  <h2
                    className={cn(
                      "text-base font-semibold leading-tight sm:text-lg",
                      textClass,
                    )}
                  >
                    {headline}
                  </h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {detail}
                  </p>
                </div>
                {findings.length > 0 && (
                  <SeverityDistribution counts={counts} />
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-stretch divide-x divide-border border-t border-border bg-muted/30">
              <Stat
                label="Files scanned"
                value={String(outcome.filesScanned)}
                icon={FileCode2}
                tone="muted"
              />
              <Stat
                label="Branch"
                value={outcome.ref || "default"}
                icon={GitBranch}
                tone="muted"
              />
              <Stat
                label="AI review"
                value={
                  outcome.aiReviewSkipped
                    ? "Skipped"
                    : `${outcome.aiTokensUsed.toLocaleString()} tokens`
                }
                icon={Sparkles}
                tone={outcome.aiReviewSkipped ? "orange" : "primary"}
              />
            </div>

            {outcome.aiReviewSkipped && (
              <p className="px-6 py-3 text-xs text-muted-foreground">
                AI review didn&apos;t run for this scan: no AI endpoint is
                configured (yours or VulnRadar&apos;s). Pattern-based secret
                detection still ran fully.
              </p>
            )}
            {outcome.filesSkippedByCaps > 0 && (
              <p className="px-6 py-3 text-xs text-muted-foreground">
                {outcome.filesSkippedByCaps} file
                {outcome.filesSkippedByCaps === 1 ? "" : "s"} skipped to stay
                within the scan size limit.
              </p>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
