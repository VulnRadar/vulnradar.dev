"use client"

import React, { useState } from "react"
import { ChevronDown, BarChart3, Users, Settings, Mail, Lock, Network, AlertTriangle, Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface SidebarNavProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

const navSections = [
  {
    label: "Users & Access",
    items: [
      { id: "users", label: "Users", icon: Users },
      { id: "staff", label: "Active Staff", icon: Users },
      { id: "teams", label: "Teams", icon: Users },
      { id: "ip-rules", label: "IP Rules", icon: Network },
    ],
  },
  {
    label: "Security",
    items: [
      { id: "security-alerts", label: "Security Alerts", icon: AlertTriangle },
      { id: "password-policies", label: "Password Policies", icon: Lock },
      { id: "notifications", label: "Notifications", icon: AlertTriangle },
    ],
  },
  {
    label: "Communication",
    items: [
      { id: "broadcast", label: "Mass Email", icon: Mail },
      { id: "announcements", label: "Announcements", icon: Mail },
    ],
  },
  {
    label: "System",
    items: [
      { id: "settings", label: "System Settings", icon: Settings },
      { id: "audit", label: "Audit Logs", icon: BarChart3 },
    ],
  },
]

export function AdminSidebar({ activeTab, onTabChange }: SidebarNavProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Mobile toggle button */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden fixed top-4 left-4 z-50"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed md:static left-0 top-0 h-screen w-64 bg-muted/40 border-r border-border overflow-y-auto transition-transform duration-300 md:translate-x-0 z-40",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-6">
          <h2 className="text-lg font-bold text-foreground mb-8 mt-12 md:mt-0">Admin Controls</h2>

          <nav className="space-y-6">
            {navSections.map((section) => (
              <div key={section.label}>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
                  {section.label}
                </p>
                <div className="space-y-2">
                  {section.items.map((item) => {
                    const Icon = item.icon
                    const isActive = activeTab === item.id

                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          onTabChange(item.id)
                          setIsOpen(false)
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                          isActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-foreground/70 hover:text-foreground hover:bg-muted/60"
                        )}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-background/50 md:hidden z-30"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
