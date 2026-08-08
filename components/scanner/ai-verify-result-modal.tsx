"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import {
  SEVERITY_ORDER,
  SEVERITY_TONE,
  SeverityDistribution,
} from "@/components/scanner/severity-badge";
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

  const rows = [
    {
      key: "confirmed",
      count: confirmed.length,
      label: "confirmed against the live site",
      tone: "text-primary",
      rail: "bg-primary",
    },
    {
      key: "possibleFp",
      count: possibleFp,
      label: "look like false positives",
      tone: "text-[hsl(var(--severity-medium))]",
      rail: "bg-[hsl(var(--severity-medium))]",
    },
    {
      key: "uncertain",
      count: uncertain,
      label: "need a human to decide",
      tone: "text-muted-foreground",
      rail: "bg-muted-foreground/50",
    },
  ].filter((r) => r.count > 0);

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
    rows.length > 0
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!loading) onOpenChange(next);
      }}
    >
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        {loading ? (
          <div className="flex items-start gap-3 p-6">
            <Loader2
              aria-hidden
              className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary"
            />
            <DialogHeader className="min-w-0 text-left">
              <DialogTitle>Checking findings against the live site</DialogTitle>
              <DialogDescription>
                {pendingCount} {pendingCount === 1 ? "finding" : "findings"}{" "}
                get re-probed before AI marks each one confirmed, a likely
                false positive, or uncertain. Usually 5 to 30 seconds.
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
                AI verification failed
              </DialogTitle>
              <DialogDescription>{error}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : findings ? (
          <>
            <div className="relative">
              <span
                aria-hidden
                className={cn("absolute inset-y-0 left-0 w-1", railClass)}
              />
              <div className="p-6 pl-7">
                <DialogHeader className="text-left">
                  <DialogTitle className={textClass}>{headline}</DialogTitle>
                  <DialogDescription>{detail}</DialogDescription>
                </DialogHeader>

                {confirmed.length > 0 && (
                  <SeverityDistribution
                    counts={confirmedCounts}
                    className="mt-4"
                  />
                )}

                {rows.length > 0 && (
                  <ul className="mt-4 flex flex-col gap-2">
                    {rows.map((row) => (
                      <li
                        key={row.key}
                        className="relative flex items-baseline gap-3 pl-3"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "absolute inset-y-0 left-0 w-0.5",
                            row.rail,
                          )}
                        />
                        <span
                          className={cn(
                            "text-lg font-semibold leading-none tabular-nums",
                            row.tone,
                          )}
                        >
                          {row.count}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {row.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {skipped > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {skipped} {skipped === 1 ? "finding" : "findings"} ran out
                    of time and stayed unverified. Run Verify with AI again to
                    pick them up.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter className="px-6 pb-6">
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
