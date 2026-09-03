"use client";

import {
  AlertTriangle,
  CheckCheck,
  HelpCircle,
  Loader2,
  XCircle,
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
import type { Severity, Vulnerability } from "@/lib/scanner/types";

interface AiVerifyResultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True while the /scan/verify request is in flight. */
  loading: boolean;
  /** Set when the request rejects; clears the result view in favour of this message. */
  error: string | null;
  /** The full, updated findings array once the request resolves. Null until then. */
  findings: Vulnerability[] | null;
  /** How many findings had no verdict yet when the check was kicked off, for the loading copy. */
  pendingCount: number;
}

/**
 * Result of the on-demand "Verify with AI" scan action, shown once the
 * /scan/verify call resolves. Styled after ScanSummary's severity-accent
 * card (colored rail + SeverityDistribution) rather than a toast, since a
 * verification pass can surface exploitable findings worth real attention.
 */
export function AiVerifyResultModal({
  open,
  onOpenChange,
  loading,
  error,
  findings,
  pendingCount,
}: AiVerifyResultModalProps) {
  const confirmed = findings?.filter((f) => f.aiVerdict === "confirmed") ?? [];
  const possibleFp =
    findings?.filter((f) => f.aiVerdict === "possible_fp").length ?? 0;
  const uncertain =
    findings?.filter((f) => f.aiVerdict === "uncertain").length ?? 0;
  const skipped = findings?.filter((f) => !f.aiVerdict).length ?? 0;

  const confirmedCounts = SEVERITY_ORDER.reduce(
    (acc, s) => {
      acc[s] = confirmed.filter((f) => f.severity === s).length;
      return acc;
    },
    {} as Record<Severity, number>,
  );
  const worstConfirmed = SEVERITY_ORDER.find((s) => confirmedCounts[s] > 0);

  let railClass = "bg-[hsl(var(--success))]";
  let textClass = "text-[hsl(var(--success))]";
  let headline = "AI didn't confirm any findings";
  let detail =
    possibleFp + uncertain > 0
      ? "Everything checked out as a likely false positive or needs a human to decide."
      : "AI didn't return a verdict for any finding in this scan.";

  if (worstConfirmed === "critical" || worstConfirmed === "high") {
    const tone = SEVERITY_TONE[worstConfirmed];
    railClass = tone.solid;
    textClass = tone.text;
    headline = "AI confirmed exploitable findings";
    detail = `${confirmed.length} ${confirmed.length === 1 ? "finding" : "findings"} held up against a live re-check. Read the ${worstConfirmed} entries first.`;
  } else if (confirmed.length > 0) {
    railClass = SEVERITY_TONE.medium.solid;
    textClass = SEVERITY_TONE.medium.text;
    headline = "AI confirmed findings worth fixing";
    detail = `${confirmed.length} ${confirmed.length === 1 ? "finding" : "findings"} held up against a live re-check, though none are immediately exploitable.`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* variant="shell": the panel clips on both axes (which is what keeps the
          full-bleed severity rail inside the rounded corners) while the body
          band scrolls on its own. The old p-0 + overflow-x-hidden pairing had
          to cancel the padded tier's overflow-y-auto to do the first, so the
          4-up Stat row (three or four rows at 375px) and the skipped-findings
          note past max-h were cut off with no way to reach them. */}
      <DialogContent variant="shell" size="md">
        {loading ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <Loader2
                  aria-hidden
                  className="h-4 w-4 shrink-0 animate-spin text-primary"
                />
                <DialogTitle>
                  Checking findings against the live site
                </DialogTitle>
              </div>
            </DialogHeader>
            <DialogBody>
              <DialogDescription>
                {pendingCount} {pendingCount === 1 ? "finding" : "findings"} get
                re-probed before AI marks each one confirmed, a likely false
                positive, or uncertain. Usually 5 to 30 seconds.
              </DialogDescription>
            </DialogBody>
          </>
        ) : error ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <AlertTriangle
                  className="h-4 w-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <DialogTitle>AI verification failed</DialogTitle>
              </div>
            </DialogHeader>
            <DialogBody>
              <DialogDescription>{error}</DialogDescription>
            </DialogBody>
          </>
        ) : findings ? (
          <>
            {/* The headline is the coloured h2 in the card below, so the header
                band would only repeat it. It stays sr-only to name the dialog. */}
            <DialogHeader className="sr-only">
              <DialogTitle>{headline}</DialogTitle>
              <DialogDescription>{detail}</DialogDescription>
            </DialogHeader>
            <DialogBody className="p-0">
              {/* Mirrors ScanSummary's card anatomy (rail + headline/detail next
                to SeverityDistribution, then a divided stat-bar row) so this
                reads as the same kind of result, not a different component. */}
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
                  {confirmed.length > 0 && (
                    <SeverityDistribution counts={confirmedCounts} />
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-stretch divide-x divide-border border-t border-border bg-muted/30">
                <Stat
                  label="Confirmed"
                  value={String(confirmed.length)}
                  icon={CheckCheck}
                  tone="primary"
                />
                <Stat
                  label="Possible false positive"
                  value={String(possibleFp)}
                  icon={XCircle}
                  tone="muted"
                />
                <Stat
                  label="Needs a human"
                  value={String(uncertain)}
                  icon={HelpCircle}
                  tone="muted"
                />
                {skipped > 0 && (
                  <Stat
                    label="Ran out of time"
                    value={String(skipped)}
                    icon={AlertTriangle}
                    tone="orange"
                  />
                )}
              </div>

              {skipped > 0 && (
                <p className="px-5 py-3 text-xs text-muted-foreground">
                  {skipped} {skipped === 1 ? "finding" : "findings"} ran out of
                  time and stayed unverified. Run Verify with AI again to pick
                  them up.
                </p>
              )}
            </DialogBody>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
