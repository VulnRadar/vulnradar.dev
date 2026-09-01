"use client";

import { AlertTriangle, BotMessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { useModalA11y } from "@/lib/hooks/use-modal-a11y";
import {
  SEVERITY_ORDER,
  SEVERITY_TONE,
} from "@/components/scanner/severity-badge";
import type { Severity, Vulnerability } from "@/lib/scanner/types";

export interface AiSummary {
  confirmed: number;
  possibleFp: number;
  uncertain: number;
  skipped: number;
}

interface AiChoiceModalProps {
  findings: Vulnerability[];
  loading: boolean;
  aiSummary?: AiSummary;
  /** Why verification did not run. Rendered in place of the pitch, with
   *  "View results" as the way out. Without this every failure, including
   *  "you are out of AI credits", just dismissed the dialog, so clicking
   *  Verify and clicking Skip produced an identical screen. */
  error?: string | null;
  onDeepScan: () => void;
  onViewNow: () => void;
}

type DialogProps = ReturnType<typeof useModalA11y>["dialogProps"];

function Shell({
  dialogProps,
  children,
}: {
  dialogProps: DialogProps;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-xs">
      {/* max-h + overflow-y-auto: a centred flex child with neither escapes
          both edges of a short viewport and the flex container does not
          scroll, so on a phone in landscape the two stacked buttons in the
          deep-scan branch were simply off-screen. This modal is the gate
          between a scan finishing and its results being readable, so an
          unreachable button strands the caller. dvh rather than vh because
          100vh on iOS Safari is the large viewport, which is taller than
          what is actually visible. */}
      <div
        {...dialogProps}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-5 shadow-lg sm:p-6"
      >
        {children}
      </div>
    </div>
  );
}

export function AiChoiceModal({
  findings,
  loading,
  aiSummary,
  error,
  onDeepScan,
  onViewNow,
}: AiChoiceModalProps) {
  // This is the gate between a scan finishing and its results being readable,
  // and it declared aria-modal="true" while leaving focus on whatever
  // triggered the scan, trapping nothing and ignoring Escape. The same hook
  // eleven other hand-rolled modals in this codebase already use fixes all
  // three. Escape resolves to "show me the raw findings", which is the
  // non-destructive way out.
  const { dialogProps, titleProps } = useModalA11y({
    open: true,
    onClose: onViewNow,
  });
  const titleId = titleProps.id;
  const total = findings.length;

  // Verified: AI has run and reported back.
  if (aiSummary) {
    const rows = [
      {
        key: "confirmed",
        count: aiSummary.confirmed,
        label: "confirmed against the live site",
        tone: "text-primary",
        rail: "bg-primary",
      },
      {
        key: "possibleFp",
        count: aiSummary.possibleFp,
        label: "look like false positives",
        tone: "text-[hsl(var(--severity-medium))]",
        rail: "bg-[hsl(var(--severity-medium))]",
      },
      {
        key: "uncertain",
        count: aiSummary.uncertain,
        label: "need a human to decide",
        tone: "text-muted-foreground",
        rail: "bg-muted-foreground/50",
      },
    ].filter((r) => r.count > 0);

    return (
      <Shell dialogProps={dialogProps}>
        <h2 id={titleId} className="text-base font-semibold text-foreground">
          AI finished reviewing {total} {total === 1 ? "finding" : "findings"}
        </h2>
        <ul className="my-4 flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.key}
              className="relative flex items-baseline gap-3 pl-3"
            >
              <span
                aria-hidden
                className={cn("absolute inset-y-0 left-0 w-0.5", row.rail)}
              />
              <span
                className={cn(
                  "text-lg font-semibold leading-none tabular-nums",
                  row.tone,
                )}
              >
                {row.count}
              </span>
              <span className="text-sm text-muted-foreground">{row.label}</span>
            </li>
          ))}
        </ul>
        {aiSummary.skipped > 0 && (
          <p className="mb-4 text-xs text-muted-foreground">
            {aiSummary.skipped}{" "}
            {aiSummary.skipped === 1 ? "finding" : "findings"} ran out of time
            and stayed unverified.
          </p>
        )}
        <Button className="h-10 w-full" onClick={onViewNow}>
          View results
        </Button>
      </Shell>
    );
  }

  // Verification was asked for and did not happen. The server's own message
  // is the useful part here: "you are out of AI credits" names both the
  // reason and the remedy, and it used to be discarded.
  if (error) {
    return (
      <Shell dialogProps={dialogProps}>
        <div className="flex items-start gap-3">
          <AlertTriangle
            aria-hidden
            className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
          />
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-semibold text-foreground"
            >
              AI verification did not run
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {error}
            </p>
          </div>
        </div>
        <p className="my-4 text-sm leading-relaxed text-muted-foreground">
          The scan itself finished normally. The {total}{" "}
          {total === 1 ? "finding is" : "findings are"} below, unverified.
        </p>
        <Button className="h-10 w-full" onClick={onViewNow}>
          View results
        </Button>
      </Shell>
    );
  }

  // Verifying
  if (loading) {
    return (
      <Shell dialogProps={dialogProps}>
        <div className="flex items-start gap-3">
          <Loader2
            aria-hidden
            className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary"
          />
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-semibold text-foreground"
            >
              Re-probing the live site
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Each of the {total} {total === 1 ? "finding" : "findings"} gets
              checked against the real response before it is marked confirmed.
              Usually 5 to 30 seconds.
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  // Choice
  const counts = SEVERITY_ORDER.reduce(
    (acc, sev) => {
      acc[sev] = findings.filter((f) => f.severity === sev).length;
      return acc;
    },
    {} as Record<Severity, number>,
  );
  const present = SEVERITY_ORDER.filter(
    (s) => counts[s] > 0 && s !== "info" && s !== "low",
  );

  return (
    <Shell dialogProps={dialogProps}>
      <div className="flex items-start gap-3">
        <BotMessageSquare
          aria-hidden
          className="mt-0.5 h-5 w-5 shrink-0 text-primary"
        />
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            Scan finished with {total} {total === 1 ? "finding" : "findings"}
          </h2>
          {present.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {present.map((sev) => (
                <span
                  key={sev}
                  className={cn("tabular-nums", SEVERITY_TONE[sev].text)}
                >
                  {counts[sev]} {SEVERITY_TONE[sev].label.toLowerCase()}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      <p className="my-4 text-sm leading-relaxed text-muted-foreground">
        AI can re-probe the live site and mark each finding confirmed, likely
        false positive, or unverified. The verdicts save to the report, so this
        only has to happen once.
      </p>

      <div className="flex flex-col gap-2">
        <Button className="h-10 w-full gap-2" onClick={onDeepScan}>
          <BotMessageSquare aria-hidden className="h-4 w-4" />
          Verify with AI
        </Button>
        <Button
          variant="ghost"
          className="h-10 w-full text-muted-foreground hover:text-foreground"
          onClick={onViewNow}
        >
          Skip, show the raw findings
        </Button>
      </div>
    </Shell>
  );
}
