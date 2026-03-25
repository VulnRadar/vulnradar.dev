"use client"

import { 
  LayoutDashboard, 
  Users, 
  History, 
  UsersRound, 
  Shield,
  type LucideIcon 
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { AdminTab } from "../types"

interface AdminSidebarProps {
  activeTab: AdminTab
  onTabChange: (tab: AdminTab) => void
  className?: string
}

interface TabItem {
  id: AdminTab
  label: string
  icon: LucideIcon
}

const TABS: TabItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "audit", label: "Audit Log", icon: History },
  { id: "teams", label: "Teams", icon: UsersRound },
  { id: "staff", label: "Staff", icon: Shield },
]

export function AdminSidebar({ activeTab, onTabChange, className }: AdminSidebarProps) {
  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden lg:flex flex-col w-56 shrink-0 border-r border-border bg-card/50 sticky top-16 h-[calc(100vh-4rem)]",
        className
      )}>
        <nav className="flex flex-col gap-1 p-3">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                activeTab === id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Mobile Tab Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm">
        <nav className="flex items-center justify-around py-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                activeTab === id
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  )
}
