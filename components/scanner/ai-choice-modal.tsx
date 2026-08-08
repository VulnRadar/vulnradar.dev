"use client";

import { useId } from "react";
import { BotMessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
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
  onDeepScan: () => void;
  onViewNow: () => void;
}

function Shell({
  titleId,
  children,
}: {
  titleId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-md border border-border bg-card p-5 shadow-lg sm:p-6"
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
  onDeepScan,
  onViewNow,
}: AiChoiceModalProps) {
  const titleId = useId();
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
      <Shell titleId={titleId}>
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

  // Verifying
  if (loading) {
    return (
      <Shell titleId={titleId}>
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
    <Shell titleId={titleId}>
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
