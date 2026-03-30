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
    <div className={cn("space-y-6", className)}>
      {steps.map((item) => (
        <div key={item.step} className="flex gap-4">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex-shrink-0">
            {item.step}
          </div>
          <div>
            <h4 className="font-semibold text-sm">{item.title}</h4>
            <p className="text-xs text-muted-foreground">{item.description}</p>
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
    <Card className={cn("p-6 border-border/40", className)}>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex-shrink-0">
          {step}
        </div>
        <h3 className="font-semibold">{title}</h3>
      </div>
      {description && <p className="text-sm text-muted-foreground mb-3">{description}</p>}
      {children}
    </Card>
  )
}
