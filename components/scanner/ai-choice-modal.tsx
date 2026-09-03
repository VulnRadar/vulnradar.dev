"use client";

import { AlertTriangle, BotMessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import { cn } from "@/lib/ui/utils";
import { tourAnchor } from "@/lib/tour/anchors";
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

/**
 * Every variant carries it, not just the choice screen.
 *
 * The product tour holds the "read the verdict" step back until this dialog is
 * gone (a `disappear` advance on this anchor). Tagging only the choice screen
 * would report the dialog as gone the moment the reader pressed Verify, and the
 * tour would go back to spotlighting the report from underneath the "re-probing
 * the live site" screen: the exact bug the step exists to fix.
 */
const TOUR_PANEL = tourAnchor("aiChoiceModal");

/**
 * The gate between a scan finishing and its results being readable, so it must
 * not strand the caller. That is why it is a ModalShell rather than the panel
 * it used to hand-roll: the focus trap, the Escape handling and the scrolling
 * body all come from one place now. Escape and the scrim both resolve to "show
 * me the raw findings", which is the non-destructive way out.
 */
export function AiChoiceModal({
  findings,
  loading,
  aiSummary,
  error,
  onDeepScan,
  onViewNow,
}: AiChoiceModalProps) {
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
      <ModalShell
        open
        onClose={onViewNow}
        title={`AI finished reviewing ${total} ${total === 1 ? "finding" : "findings"}`}
        size="sm"
        panelProps={TOUR_PANEL}
        footer={
          <Button className="h-10" onClick={onViewNow}>
            View results
          </Button>
        }
      >
        <ul className="flex flex-col gap-2">
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
          <p className="mt-4 text-xs text-muted-foreground">
            {aiSummary.skipped}{" "}
            {aiSummary.skipped === 1 ? "finding" : "findings"} ran out of time
            and stayed unverified.
          </p>
        )}
      </ModalShell>
    );
  }

  // Verification was asked for and did not happen. The server's own message
  // is the useful part here: "you are out of AI credits" names both the
  // reason and the remedy, and it used to be discarded.
  if (error) {
    return (
      <ModalShell
        open
        onClose={onViewNow}
        title="AI verification did not run"
        description={error}
        icon={
          <AlertTriangle
            aria-hidden
            className="h-4 w-4 shrink-0 text-destructive"
          />
        }
        size="sm"
        panelProps={TOUR_PANEL}
        footer={
          <Button className="h-10" onClick={onViewNow}>
            View results
          </Button>
        }
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          The scan itself finished normally. The {total}{" "}
          {total === 1 ? "finding is" : "findings are"} below, unverified.
        </p>
      </ModalShell>
    );
  }

  // Verifying
  if (loading) {
    return (
      <ModalShell
        open
        onClose={onViewNow}
        title="Re-probing the live site"
        icon={
          <Loader2
            aria-hidden
            className="h-4 w-4 shrink-0 animate-spin text-primary"
          />
        }
        size="sm"
        panelProps={TOUR_PANEL}
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Each of the {total} {total === 1 ? "finding" : "findings"} gets
          checked against the real response before it is marked confirmed.
          Usually 5 to 30 seconds.
        </p>
      </ModalShell>
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
    <ModalShell
      open
      onClose={onViewNow}
      title={`Scan finished with ${total} ${total === 1 ? "finding" : "findings"}`}
      icon={
        <BotMessageSquare
          aria-hidden
          className="h-4 w-4 shrink-0 text-primary"
        />
      }
      size="sm"
      panelProps={TOUR_PANEL}
      footer={
        <>
          <Button
            variant="ghost"
            className="h-10 text-muted-foreground hover:text-foreground"
            onClick={onViewNow}
          >
            Skip, show the raw findings
          </Button>
          <Button className="h-10 gap-2" onClick={onDeepScan}>
            <BotMessageSquare aria-hidden className="h-4 w-4" />
            Verify with AI
          </Button>
        </>
      }
    >
      {present.length > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
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

      <p className="text-sm leading-relaxed text-muted-foreground">
        AI can re-probe the live site and mark each finding confirmed, likely
        false positive, or unverified. The verdicts save to the report, so this
        only has to happen once.
      </p>
    </ModalShell>
  );
}
