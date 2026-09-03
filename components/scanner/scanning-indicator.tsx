"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Globe2, ListChecks, X, Zap } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { tourAnchor } from "@/lib/tour/anchors";
import type { Category } from "@/lib/scanner/types";
import { ALL_CATEGORIES } from "@/lib/scanner/types";
import { CATEGORY_META } from "@/lib/scanner/category-meta";
import {
  ACTIVE_PROBES_CATEGORY,
  isActiveProbeSelector,
} from "@/lib/scanner/active-probe-catalog";

type ScanMode = "quick" | "deep" | "bulk";

/** What each check family is doing, phrased for the moment it runs. */
const FAMILY_STEP: Record<Category, string> = {
  headers: "Reading HTTP security headers",
  ssl: "Validating the SSL certificate chain",
  tls: "Negotiating TLS versions and ciphers",
  content: "Parsing page content for mixed content and inline script",
  cookies: "Inspecting cookie flags",
  configuration: "Probing server configuration",
  "information-disclosure":
    "Looking for leaked paths, versions and stack traces",
  dns: "Resolving DNS records",
  email: "Checking SPF, DKIM and DMARC",
  api: "Mapping the API surface",
  code: "Running static analysis on served source",
  "secrets-extended": "Grepping responses for keys and tokens",
  "vibe-code": "Matching AI-generated code patterns",
  "client-side": "Auditing client-side JavaScript",
  "supply-chain": "Checking supply chain artifacts",
  "host-validation": "Validating host and origin handling",
  reputation: "Checking threat-intelligence reputation",
  "active-probes": "Probing forms and endpoints for XSS, SQLi, SSTI and more",
};

const OPENING_STEP = "Connecting to the target";
const CLOSING_STEP = "Scoring and de-duplicating findings";

/** How long each step is shown before the next one lights up. */
const STEP_MS = 1200;
/** The bar never claims to be done, because the client cannot know that. */
const MAX_BAR_PERCENT = 92;
/**
 * Most real scans finish in 1-3 seconds, and the status poll only lands
 * every couple of seconds (CONFIG_SCAN_STATUS_POLL_INTERVAL_MS) -- so a
 * fast scan typically reports zero categories done on the first poll, then
 * *all* of them done on the second. Rendering that jump directly would
 * flash straight from "just started" to "finishing up" with nothing
 * legible in between. Instead, the on-screen step only ever advances one
 * family at a time, at least this often, so a scan that raced through 16
 * categories between two polls still visibly checks them off in quick
 * sequence rather than skipping past them. This never delays anything --
 * the real result still renders the instant it's ready, whether or not the
 * catch-up animation below has finished ticking through every step.
 */
const MIN_STEP_DISPLAY_MS = 120;
/**
 * A scan that finishes before the first status poll lands can make
 * `settling` go from never-true to true on the very first render with real
 * data, jumping the bar from a low simulated percent straight to
 * MAX_BAR_PERCENT in a single frame -- reads as broken, not fast. Once
 * settling starts (every category actually has finished, only
 * scoring/dedup is left), ease the bar the rest of the way to 100 over this
 * span instead of snapping, so however long the parent keeps this mounted,
 * it reads as "it worked, fast."
 */
const SETTLE_ANIMATION_MS = 500;

const MODE_CONFIG = {
  quick: { label: "Quick scan", icon: Zap },
  deep: { label: "Deep crawl", icon: Globe2 },
  bulk: { label: "Bulk scan", icon: ListChecks },
} as const;

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface ScanningIndicatorProps {
  url?: string;
  mode?: ScanMode;
  /** The families this scan actually requested (category ids, plus any
   *  `active-probes:<id>` selectors). Omitted means every family. */
  categories?: string[];
  onCancel?: () => void;
  /**
   * Real, server-reported progress from GET /api/v3/scan/status/[id]
   * (see lib/scanner/scan-jobs.ts). When categoriesTotal is a positive
   * number, the bar and step counter are driven by these instead of the
   * elapsed-time simulation below, because the server actually knows.
   */
  currentCategory?: string | null;
  categoriesCompleted?: number;
  categoriesTotal?: number;
}

export function ScanningIndicator({
  url,
  mode = "quick",
  categories,
  onCancel,
  currentCategory = null,
  categoriesCompleted = 0,
  categoriesTotal = 0,
}: ScanningIndicatorProps) {
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  const { families, steps, shortSteps } = useMemo(() => {
    const raw =
      categories && categories.length > 0 ? categories : ALL_CATEGORIES;
    // Every selected active probe (an `active-probes:<id>` selector) collapses
    // to the single "active-probes" step: the engine runs them all under one
    // labeled async branch and reports its progress once, so showing one row
    // per probe would over-count a stage that finishes together.
    const families: Category[] = [];
    let addedActive = false;
    for (const c of raw) {
      if (isActiveProbeSelector(c)) {
        if (!addedActive) {
          families.push(ACTIVE_PROBES_CATEGORY as Category);
          addedActive = true;
        }
        continue;
      }
      families.push(c as Category);
    }
    const steps = [
      OPENING_STEP,
      ...families.map((c) => FAMILY_STEP[c] ?? c),
      CLOSING_STEP,
    ];
    // The checklist used to render the FAMILY_STEP sentences, which run to 55
    // characters. In a one-column grid at 375px the row has roughly 289px of
    // text width, so the three longest strings clipped with no wrap, no title
    // and no tooltip: on a phone you could not read what was currently
    // running. CATEGORY_META labels are 15 characters at most and say the same
    // thing in the checklist's context, so nothing clips. The full sentence
    // still gets a whole row of its own, above the bar.
    const shortSteps = [
      "Connecting",
      ...families.map((c) => CATEGORY_META[c]?.label ?? c),
      "Scoring",
    ];
    return { families, steps, shortSteps };
  }, [categories]);

  const hasRealProgress = categoriesTotal > 0;

  // The elapsed clock now exists only to drive the simulated fallback during
  // the brief window before the first status poll lands. It used to also feed
  // a visible seconds readout, which is removed: showing a wall-clock number
  // beside a scan invited the reader to judge the engine by it, and the number
  // was dominated by work the engine was waiting on rather than the scanning
  // itself. Once the server reports real progress there is nothing left for
  // the timer to drive, so the interval stops instead of re-rendering this
  // component every 500ms for the rest of the scan.
  useEffect(() => {
    if (hasRealProgress) return;
    const tick = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(tick);
  }, [startedAt, hasRealProgress]);

  // Timer-based fallback for the brief window before the first status poll
  // lands (or for callers that never pass real progress at all).
  const simulatedStep = Math.min(
    Math.floor(elapsed / STEP_MS),
    steps.length - 1,
  );
  const simulatedSettling = elapsed / STEP_MS >= steps.length;

  // `targetStep`/`settling` are the real (or simulated-fallback) truth,
  // computed fresh every render. They can jump several steps between two
  // polls of a fast scan -- `displayStep` below is what's actually shown,
  // and only ever catches up to this target gradually.
  let targetStep: number;
  let settling: boolean;

  if (hasRealProgress) {
    // The server has already finished every category but hasn't flipped to
    // "completed" yet (still scoring/deduplicating). Real, not guessed.
    settling = categoriesCompleted >= categoriesTotal;
    const familyIndex = currentCategory
      ? families.indexOf(currentCategory as Category)
      : -1;
    if (settling) {
      targetStep = steps.length - 1;
    } else if (familyIndex !== -1) {
      targetStep = familyIndex + 1; // offset for OPENING_STEP at index 0
    } else if (categoriesCompleted === 0) {
      targetStep = 0;
    } else {
      // The category isn't one this scan's checklist happens to display
      // (e.g. a service probe) -- place the marker at how much real work
      // has landed rather than guessing which checklist row is "current".
      targetStep = Math.min(categoriesCompleted, steps.length - 2);
    }
  } else {
    // Monotonic: the step index only ever moves forward and stops at the end.
    targetStep = simulatedStep;
    settling = simulatedSettling;
  }

  // The visible, paced step: ratchets up toward `targetStep` at most one
  // step per MIN_STEP_DISPLAY_MS, and never regresses even if `targetStep`
  // itself isn't perfectly monotonic (server category order can differ
  // from the checklist's display order).
  const targetStepRef = useRef(targetStep);
  useEffect(() => {
    targetStepRef.current = targetStep;
  });
  const [displayStep, setDisplayStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setDisplayStep((current) =>
        current < targetStepRef.current ? current + 1 : current,
      );
    }, MIN_STEP_DISPLAY_MS);
    return () => clearInterval(id);
  }, []);

  // Only actually claim "settling" once the visible checklist has caught
  // up to the last step -- otherwise a scan that completes between two
  // polls would still snap straight to "waiting on the slowest checks"
  // without ever showing the categories in between finish.
  const displaySettling = settling && displayStep >= steps.length - 1;
  const displayBarPercent = Math.min(
    MAX_BAR_PERCENT,
    Math.round(((displayStep + 1) / steps.length) * MAX_BAR_PERCENT),
  );

  const [settlePercent, setSettlePercent] = useState<number | null>(null);
  const settleFrame = useRef<number | null>(null);

  useEffect(() => {
    if (!displaySettling) return;
    const from = settlePercent ?? displayBarPercent;
    // globals.css caps CSS animation and transition durations under
    // prefers-reduced-motion, but this ramp writes style.width from JS on
    // every frame, so the global reset could not reach it: the one piece of
    // motion in the product that ignored the user's setting. Jump to the end
    // instead of animating there.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a media query (an external system, unavailable during SSR) and writes the end state once, in place of the animation this effect otherwise starts
      setSettlePercent(100);
      return;
    }
    const animStartedAt = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - animStartedAt) / SETTLE_ANIMATION_MS);
      setSettlePercent(from + (100 - from) * t);
      if (t < 1) {
        settleFrame.current = requestAnimationFrame(tick);
      }
    }
    settleFrame.current = requestAnimationFrame(tick);
    return () => {
      if (settleFrame.current !== null) {
        cancelAnimationFrame(settleFrame.current);
      }
    };
    // Intentionally only restarts when `displaySettling` flips on;
    // `displayBarPercent` and `settlePercent` are read once for their value
    // at that instant, not tracked as re-trigger sources for the ramp itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySettling]);

  const displayPercent =
    displaySettling && settlePercent !== null
      ? settlePercent
      : displayBarPercent;

  const ModeIcon = MODE_CONFIG[mode].icon;

  return (
    <div className="w-full max-w-3xl" aria-busy="true">
      {/* The scanning state replaces ScanHero, which owns the page's only
          h1, so while a scan runs the document had no heading at all: a
          screen reader jumping by heading found nothing, and the page
          outline went from "VulnRadar" to empty and back. Visually hidden
          rather than drawn, because the card below already says all of this
          to anyone who can see it. */}
      <h1 className="sr-only">
        Scanning {url ? getHostname(url) : "your target"}
      </h1>
      {/* One status region for the whole card. The per-step paragraph below
          used to carry aria-live itself, so every one of the twenty check
          families interrupted the reader with its own announcement as the
          bar moved. This says the same thing once per completed family, in
          a form that makes sense out of context. */}
      <p className="sr-only" role="status">
        {hasRealProgress
          ? `${Math.min(categoriesCompleted, categoriesTotal)} of ${categoriesTotal} check families complete.`
          : "Scan starting."}
      </p>
      <div
        {...tourAnchor("scanProgress")}
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        {/* Target line */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3 sm:px-5">
          {/* The house pill is rounded-full at text-[10px] with uppercase
              tracking and a /25-to-/30 border. This was a third pill grammar
              (square-ish `rounded`, text-xs, /20 border) on the product's
              highest-traffic transient surface. */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
            <ModeIcon aria-hidden className="h-3 w-3" />
            {MODE_CONFIG[mode].label}
          </span>
          {url && (
            <span className="min-w-0 truncate font-mono text-sm text-foreground">
              {getHostname(url)}
            </span>
          )}
          {/* Replaces the elapsed-seconds clock that used to sit here. A
              count of real work done says more than a wall-clock number, and
              it cannot undersell the engine by counting time the engine spent
              waiting on something else. Falls back to nothing at all rather
              than a guess, for the short window before the first poll. */}
          {hasRealProgress && (
            <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
              {Math.min(categoriesCompleted, categoriesTotal)} of{" "}
              {categoriesTotal} checks
            </span>
          )}
        </div>

        {/* Progress */}
        <div className="flex flex-col gap-2 px-4 py-4 sm:px-5">
          <div className="flex items-baseline justify-between gap-3">
            {/* aria-hidden, not aria-live: the sr-only status region at the
                top of the card is the one that speaks. */}
            {/* text-pretty rather than truncate: this is the one place the
                full FAMILY_STEP sentence is shown, and it has a whole row. */}
            <p
              aria-hidden="true"
              className="min-w-0 text-pretty text-sm font-medium text-foreground"
            >
              {displaySettling
                ? "Waiting on the slowest checks"
                : steps[displayStep]}
            </p>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {displayStep + 1}/{steps.length}
            </span>
          </div>
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            // The bar's width is driven by displayPercent, and the value
            // announced used to be a step index against a step count, so the
            // number a screen reader heard and the fill a sighted user saw
            // could be a long way apart during the settle ramp. Both read
            // the same source now.
            aria-valuemax={100}
            aria-valuenow={Math.round(displayPercent)}
            aria-label="Scan progress"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${displayPercent}%` }}
            />
          </div>
        </div>

        {/* Per-family checklist. Two columns from sm, one at 375px. */}
        <ul className="grid grid-cols-1 gap-x-6 border-t border-border/60 px-4 py-3 sm:grid-cols-2 sm:px-5">
          {shortSteps.map((step, i) => {
            const done = i < displayStep || displaySettling;
            const running = i === displayStep && !displaySettling;
            return (
              <li
                key={step}
                className="flex items-center gap-2 py-1 text-xs leading-snug"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                    done && "border-primary/40 bg-primary/15 text-primary",
                    running &&
                      "border-primary bg-primary text-primary-foreground",
                    !done && !running && "border-border bg-transparent",
                  )}
                >
                  {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  {running && (
                    <span className="h-1 w-1 rounded-full bg-current" />
                  )}
                </span>
                {/* No truncate: every one of these is a check-family label we
                    wrote ("Information disclosure", "Security headers"), and
                    the column is one-up on a phone, so it has the room to
                    print them whole. */}
                <span
                  className={cn(
                    "min-w-0",
                    running && "font-medium text-foreground",
                    done && "text-muted-foreground",
                    !done && !running && "text-muted-foreground/50",
                  )}
                >
                  {step}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {onCancel && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
            Cancel scan
          </button>
        </div>
      )}
    </div>
  );
}
