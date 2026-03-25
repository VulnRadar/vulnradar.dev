"use client"

import { useState } from "react"
import { User, Shield, Award, StickyNote, Settings, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { UserHeader } from "./user-header"
import { UserOverview } from "./user-overview"
import { UserSecurity } from "./user-security"
import { UserBadges } from "./user-badges"
import { UserNotes } from "./user-notes"
import { UserActions } from "./user-actions"
import type { UserDetail, BadgeDef, AdminUser } from "../types"
import type { AdminAction } from "@/lib/permissions-client"

type DetailTab = "overview" | "security" | "badges" | "notes" | "actions"

interface UserDetailPanelProps {
  detail: UserDetail | null
  loading: boolean
  onClose: () => void
  onAction: (userId: number, action: string, extra?: Record<string, unknown>) => Promise<void>
  onConfirmAction: (config: { title: string; description: string; confirmLabel: string; danger: boolean; action: () => Promise<void> }) => void
  actionLoading: string | null
  allBadges: BadgeDef[]
  availableActions: AdminAction[]
  canDisable: boolean
  canReset2FA: boolean
  canRevokeSessions: boolean
  canResetPassword: boolean
  canManageBadges: boolean
}

const TABS: { id: DetailTab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: User },
  { id: "security", label: "Security", icon: Shield },
  { id: "badges", label: "Badges", icon: Award },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "actions", label: "Actions", icon: Settings },
]

export function UserDetailPanel({
  detail,
  loading,
  onClose,
  onAction,
  onConfirmAction,
  actionLoading,
  allBadges,
  availableActions,
  canDisable,
  canReset2FA,
  canRevokeSessions,
  canResetPassword,
  canManageBadges,
}: UserDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("overview")

  if (loading || !detail) {
    return (
      <Card className="bg-card border-border overflow-hidden">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Card>
    )
  }

  const u = detail.user

  return (
    <Card className="bg-card border-border overflow-hidden">
      {/* Header */}
      <UserHeader
        user={u}
        onClose={onClose}
        onAction={(action) => onAction(u.id, action)}
        actionLoading={actionLoading}
        canDisable={canDisable}
      />

      {/* Tab Navigation */}
      <div className="border-b border-border px-5">
        <nav className="flex gap-1 -mb-px overflow-x-auto scrollbar-none">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap",
                activeTab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <CardContent className="p-5">
        {activeTab === "overview" && (
          <UserOverview user={u} />
        )}
        
        {activeTab === "security" && (
          <UserSecurity
            user={u}
            detail={detail}
            onAction={(action) => onAction(u.id, action)}
            actionLoading={actionLoading}
            canReset2FA={canReset2FA}
            canRevokeSessions={canRevokeSessions}
            canResetPassword={canResetPassword}
          />
        )}
        
        {activeTab === "badges" && (
          <UserBadges
            userBadges={detail.badges}
            allBadges={allBadges}
            onAwardBadge={(badgeId) => onAction(u.id, "award_badge", { badgeId })}
            onRevokeBadge={(badgeId) => onAction(u.id, "revoke_badge", { badgeId })}
            actionLoading={actionLoading}
            userId={u.id}
            canManageBadges={canManageBadges}
          />
        )}
        
        {activeTab === "notes" && (
          <UserNotes
            notes={detail.notes}
            onAddNote={(note) => onAction(u.id, "add_note", { note })}
          />
        )}
        
        {activeTab === "actions" && (
          <UserActions
            user={u}
            onAction={(action, extra) => onAction(u.id, action, extra)}
            onConfirmAction={onConfirmAction}
            actionLoading={actionLoading}
            availableActions={availableActions}
          />
        )}
      </CardContent>
    </Card>
  )
}
