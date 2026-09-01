"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import {
  Radar,
  Shield,
  Clock,
  GitCompareArrows,
  Key,
  Bell,
  Users,
  ChevronRight,
  ChevronLeft,
  Check,
  X,
  Sparkles,
} from "lucide-react";
import { TOTAL_CHECKS_LABEL, API } from "@/lib/config/client-constants";
import { refreshAuthCache } from "@/components/providers/auth-provider";
import { useModalA11y } from "@/lib/hooks/use-modal-a11y";

// This modal is the first VulnRadar interface a new account sees, and it used
// to contradict everything the landing page does: a per-step colour taken off
// the --chart-* data ramp (four unrelated hues, repeating after step 5, so
// they encoded nothing), an icon in a tinted rounded square on every step, and
// Title Case benefit copy ("Scan Any Website", "You're All Set!"). Icons now
// carry no colour of their own, so the one accent marks position and nothing
// else, and every title is a sentence-case statement with a mechanism under it
// rather than a benefit.
const STEPS = [
  {
    icon: Radar,
    title: "What this is",
    description: `A scanner that reads a live URL and tells you what is wrong with the response. ${TOTAL_CHECKS_LABEL} checks, nothing to install, and the whole engine is in the public repo.`,
  },
  {
    icon: Shield,
    title: "Paste a URL and hit Scan",
    description: `${TOTAL_CHECKS_LABEL} checks run in parallel against the live response, from our servers rather than your browser. Every finding comes back with the bytes it fired on and a config snippet you can paste.`,
  },
  {
    icon: Clock,
    title: "Every scan is kept",
    description:
      "History holds all of them. Filter by URL or tag, and a tag like production or staging survives a rescan so the next run lands in the same place.",
  },
  {
    icon: GitCompareArrows,
    title: "Diff two scans of the same URL",
    description:
      "Finding IDs do not change between runs, so the diff is the list of things that actually changed rather than a second read of the whole report.",
  },
  {
    icon: Key,
    title: "API keys live in your profile",
    description:
      "One key, one POST, the same JSON the dashboard renders. Enough to gate a build or run a scan from cron without opening the app.",
  },
  {
    icon: Bell,
    title: "Webhooks and schedules",
    description:
      "Point a schedule at a URL and it rescans on its own. New findings go to Discord, Slack, or any endpoint that accepts JSON.",
  },
  {
    icon: Users,
    title: "Share scans with a team",
    description:
      "Invite members, set who can run scans and who can only read them, and every team scan lands in one list.",
  },
  {
    icon: Sparkles,
    title: "Go run one",
    description:
      "Nothing else to configure. Docs and the contact form are in the nav if you get stuck.",
  },
];

export function OnboardingTour() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    fetch(API.AUTH.ME)
      .then((r) => r.json())
      .then((d) => {
        if (d.userId && !d.onboardingCompleted) {
          setShow(true);
        }
      })
      .catch(() => {});
  }, []);

  async function handleComplete() {
    setShow(false);
    await fetch(API.AUTH.ONBOARDING, { method: "POST" });
    // onboardingCompleted is part of MeResponse -- keep the app-wide
    // useAuth() cache in sync too, defensively, even though this
    // component currently re-checks via its own direct fetch rather than
    // that cache (see the matching note in app/profile/page.tsx).
    refreshAuthCache();
  }

  function handleSkip() {
    handleComplete();
  }

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  const { dialogProps, titleProps, descriptionProps } = useModalA11y({
    open: show,
    onClose: handleSkip,
    hasDescription: true,
  });

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
      <div className="relative w-full sm:max-w-2xl">
        {/* Card */}
        <div
          {...dialogProps}
          // max-h + a y scroll: the card had overflow-hidden and no height
          // cap, and its parent is a centring flex container which does not
          // scroll, so on a short phone a long step description pushed the
          // Back / Next row off the bottom with no way to reach it. dvh
          // rather than vh because 100vh on iOS Safari is the large viewport.
          className="bg-card border border-border rounded-xl shadow-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden overscroll-contain outline-hidden flex flex-col sm:flex-row"
        >
          {/* Close */}
          <button
            type="button"
            onClick={handleSkip}
            className="absolute top-3.5 right-3.5 z-10 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Skip tour"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* Feature list -- lets you see the whole shape of the tour and
              jump anywhere, instead of a dot-pager that says nothing about
              what's actually in it. Collapses to an icon strip on mobile. */}
          <div className="flex sm:hidden items-center gap-1 px-4 pt-4 overflow-x-auto">
            {STEPS.map((s, i) => {
              const StepIcon = s.icon;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStep(i)}
                  aria-current={i === step ? "step" : undefined}
                  aria-label={s.title}
                  className={cn(
                    "shrink-0 p-2 rounded-md transition-colors",
                    i === step ? "bg-muted" : "opacity-40 hover:opacity-70",
                  )}
                >
                  <StepIcon
                    className={cn(
                      "h-4 w-4",
                      i === step ? "text-primary" : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>

          <div className="hidden sm:flex sm:flex-col sm:w-[210px] sm:shrink-0 sm:border-r sm:border-border/60 sm:py-5 sm:px-2.5 sm:gap-0.5">
            <p className="px-2.5 pb-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              What&apos;s here
            </p>
            {STEPS.map((s, i) => {
              const StepIcon = s.icon;
              const visited = i < step;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStep(i)}
                  aria-current={i === step ? "step" : undefined}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left text-xs font-medium transition-colors",
                    i === step
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <StepIcon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      i === step ? "text-primary" : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate flex-1">{s.title}</span>
                  {visited && (
                    <Check
                      className="h-3 w-3 shrink-0 text-muted-foreground/40"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Detail pane */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 px-6 sm:px-7 pt-6 sm:pt-7 pb-6">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">
                {step + 1} / {STEPS.length}
              </p>

              {/* Icon inline before the title rather than in a tinted plate
                  above it: an icon in a rounded square on every step is the
                  grammar CLAUDE.md names as the giveaway. */}
              <h2
                {...titleProps}
                className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground mb-2 text-balance"
              >
                <Icon
                  className="h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                {current.title}
              </h2>

              <p
                {...descriptionProps}
                className="text-sm text-muted-foreground leading-relaxed text-pretty"
              >
                {current.description}
              </p>
            </div>

            {/* Navigation */}
            <div className="px-6 sm:px-7 py-4 border-t border-border/40 flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                className="bg-transparent gap-1"
                onClick={() => setStep(step - 1)}
                disabled={isFirst}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back
              </Button>

              {isLast ? (
                <Button size="sm" className="gap-1" onClick={handleComplete}>
                  Start scanning
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={() => setStep(step + 1)}
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
