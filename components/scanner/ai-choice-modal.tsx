"use client";

import {
  BotMessageSquare,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Vulnerability } from "@/lib/scanner/types";
import { cn } from "@/lib/ui/utils";

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

export function AiChoiceModal({
  findings,
  loading,
  aiSummary,
  onDeepScan,
  onViewNow,
}: AiChoiceModalProps) {
  const total = findings.length;

  // Done state — AI finished, show what it found
  if (aiSummary) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="w-full max-w-sm mx-4 rounded-2xl border border-border bg-card p-6 shadow-2xl">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 rounded-xl bg-primary/10 shrink-0">
              <BotMessageSquare className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                AI scan complete
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {total} {total === 1 ? "finding" : "findings"} reviewed
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 mb-5">
            {aiSummary.confirmed > 0 && (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">
                    {aiSummary.confirmed} confirmed
                  </span>
                  <span className="text-xs text-muted-foreground ml-1.5">
                    real security issue
                  </span>
                </div>
              </div>
            )}
            {aiSummary.possibleFp > 0 && (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-orange-500/5 border border-orange-500/15">
                <AlertCircle className="h-4 w-4 text-orange-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">
                    {aiSummary.possibleFp} possible false{" "}
                    {aiSummary.possibleFp === 1 ? "positive" : "positives"}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1.5">
                    may not apply
                  </span>
                </div>
              </div>
            )}
            {aiSummary.uncertain > 0 && (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-muted/40 border border-border">
                <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">
                    {aiSummary.uncertain} uncertain
                  </span>
                  <span className="text-xs text-muted-foreground ml-1.5">
                    needs manual review
                  </span>
                </div>
              </div>
            )}
            {aiSummary.skipped > 0 && (
              <p className="text-xs text-muted-foreground px-1">
                {aiSummary.skipped}{" "}
                {aiSummary.skipped === 1 ? "finding" : "findings"} not reviewed
                (timed out)
              </p>
            )}
          </div>

          <Button className="w-full h-10" onClick={onViewNow}>
            View results
          </Button>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="w-full max-w-sm mx-4 rounded-2xl border border-border bg-card p-6 shadow-2xl">
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="relative">
              <div className="p-3 rounded-2xl bg-primary/10">
                <BotMessageSquare className="h-6 w-6 text-primary" />
              </div>
              <Loader2 className="absolute -bottom-1 -right-1 h-4 w-4 text-primary animate-spin bg-card rounded-full" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">
                AI is analyzing your scan
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Probing {total} {total === 1 ? "finding" : "findings"} against
                the live site. Takes 5-30 seconds.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Choice state
  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;

  const severityLine = [
    critical > 0 && `${critical} critical`,
    high > 0 && `${high} high`,
    medium > 0 && `${medium} medium`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-xl bg-primary/10 shrink-0 mt-0.5">
            <BotMessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              Scan complete
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {total} {total === 1 ? "finding" : "findings"}
              {severityLine ? ` — ${severityLine}` : ""}
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
          AI will probe the live site and verify each finding to cut false
          positives. Results get saved to your report.
        </p>

        <div className="flex flex-col gap-2">
          <Button className="w-full gap-2 h-10" onClick={onDeepScan}>
            <BotMessageSquare className="h-4 w-4" />
            Deep Scan with AI
          </Button>
          <Button
            variant="ghost"
            className="w-full h-10 text-muted-foreground hover:text-foreground"
            onClick={onViewNow}
          >
            View results now
          </Button>
        </div>
      </div>
    </div>
  );
}
