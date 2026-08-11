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
import { APP_NAME, TOTAL_CHECKS_LABEL, API } from "@/lib/config/constants";
import { refreshAuthCache } from "@/components/providers/auth-provider";
import { useModalA11y } from "@/lib/hooks/use-modal-a11y";

const STEPS = [
  {
    icon: Radar,
    title: `Welcome to ${APP_NAME}`,
    description: `Your all-in-one web vulnerability scanner. Let's walk you through the key features so you can get the most out of ${APP_NAME}.`,
    color: "text-primary",
  },
  {
    icon: Shield,
    title: "Scan Any Website",
    description: `Enter any URL on the Scanner page to run ${TOTAL_CHECKS_LABEL} security checks instantly. You'll get a detailed report with severity ratings, explanations, and fix recommendations.`,
    color: "text-[hsl(var(--chart-2))]",
  },
  {
    icon: Clock,
    title: "Track Your History",
    description:
      "Every scan is saved to your History. You can filter, tag, and organize scans. Use tags like 'production' or 'staging' to keep things organized.",
    color: "text-[hsl(var(--chart-3))]",
  },
  {
    icon: GitCompareArrows,
    title: "Compare Scans",
    description:
      "Select two scans of the same URL to see what changed. Great for verifying that you fixed vulnerabilities or checking for regressions.",
    color: "text-[hsl(var(--chart-4))]",
  },
  {
    icon: Key,
    title: "API Access",
    description: `Generate API keys in your Profile to automate scanning. Integrate ${APP_NAME} into your CI/CD pipeline for continuous security monitoring.`,
    color: "text-[hsl(var(--chart-5))]",
  },
  {
    icon: Bell,
    title: "Webhooks & Schedules",
    description:
      "Set up webhook notifications to Discord, Slack, or any URL. Schedule recurring scans to automatically monitor your sites on a daily or weekly basis.",
    color: "text-[hsl(var(--chart-2))]",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description:
      "Create a team and invite members to share scan results. Team owners and admins can manage access and view all team scans in one place.",
    color: "text-[hsl(var(--chart-3))]",
  },
  {
    icon: Sparkles,
    title: "You're All Set!",
    description: `Head to the Scanner and run your first scan. If you need help, check out the Docs page or reach out via the Contact page. Happy scanning with ${APP_NAME}!`,
    color: "text-primary",
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="relative w-full sm:max-w-2xl">
        {/* Card */}
        <div
          {...dialogProps}
          className="bg-card border border-border rounded-md shadow-2xl overflow-hidden outline-none flex flex-col sm:flex-row"
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
                    className={cn("h-4 w-4", i === step && s.color)}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>

          <div className="hidden sm:flex sm:flex-col sm:w-[210px] sm:shrink-0 sm:border-r sm:border-border/60 sm:py-5 sm:px-2.5 sm:gap-0.5">
            <p className="px-2.5 pb-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground/50">
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
                      : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <StepIcon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      i === step ? s.color : "text-muted-foreground/40",
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
              <div
                className={cn(
                  "inline-flex p-2 rounded-md bg-muted/50 mb-4",
                  current.color,
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>

              <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider mb-1.5">
                {step + 1} / {STEPS.length}
              </p>

              <h2
                {...titleProps}
                className="text-lg font-bold text-foreground mb-2 text-balance"
              >
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
                  Get Started
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
