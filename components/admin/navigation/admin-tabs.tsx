"use client"

import { Users, UsersRound, Bell, Shield, History } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AdminTab } from "../types"

interface AdminTabsProps {
  activeTab: AdminTab
  onTabChange: (tab: AdminTab) => void
}

const TABS = [
  { key: "users" as const, label: "Users", icon: Users },
  { key: "teams" as const, label: "Teams", icon: UsersRound },
  { key: "notifications" as const, label: "Notifications", icon: Bell },
  { key: "admins" as const, label: "Active Staff", icon: Shield },
  { key: "audit" as const, label: "Audit Logs", icon: History },
]

export function AdminTabs({ activeTab, onTabChange }: AdminTabsProps) {
  return (
    <>
      {/* Mobile: icons-only centered */}
      <div className="flex sm:hidden justify-center gap-2 border-b border-border pb-2 pt-1">
        {TABS.map((tab) => (
          <a
            key={tab.key}
            href={`/admin#${tab.key}`}
            title={tab.label}
            aria-label={tab.label}
            onClick={(e) => {
              if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                onTabChange(tab.key)
              }
            }}
            className={cn(
              "flex items-center justify-center w-10 h-10 rounded-md transition-all",
              activeTab === tab.key
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            <tab.icon className="h-4 w-4" />
          </a>
        ))}
      </div>
      
      {/* Desktop: text + icon underline tabs */}
      <div className="hidden sm:flex items-center gap-1 border-b border-border -mb-px">
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
              "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.key
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground hover:border-border",
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </a>
        ))}
      </div>
    </>
  )
}
