"use client"

import { Card } from "@/components/ui/card"
import type { Step } from "./docs-types"
import { cn } from "@/lib/ui/utils"

interface DocsStepsProps {
  steps: Step[]
  className?: string
}

export function DocsSteps({ steps, className }: DocsStepsProps) {
  return (
    <div className={cn("space-y-3 sm:space-y-4", className)}>
      {steps.map((item) => (
        <div key={item.step} className="flex gap-2 sm:gap-4">
          <div className="flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-primary/10 text-primary text-xs sm:text-sm font-bold flex-shrink-0">
            {item.step}
          </div>
          <div className="min-w-0">
            <h4 className="text-xs sm:text-sm font-medium text-foreground leading-tight">{item.title}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

interface DocsStepCardProps {
  step: number
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}

export function DocsStepCard({ step, title, description, children, className }: DocsStepCardProps) {
  return (
    <Card className={cn("p-3 sm:p-5 border-border/50 bg-card/50", className)}>
      <div className="flex items-start gap-2 sm:gap-3 mb-2 sm:mb-4">
        <div className="flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-primary/10 text-primary text-xs sm:text-sm font-bold flex-shrink-0">
          {step}
        </div>
        <h3 className="text-xs sm:text-sm font-medium text-foreground leading-tight">{title}</h3>
      </div>
      {description && <p className="text-xs sm:text-sm text-muted-foreground mb-2 sm:mb-3">{description}</p>}
      {children}
    </Card>
  )
}
