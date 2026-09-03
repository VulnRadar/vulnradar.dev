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
  DialogBody,
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
      {/* The shell tier: the panel clips (so the full-bleed rail stays inside
          the rounded corners) and the body below scrolls, which is what keeps
          the wrapped stat row and the two footnote paragraphs reachable on a
          short viewport. */}
      <DialogContent variant="shell" size="md">
        {loading ? (
          // border-b-0: the header band is the only band in this state, so its
          // divider would land a hairline above the panel's own edge.
          <DialogHeader className="border-b-0">
            {/* The repo path is the only unbounded part of this title, so
                it is the part that truncates: an 80-character owner/name
                used to widen the dialog header until it overflowed. */}
            <DialogTitle className="flex min-w-0 items-center gap-1.5">
              <Loader2
                aria-hidden
                className="h-4 w-4 shrink-0 animate-spin text-primary"
              />
              <span className="shrink-0">Scanning</span>
              <span className="truncate" title={repoFullName ?? undefined}>
                {repoFullName}
              </span>
            </DialogTitle>
            <DialogDescription>
              Running pattern-based secret detection and an AI code review over
              the repo&apos;s source. Larger repos can take up to a minute.
            </DialogDescription>
          </DialogHeader>
        ) : error ? (
          <DialogHeader className="border-b-0">
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className="h-5 w-5 text-destructive"
                aria-hidden="true"
              />
              Scan failed
            </DialogTitle>
            <DialogDescription>{error}</DialogDescription>
          </DialogHeader>
        ) : outcome ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{headline}</DialogTitle>
              <DialogDescription>{detail}</DialogDescription>
            </DialogHeader>
            {/* p-0: this body is full-bleed by design (the severity rail runs
                to the panel edge and the stat row is ruled off edge to edge),
                so the band's own padding would inset all of it. */}
            <DialogBody className="p-0">
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

              {/* Two separate caveats. Stacked bare they ran together as one
                paragraph whenever both fired, so they are ruled off from the
                stat row and from each other. */}
              {(outcome.aiReviewSkipped || outcome.filesSkippedByCaps > 0) && (
                <div className="divide-y divide-border border-t border-border">
                  {outcome.aiReviewSkipped && (
                    <p className="px-6 py-3 text-xs text-muted-foreground">
                      AI review didn&apos;t run for this scan: no AI endpoint is
                      configured (yours or VulnRadar&apos;s). Pattern-based
                      secret detection still ran fully.
                    </p>
                  )}
                  {outcome.filesSkippedByCaps > 0 && (
                    <p className="px-6 py-3 text-xs text-muted-foreground">
                      {outcome.filesSkippedByCaps} file
                      {outcome.filesSkippedByCaps === 1 ? "" : "s"} skipped to
                      stay within the scan size limit.
                    </p>
                  )}
                </div>
              )}
            </DialogBody>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
