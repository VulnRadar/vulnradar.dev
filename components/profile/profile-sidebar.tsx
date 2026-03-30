"use client"

import { User, Shield, Share2, CreditCard, Code, Bell, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useProfile } from "./profile-context"
import type { ProfileTab } from "./profile-types"

const TABS: { id: ProfileTab; label: string; icon: typeof User }[] = [
  { id: "general", label: "General", icon: User },
  { id: "security", label: "Security", icon: Shield },
  { id: "social", label: "Social", icon: Share2 },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "developer", label: "Developer", icon: Code },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "privacy", label: "Privacy", icon: Lock },
]

export function ProfileSidebar() {
  const { activeTab, setActiveTab } = useProfile()

  return (
    <aside className="w-full lg:w-56 flex-shrink-0">
      <nav className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
