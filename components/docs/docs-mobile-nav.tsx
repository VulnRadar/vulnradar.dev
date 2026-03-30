"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/ui/utils"
import { BookOpen } from "lucide-react"
import type { NavItem, TocItem } from "./docs-types"

interface DocsMobileNavProps {
  navItems: NavItem[]
  tocItems: TocItem[]
  activeSection: string
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
}

export function DocsMobileNavTrigger({ onToggle }: { onToggle: () => void }) {
  return (
    <div className="lg:hidden fixed bottom-20 right-4 z-50">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-full shadow-lg text-xs sm:text-sm font-medium"
      >
        <BookOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        <span className="hidden xs:inline">Docs</span>
      </button>
    </div>
  )
}

export function DocsMobileNav({
  navItems,
  tocItems,
  activeSection,
  isOpen,
  onClose,
}: DocsMobileNavProps) {
  const pathname = usePathname()

  if (!isOpen) return null

  return (
    <div className="lg:hidden fixed inset-0 z-40 bg-background/95 backdrop-blur-sm">
      <div className="p-6 pt-20">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground"
        >
          <span className="sr-only">Close</span>
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href) && (item.href !== "/docs" || pathname === "/docs")

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Mobile ToC */}
        {tocItems.length > 0 && (
          <div className="mt-8 pt-6 border-t border-border">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              On This Page
            </h3>
            <nav className="space-y-1">
              {tocItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={onClose}
                  className={cn(
                    "block px-3 py-2 rounded-md text-sm transition-colors",
                    item.level === 2 && "pl-6",
                    activeSection === item.id
                      ? "text-primary font-medium bg-primary/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        )}
      </div>
    </div>
  )
}
