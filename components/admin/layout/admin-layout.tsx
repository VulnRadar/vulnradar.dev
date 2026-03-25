"use client"

import { cn } from "@/lib/utils"

interface AdminLayoutProps {
  children: React.ReactNode
  className?: string
}

export function AdminLayout({ children, className }: AdminLayoutProps) {
  return (
    <div className={cn(
      "flex-1 bg-gradient-to-b from-background to-background/95",
      className
    )}>
      <div className="flex min-h-[calc(100vh-4rem)]">
        {children}
      </div>
    </div>
  )
}
