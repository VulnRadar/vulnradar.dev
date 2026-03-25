"use client"

import { cn } from "@/lib/utils"

interface AdminLayoutProps {
  children: React.ReactNode
  className?: string
}

export function AdminLayout({ children, className }: AdminLayoutProps) {
  return (
    <div className={cn(
      "min-h-screen bg-background",
      className
    )}>
      <div className="flex min-h-[calc(100vh-4rem)]">
        {children}
      </div>
    </div>
  )
}
