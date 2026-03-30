"use client"

import { LucideIcon } from "lucide-react"
import { cn } from "@/lib/ui/utils"

interface DocsSectionProps {
  id: string
  title: string
  icon?: LucideIcon
  children: React.ReactNode
  className?: string
}

export function DocsSection({ id, title, icon: Icon, children, className }: DocsSectionProps) {
  return (
    <section id={id} className={cn("scroll-mt-24 space-y-4 sm:space-y-6", className)}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="p-2 rounded-xl bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        )}
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  )
}

interface DocsSubSectionProps {
  title: string
  children: React.ReactNode
  className?: string
}

export function DocsSubSection({ title, children, className }: DocsSubSectionProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {children}
    </div>
  )
}
