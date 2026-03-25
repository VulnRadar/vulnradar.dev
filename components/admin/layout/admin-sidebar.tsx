"use client"

import { 
  LayoutDashboard, 
  Users, 
  History, 
  UsersRound, 
  Shield,
  ChevronRight,
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
  description: string
}

const TABS: TabItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, description: "Dashboard & stats" },
  { id: "users", label: "Users", icon: Users, description: "Manage accounts" },
  { id: "audit", label: "Audit Log", icon: History, description: "Activity history" },
  { id: "teams", label: "Teams", icon: UsersRound, description: "Team management" },
  { id: "staff", label: "Staff", icon: Shield, description: "Admin members" },
]

export function AdminSidebar({ activeTab, onTabChange, className }: AdminSidebarProps) {
  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden lg:flex flex-col w-64 shrink-0 border-r border-border/50 bg-gradient-to-b from-card to-card/80 sticky top-0 h-screen",
        className
      )}>
        {/* Brand Header */}
        <div className="p-5 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Admin Panel</h2>
              <p className="text-xs text-muted-foreground">VulnRadar</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          <p className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Navigation</p>
          {TABS.map(({ id, label, icon: Icon, description }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={cn(
                "group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all",
                activeTab === id
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <div className={cn(
                "h-9 w-9 rounded-lg flex items-center justify-center transition-colors",
                activeTab === id
                  ? "bg-primary-foreground/20"
                  : "bg-muted/50 group-hover:bg-muted"
              )}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-medium">{label}</p>
                <p className={cn(
                  "text-[10px] transition-colors",
                  activeTab === id ? "text-primary-foreground/70" : "text-muted-foreground"
                )}>
                  {description}
                </p>
              </div>
              <ChevronRight className={cn(
                "h-4 w-4 transition-transform",
                activeTab === id ? "opacity-100" : "opacity-0 group-hover:opacity-50"
              )} />
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border/50">
          <div className="px-3 py-2 rounded-lg bg-muted/30">
            <p className="text-[10px] text-muted-foreground">
              Admin actions are logged for security and compliance.
            </p>
          </div>
        </div>
      </aside>

      {/* Mobile Tab Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-lg safe-area-pb">
        <nav className="flex items-center justify-around py-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={cn(
                "flex flex-col items-center gap-0.5 px-4 py-2 rounded-lg text-xs font-medium transition-all min-w-[60px]",
                activeTab === id
                  ? "text-primary"
                  : "text-muted-foreground active:scale-95"
              )}
            >
              <div className={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                activeTab === id ? "bg-primary/10" : ""
              )}>
                <Icon className="h-5 w-5" />
              </div>
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  )
}
