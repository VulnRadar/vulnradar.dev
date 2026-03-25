"use client"

import { Users, UsersRound, Bell, Shield, History } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AdminTab } from "../types"

interface AdminTabsProps {
  activeTab: AdminTab
  onTabChange: (tab: AdminTab) => void
}

const TABS = [
  { key: "users" as const, label: "Users", icon: Users, description: "Manage user accounts" },
  { key: "teams" as const, label: "Teams", icon: UsersRound, description: "View team data" },
  { key: "notifications" as const, label: "Alerts", icon: Bell, description: "Site notifications" },
  { key: "admins" as const, label: "Staff", icon: Shield, description: "Active staff" },
  { key: "audit" as const, label: "Audit", icon: History, description: "Activity logs" },
]

export function AdminTabs({ activeTab, onTabChange }: AdminTabsProps) {
  return (
    <div className="w-full">
      {/* Mobile: Horizontal scrollable pills */}
      <div className="flex sm:hidden overflow-x-auto scrollbar-hide gap-2 pb-2 -mx-1 px-1">
        {TABS.map((tab) => (
          <a
            key={tab.key}
            href={`/admin#${tab.key}`}
            onClick={(e) => {
              if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                onTabChange(tab.key)
              }
            }}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all",
              activeTab === tab.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </a>
        ))}
      </div>
      
      {/* Desktop: Underline tabs with descriptions on hover */}
      <div className="hidden sm:flex items-center gap-1 border-b border-border">
        {TABS.map((tab) => (
          <a
            key={tab.key}
            href={`/admin#${tab.key}`}
            onClick={(e) => {
              if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                onTabChange(tab.key)
              }
            }}
            title={tab.description}
            className={cn(
              "group relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px",
              activeTab === tab.key
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground hover:border-border/60",
            )}
          >
            <tab.icon className={cn(
              "h-4 w-4 transition-colors",
              activeTab === tab.key ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
            )} />
            {tab.label}
          </a>
        ))}
      </div>
    </div>
  )
}
