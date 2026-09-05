"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  HelpCircle,
  MessageCircle,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkles,
  type LucideIcon as LucideIconType,
} from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import type { ScanResult } from "@/lib/scanner/types";
import { SITE_GRADE_SUMMARY, type SiteGrade } from "@/lib/scanner/site-grade";
import { cn } from "@/lib/ui/utils";
import { tourAnchor } from "@/lib/tour/anchors";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { copyToClipboard } from "@/lib/ui/clipboard";
import { formatRelativeTime as getRelativeTime } from "@/lib/ui/relative-time";
import { SeverityDistribution } from "@/components/scanner/severity-badge";
import { getSafetyRating } from "@/lib/scanner/safety-rating";
import { StatIcon, type StatTone } from "@/components/shared/stat-icon";
import { useAuth } from "@/components/providers/auth-provider";
import { askAiChatAbout } from "@/lib/ai/chat-bridge";

interface ScanSummaryProps {
  result: ScanResult;
  /** Pass true in DashboardResults to hide the URL/copy row (it has its own) */
  hideHeader?: boolean;
  /**
   * Hide the "Scan duration" stat. host_reputation (the public
   * /host/[hostname] page's data source) never stores a duration, only the
   * findings snapshot, so showing one there would mean fabricating a number
   * rather than reporting it.
   */
  hideDuration?: boolean;
}

/**
 * One rule governs every result surface in the product: the panel that states
 * the verdict is the ONLY tinted panel on the page. Everything under it (the
 * host panels, the findings list, the notes card) is a neutral bg-card box, so
 * the answer is the single thing that reads as coloured before anything else
 * registers. Before this, the verdict was a bg-card box with a 4px rail, i.e.
 * one card among eight identical ones, and a reader had to actually read to
 * find out whether the scan was good news.
 *
 * `tint` is deliberately held at /5. It is painted as an overlay ON TOP of
 * bg-card (see the layering in the JSX below, not as a background of its own)
 * so the panel keeps a solid card base, and /5 is the strongest value that
 * leaves every foreground colour drawn over it above 4.5:1 in BOTH themes.
 * The binding pair is critical-on-card in dark mode, which measures 4.61:1 at
 * /5 and drops under AA at /10.
 */
const VERDICT = {
  /**
   * Zero findings AND at least one branch that never finished. ScanResult
   * .incomplete's contract (lib/scanner/types.ts) is that a listed area means
   * "not checked", not "checked and clean", and reporting a partial scan as
   * clean is the worst thing this product can do. The findings block below
   * already said so in its empty state; the verdict at the top of the page did
   * not, so a timed-out scan opened with a green shield and the word "Nothing"
   * in 24px type. Which areas were missed is named down there, where the label
   * map for them lives.
   */
  partial: {
    icon: ShieldAlert,
    headline: "This scan did not finish",
    detail:
      "Some checks ran out of time, so parts of this host were never looked at. Nothing came back, but treat that as incomplete rather than clean and run the scan again.",
    rail: "bg-[hsl(var(--warning))]",
    text: "text-[hsl(var(--warning))]",
    tint: "bg-[hsl(var(--warning))]/5",
    edge: "border-[hsl(var(--warning))]/30",
    tile: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
  },
  /** Zero findings at all. "safe" below would tell the reader to fix the
   *  hardening recommendations, of which there are none. */
  clean: {
    icon: ShieldCheck,
    headline: "Nothing found on this scan",
    detail:
      "Every enabled check ran against this host and not one of them fired. There is nothing here to fix.",
    rail: "bg-[hsl(var(--success))]",
    text: "text-[hsl(var(--success))]",
    tint: "bg-[hsl(var(--success))]/5",
    edge: "border-[hsl(var(--success))]/30",
    tile: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
  },
  safe: {
    icon: ShieldCheck,
    headline: "Nothing exploitable found",
    detail:
      "Everything flagged here is a hardening recommendation, not a way in. Fix them when convenient.",
    rail: "bg-[hsl(var(--success))]",
    text: "text-[hsl(var(--success))]",
    tint: "bg-[hsl(var(--success))]/5",
    edge: "border-[hsl(var(--success))]/30",
    tile: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
  },
  caution: {
    icon: ShieldAlert,
    headline: "Review before you trust this host",
    detail:
      "At least one finding could be exploitable depending on how the site is used. Read the high and critical entries first.",
    rail: "bg-[hsl(var(--severity-medium))]",
    text: "text-[hsl(var(--severity-medium))]",
    tint: "bg-[hsl(var(--severity-medium))]/5",
    edge: "border-[hsl(var(--severity-medium))]/30",
    tile: "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))]",
  },
  unsafe: {
    icon: ShieldX,
    headline: "Actively exploitable issues found",
    detail:
      "The scanner found problems an attacker can use right now. Treat the critical findings as work for today.",
    rail: "bg-[hsl(var(--severity-critical))]",
    text: "text-[hsl(var(--severity-critical))]",
    tint: "bg-[hsl(var(--severity-critical))]/5",
    edge: "border-[hsl(var(--severity-critical))]/30",
    tile: "bg-[hsl(var(--severity-critical))]/10 text-[hsl(var(--severity-critical))]",
  },
} as const;

/**
 * Risk score colour, keyed to the same three tiers the score itself is
 * anchored to: getDangerScore (lib/scanner/safety-rating.ts) caps a "safe"
 * result at 4 and floors "unsafe" at 8, so these boundaries are the tiers
 * rather than a second, independent opinion about what a 6 means.
 */
function riskScoreClass(score: number): string {
  if (score >= 8) return "text-[hsl(var(--severity-critical))]";
  if (score >= 5) return "text-[hsl(var(--severity-medium))]";
  return "text-[hsl(var(--success))]";
}

/** Seeds the floating AI chat with this scan's summary so "Ask about this" continues as a normal conversation there. */
function buildAskPrompt(result: ScanResult, summary: string): string {
  const s = result.summary;
  return `Let's talk about this scan's summary for ${result.url}:\n\n"${summary}"\n\n(danger score ${result.dangerScore ?? "n/a"}/10, ${s.critical} critical / ${s.high} high / ${s.medium} medium / ${s.low} low / ${s.info} info findings)`;
}

/**
 * Kept as-is, and no longer used by this file. Two modals render a stat row
 * with this (components/scanner/ai-verify-result-modal.tsx,
 * components/repos/github-scan-result-modal.tsx) where a coloured icon tile
 * per cell is right: they are small dialogs with nothing else competing. The
 * scan summary moved to the plain `Readout` cell below because six coloured
 * tiles in a row under the verdict were the loudest thing on the page after
 * the verdict itself, and the verdict has to win outright.
 */
export function Stat({
  label,
  value,
  icon,
  tone = "muted",
}: {
  label: string;
  value: string;
  icon: LucideIconType;
  tone?: StatTone;
}) {
  return (
    <div className="flex min-w-0 flex-1 basis-32 items-center gap-2.5 px-3 py-2 sm:px-4">
      <StatIcon icon={icon} tone={tone} size="sm" />
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* The value keeps `truncate`: a git ref is unbounded user data and one
            unbreakable token, so it has to be allowed to clip. */}
        <span className="truncate text-sm font-semibold tabular-nums text-foreground">
          {value}
        </span>
        {/* The label does not. These are strings we wrote ("Possible false
            positive", "Ran out of time"), so clipping them destroys meaning and
            buys nothing: the cell could just be sized to fit. At basis-24 the
            longest of them needed about 120px and had 72px, so it rendered as
            "Possible fals...". It wraps to a second line instead, and the row
            is items-stretch so the neighbours follow the taller cell. */}
        <span className="text-[11px] leading-snug text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}

/**
 * Tier colors for a letter grade: A/A+ green, B blue (brand), C amber, D/F
 * red. Shared by the SSL grade and the whole-site grade so the same letter
 * never reads as two different tiers on one page.
 */
function letterGradeValueClass(grade: string): string {
  const g = grade.toUpperCase();
  if (g === "A+" || g === "A") return "text-[hsl(var(--success))]";
  if (g === "B") return "text-primary";
  if (g === "C") return "text-[hsl(var(--severity-medium))]";
  return "text-destructive";
}

/**
 * One cell of the readout strip under the verdict: value over label, no icon
 * tile. These are instrument readings, and colour is spent only where it
 * carries meaning (the SSL tier, the risk tier) rather than on every cell.
 */
function Readout({
  label,
  value,
  valueClass,
  children,
}: {
  label: string;
  value: string;
  /** Set only when the value's colour is information, not decoration. */
  valueClass?: string;
  /** Trailing control, e.g. the SSL grade explainer. */
  children?: ReactNode;
}) {
  return (
    // Two per row on a phone, the same floor components/shared/stat-strip.tsx
    // carries. basis-24 (96px) minus px-3.5 left a 68px content box, and the
    // labels here are 10px uppercase with tracking-wider: "CONFIDENCE" and
    // "CHECKS RUN" measure about 67px, and the SSL cell spends another 30px of
    // that box on its explainer button, so "SSL GRADE" rendered as "SSL G...".
    // These are strings we wrote, so the cell is sized to fit them instead.
    <div className="flex min-w-0 flex-1 basis-[calc(50%-1px)] items-center gap-1 px-3.5 py-2.5 sm:basis-32 sm:px-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "truncate text-base font-semibold leading-none tabular-nums",
            valueClass ?? "text-foreground",
          )}
        >
          {value}
        </span>
        <span className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Whole-site letter-grade cell: the A+ to F scale every free peer grades on,
 * and what the README badge prints. Read from the stored result rather than
 * recomputed, so the badge, the public host report and the scan record all
 * state the same letter (see lib/scanner/site-grade.ts). Sits before the SSL
 * grade because it is about the whole site, not just the TLS handshake. */
function SiteGradeStat({ grade }: { grade: SiteGrade }) {
  return (
    <Readout
      label="Site grade"
      value={grade}
      valueClass={letterGradeValueClass(grade)}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="What does the site grade mean?"
            className={cn(
              "ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <HelpCircle aria-hidden className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 text-left">
          <p className="text-xs font-semibold text-foreground">Site grade</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            One letter for the whole site, on the same A+ to F scale other
            scanners use. It is derived from the risk score beside it, not
            scored separately, so the two can never disagree.
          </p>
          <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-[11px]">
            {(Object.entries(SITE_GRADE_SUMMARY) as [SiteGrade, string][]).map(
              ([letter, summary]) => (
                <Fragment key={letter}>
                  <span
                    className={cn(
                      "font-semibold",
                      letterGradeValueClass(letter),
                    )}
                  >
                    {letter}
                  </span>
                  <span className="text-muted-foreground">{summary}</span>
                </Fragment>
              ),
            )}
          </div>
        </PopoverContent>
      </Popover>
    </Readout>
  );
}

/** SSL/TLS letter-grade cell. The grade's colour is the one piece of tier
 * information in the readout strip, so it keeps its colour while the other
 * cells stay neutral. The "?" opens a plain-language explainer. */
function SslGradeStat({ grade }: { grade: string }) {
  return (
    <Readout
      label="SSL grade"
      value={grade}
      valueClass={letterGradeValueClass(grade)}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="What does the SSL grade mean?"
            className={cn(
              // a11y (target size): p-0.5 around a 14px icon was an 18x18
              // target on a control that sits inline with body text, where
              // there is nothing to aim at but the icon itself.
              "ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <HelpCircle aria-hidden className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 text-left">
          <p className="text-xs font-semibold text-foreground">SSL/TLS grade</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            A letter grade for this site&apos;s HTTPS setup, in the style of SSL
            Labs. It comes from the TLS protocol version, the certificate&apos;s
            validity and chain, the key strength, and the negotiated cipher.
            Only sites served over HTTPS are graded.
          </p>
          <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-[11px]">
            <span className="font-semibold text-[hsl(var(--success))]">
              A+ / A
            </span>
            <span className="text-muted-foreground">Strong, modern TLS</span>
            <span className="font-semibold text-primary">B</span>
            <span className="text-muted-foreground">
              Solid, with minor gaps
            </span>
            <span className="font-semibold text-[hsl(var(--severity-medium))]">
              C
            </span>
            <span className="text-muted-foreground">
              Dated config worth fixing
            </span>
            <span className="font-semibold text-destructive">D / F</span>
            <span className="text-muted-foreground">
              Weak or broken: expired, self-signed, or an old protocol
            </span>
          </div>
        </PopoverContent>
      </Popover>
    </Readout>
  );
}

export function ScanSummary({
  result,
  hideHeader,
  hideDuration,
}: ScanSummaryProps) {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;
  const [copied, setCopied] = useState(false);
  const scanDate = new Date(result.scannedAt);
  const total = result.summary.total;
  const incomplete = (result.incomplete?.length ?? 0) > 0;
  // getSafetyRating answers "how dangerous", which for an empty findings list
  // is "safe" -- and the safe copy then tells the reader to get round to the
  // hardening recommendations, of which there are none. A scan with nothing in
  // it is its own verdict and the best result this product returns, unless
  // parts of it never ran, in which case it is not a result at all yet.
  const verdict =
    total === 0
      ? incomplete
        ? VERDICT.partial
        : VERDICT.clean
      : VERDICT[getSafetyRating(result.findings)];
  const VerdictIcon = verdict.icon;
  const aiSummary = result.aiSummary;

  const counts = {
    critical: result.summary.critical || 0,
    high: result.summary.high || 0,
    medium: result.summary.medium || 0,
    low: result.summary.low || 0,
    info: result.summary.info || 0,
  };

  async function copyUrl() {
    if (await copyToClipboard(result.url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <button
            type="button"
            onClick={copyUrl}
            className="group flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Copy scanned URL"
          >
            <span className="truncate font-mono text-sm text-foreground group-hover:text-primary transition-colors">
              {result.url.replace(/^https?:\/\//, "")}
            </span>
            {copied ? (
              <Check
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--success))]"
              />
            ) : (
              <Copy
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            )}
          </button>
          <span className="shrink-0 text-xs text-muted-foreground">
            {getRelativeTime(scanDate)}
          </span>
        </div>
      )}

      {/* The verdict. Sized, coloured and tinted so it is unmistakably the
          subject of the page before any of it is read: everything below is a
          neutral card. The tint is an overlay span rather than a background
          on the panel itself, so the panel keeps its solid bg-card base and
          the tint composites over it at a known, contrast-checked strength
          (see the VERDICT table). */}
      <div
        {...tourAnchor("scanVerdict")}
        className={cn(
          "overflow-hidden rounded-xl border bg-card",
          verdict.edge,
        )}
      >
        <div className="relative">
          <span
            aria-hidden
            className={cn("pointer-events-none absolute inset-0", verdict.tint)}
          />
          <span
            aria-hidden
            className={cn("absolute inset-y-0 left-0 w-1", verdict.rail)}
          />
          <div className="relative grid grid-cols-1 gap-6 py-5 pl-5 pr-4 sm:py-7 sm:pl-7 sm:pr-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] lg:gap-9">
            <div className="flex min-w-0 gap-4">
              {/* The glyph is not decoration: it is what separates the three
                  verdicts for a reader who cannot tell green from amber from
                  red, since the headline colour is otherwise the only thing
                  that distinguishes them at a glance. */}
              <span
                aria-hidden
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
                  verdict.tile,
                )}
              >
                <VerdictIcon className="h-6 w-6" />
              </span>
              <div className="flex min-w-0 flex-col gap-2">
                <h2
                  className={cn(
                    "text-balance text-xl font-semibold leading-tight tracking-tight sm:text-2xl",
                    verdict.text,
                  )}
                >
                  {verdict.headline}
                </h2>
                <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                  {verdict.detail}
                </p>
                {/* A scan that found things AND timed out is still a partial
                    scan, and nothing on the page said so: the empty state
                    below only speaks when there are no findings at all. The
                    areas that were missed are named there; here it is enough
                    that the count above is a floor, not a total. */}
                {incomplete && total > 0 && (
                  <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[hsl(var(--warning))]">
                    <AlertTriangle
                      aria-hidden
                      className="mt-px h-3.5 w-3.5 shrink-0"
                    />
                    Some checks ran out of time, so this list may be missing
                    findings. Run the scan again for a complete result.
                  </p>
                )}
              </div>
            </div>

            {/* Supporting evidence for the headline, and nothing more. On a
                clean scan there is no distribution to draw, so the column
                states the thing that makes "nothing found" trustworthy:
                how many checks actually ran. */}
            {total > 0 ? (
              <div className="flex flex-col gap-3 lg:border-l lg:border-border/70 lg:pl-9">
                <p className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
                    {total}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {total === 1 ? "finding" : "findings"}
                  </span>
                </p>
                <SeverityDistribution counts={counts} />
              </div>
            ) : (
              result.checksRun !== undefined &&
              result.checksRun > 0 && (
                <div className="flex flex-col gap-2 lg:border-l lg:border-border/70 lg:pl-9">
                  <p className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-[hsl(var(--success))]">
                      {result.checksRun.toLocaleString()}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      checks ran
                    </span>
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    None of them fired.
                  </p>
                </div>
              )
            )}
          </div>
        </div>

        {/* Instrument readings. Deliberately the quietest thing here: no icon
            tiles, no colour except where a value's colour is the reading (the
            SSL tier, the risk tier). */}
        <div
          {...tourAnchor("scanReadouts")}
          className="relative flex flex-wrap items-stretch divide-x divide-border border-t border-border bg-muted/30"
        >
          {result.dangerScore !== undefined && (
            <Readout
              label="Risk score"
              value={`${result.dangerScore}/10`}
              valueClass={riskScoreClass(result.dangerScore)}
            />
          )}
          {result.siteGrade && <SiteGradeStat grade={result.siteGrade} />}
          {result.sslGrade && <SslGradeStat grade={result.sslGrade} />}
          {result.engineConfidence !== undefined && (
            <Readout label="Confidence" value={`${result.engineConfidence}%`} />
          )}
          {result.checksRun !== undefined && result.checksRun > 0 && (
            <Readout
              label="Checks run"
              value={result.checksRun.toLocaleString()}
            />
          )}
          {!hideDuration && (
            <Readout
              label="Duration"
              value={`${(result.duration / 1000).toFixed(1)}s`}
            />
          )}
          <Readout label="Scanned" value={getRelativeTime(scanDate)} />
        </div>
      </div>

      {/* The AI's read of the scan, marked as such: the one brand-blue EDGE on
          the page, so it is never mistaken for something the deterministic
          engine measured. Deliberately not tinted: the verdict above owns the
          only tinted surface here, and text-primary on a bg-primary/5 panel
          measures 4.41:1 in light mode, under AA for a 12px label. On bg-card
          the same label is 5.15:1. */}
      {aiSummary && (
        <div className="rounded-xl border border-primary/25 bg-card px-4 py-3.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <Sparkles aria-hidden className="h-3.5 w-3.5" />
              AI summary
            </p>
            {isLoggedIn && (
              <button
                type="button"
                onClick={() =>
                  askAiChatAbout(buildAskPrompt(result, aiSummary))
                }
                className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MessageCircle aria-hidden className="h-3.5 w-3.5" />
                Ask about this
              </button>
            )}
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">
            {aiSummary}
          </p>
        </div>
      )}
    </div>
  );
}
