"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
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
  X,
  Sparkles,
} from "lucide-react"
import { APP_NAME, TOTAL_CHECKS_LABEL } from "@/lib/constants"

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
    color: "text-emerald-500",
  },
  {
    icon: Clock,
    title: "Track Your History",
    description: "Every scan is saved to your History. You can filter, tag, and organize scans. Use tags like 'production' or 'staging' to keep things organized.",
    color: "text-blue-500",
  },
  {
    icon: GitCompareArrows,
    title: "Compare Scans",
    description: "Select two scans of the same URL to see what changed. Great for verifying that you fixed vulnerabilities or checking for regressions.",
    color: "text-amber-500",
  },
  {
    icon: Key,
    title: "API Access",
    description: `Generate API keys in your Profile to automate scanning. Integrate ${APP_NAME} into your CI/CD pipeline for continuous security monitoring.`,
    color: "text-purple-500",
  },
  {
    icon: Bell,
    title: "Webhooks & Schedules",
    description: "Set up webhook notifications to Discord, Slack, or any URL. Schedule recurring scans to automatically monitor your sites on a daily or weekly basis.",
    color: "text-rose-500",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Create a team and invite members to share scan results. Team owners and admins can manage access and view all team scans in one place.",
    color: "text-cyan-500",
  },
  {
    icon: Sparkles,
    title: "You're All Set!",
    description: `Head to the Scanner and run your first scan. If you need help, check out the Docs page or reach out via the Contact page. Happy scanning with ${APP_NAME}!`,
    color: "text-primary",
  },
]

export function OnboardingTour() {
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.userId && !d.onboardingCompleted) {
          setShow(true)
        }
      })
      .catch(() => {})
  }, [])

  async function handleComplete() {
    setShow(false)
    await fetch("/api/auth/onboarding", { method: "POST" })
  }

  function handleSkip() {
    handleComplete()
  }

  if (!show) return null

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1
  const isFirst = step === 0

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4">
        {/* Card */}
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
          {/* Progress bar */}
          <div className="h-1 bg-muted">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>

          {/* Close */}
          <button
            type="button"
            onClick={handleSkip}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Skip tour"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Content */}
          <div className="px-8 pt-10 pb-8 flex flex-col items-center text-center">
            <div className={cn("p-4 rounded-2xl bg-muted/50 mb-6", current.color)}>
              <Icon className="h-10 w-10" />
            </div>

            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
              Step {step + 1} of {STEPS.length}
            </p>

            <h2 className="text-xl font-bold text-foreground mb-3 text-balance">
              {current.title}
            </h2>

            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm text-pretty">
              {current.description}
            </p>
          </div>

          {/* Navigation */}
          <div className="px-8 pb-8 flex items-center justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              className="bg-transparent gap-1"
              onClick={() => setStep(step - 1)}
              disabled={isFirst}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </Button>

            <div className="flex items-center gap-1.5">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStep(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50",
                  )}
                  aria-label={`Go to step ${i + 1}`}
                />
              ))}
            </div>

            {isLast ? (
              <Button size="sm" className="gap-1" onClick={handleComplete}>
                Get Started
                <Sparkles className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button size="sm" className="gap-1" onClick={() => setStep(step + 1)}>
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
