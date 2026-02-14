"use client"

import { useEffect, useState } from "react"
import { Loader2, Shield } from "lucide-react"
import { TOTAL_CHECKS_LABEL } from "@/lib/constants"

const SCAN_STEPS = [
  "Connecting to target...",
  "Checking HTTP security headers...",
  "Analyzing SSL/TLS configuration...",
  "Scanning for mixed content...",
  "Reviewing cookie security...",
  "Checking server information disclosure...",
  "Analyzing content security policies...",
  "Checking CORS configuration...",
  "Scanning for subresource integrity...",
  "Detecting sensitive file references...",
  "Analyzing cache control headers...",
]

export function ScanningIndicator() {
  const [activeStep, setActiveStep] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % SCAN_STEPS.length)
    }, 1200)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex flex-col items-center gap-8 py-12 sm:py-16 px-4">
      {/* Spinner */}
      <div className="relative">
        <div className="absolute inset-[-8px] rounded-full border-2 border-primary/20 animate-ping" />
        <div className="absolute inset-[-4px] rounded-full border border-primary/10 animate-pulse" />
        <div className="relative flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 border border-primary/20">
          <Shield className="h-6 w-6 text-primary" />
        </div>
      </div>

      {/* Status text */}
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <h2 className="text-base font-semibold text-foreground">
            Scanning in progress
          </h2>
        </div>
        <p className="text-sm text-muted-foreground max-w-sm">
          Running {TOTAL_CHECKS_LABEL} different vulnerability checks against the target. This usually takes a few seconds.
        </p>
      </div>

      {/* Progressive steps */}
      <div className="flex flex-col gap-1.5 w-full max-w-xs">
        {SCAN_STEPS.map((step, i) => {
          const isActive = i === activeStep
          const isPast = i < activeStep

          return (
            <div
              key={i}
              className="flex items-center gap-2.5 text-xs transition-all duration-300"
              style={{ opacity: isActive ? 1 : isPast ? 0.6 : 0.25 }}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-300 ${
                  isActive
                    ? "bg-primary scale-125"
                    : isPast
                      ? "bg-primary/60"
                      : "bg-muted-foreground/30"
                }`}
              />
              <span
                className={
                  isActive
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                }
              >
                {step}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
