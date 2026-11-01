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
import { InlineAlert } from "@/components/shared/inline-alert";
import { pluralize } from "@/lib/ui/plural";
import type { Severity } from "@/lib/scanner/types";
import { aiReviewNotice, aiReviewStatValue } from "./scan-outcome";
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
 * says how far it got, instead of the page just going quiet while the
 * request is in flight.
 *
 * A repo too large for the account's AI allowance or the server's per-run
 * limit is partly AI-reviewed rather than refused. Whenever the AI review did
 * not cover every file, the notice above the findings says how much it did
 * and that the pattern scan covered all of it: a partial review that read
 * like a complete one would be worse than no review.
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
  const notice = outcome ? aiReviewNotice(outcome) : null;
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
  let detail = notice
    ? "Pattern-based secret detection found nothing, and the AI review did not cover every file."
    : "Pattern-based secret detection and AI code review both ran clean.";

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
        {/* The dialog stays open from "Scanning" to the result, which can
            take a minute, and swaps its whole body; this says when it ends. */}
        <span role="status" aria-live="polite" className="sr-only">
          {loading
            ? ""
            : error
              ? "The scan failed."
              : outcome
                ? notice
                  ? `The scan finished. ${notice.title}.`
                  : "The scan finished."
                : ""}
        </span>
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
              {/* First, above the findings: what they do not cover. The
                  status line above already announces it, so the alert itself
                  carries no live role. */}
              {notice && (
                <div className="px-4 pt-4 sm:px-5">
                  <InlineAlert tone="warning" title={notice.title} live="off">
                    {notice.paragraphs.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                  </InlineAlert>
                </div>
              )}
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
                  value={aiReviewStatValue(outcome, notice)}
                  icon={Sparkles}
                  tone={notice ? "orange" : "primary"}
                />
              </div>

              {/* The AI review caveat that used to sit here is the notice
                above the findings now; this one stays a footnote, ruled off
                from the stat row. */}
              {outcome.filesSkippedByCaps > 0 && (
                <p className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
                  {pluralize(outcome.filesSkippedByCaps, "file")} skipped to
                  stay within the scan size limit.
                </p>
              )}
            </DialogBody>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
