"use client"

import { Award, Plus, X, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { UserBadge, BadgeDef } from "../types"

interface UserBadgesProps {
  userBadges: UserBadge[]
  allBadges: BadgeDef[]
  onAwardBadge: (badgeId: number) => void
  onRevokeBadge: (badgeId: number) => void
  actionLoading: string | null
  userId: number
  canManageBadges: boolean
}

export function UserBadges({ 
  userBadges, 
  allBadges, 
  onAwardBadge, 
  onRevokeBadge, 
  actionLoading,
  userId,
  canManageBadges,
}: UserBadgesProps) {
  const isLoading = (action: string) => actionLoading === `${userId}-${action}`
  const availableBadges = allBadges.filter(b => !userBadges.some(ub => ub.id === b.id))

  return (
    <div className="space-y-4">
      {/* Current Badges */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-0 pt-4 px-4">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Badges ({userBadges.length})
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          {userBadges.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No badges awarded</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {userBadges.map((badge) => (
                <div
                  key={badge.id}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors",
                    badge.color 
                      ? `bg-[${badge.color}]/10 border-[${badge.color}]/20` 
                      : "bg-primary/10 border-primary/20"
                  )}
                  style={badge.color ? { 
                    backgroundColor: `${badge.color}15`, 
                    borderColor: `${badge.color}30` 
                  } : {}}
                >
                  {badge.icon && <span className="text-sm">{badge.icon}</span>}
                  <div className="min-w-0">
                    <p className="text-xs font-medium" style={badge.color ? { color: badge.color } : {}}>
                      {badge.display_name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(badge.awarded_at).toLocaleDateString()}
                    </p>
                  </div>
                  {canManageBadges && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => onRevokeBadge(badge.id)}
                      disabled={isLoading(`revoke_badge_${badge.id}`)}
                    >
                      {isLoading(`revoke_badge_${badge.id}`) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Award New Badge */}
      {canManageBadges && availableBadges.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-0 pt-4 px-4">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Award Badge
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-3">
            <div className="flex flex-wrap gap-2">
              {availableBadges.map((badge) => (
                <Button
                  key={badge.id}
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => onAwardBadge(badge.id)}
                  disabled={isLoading(`award_badge_${badge.id}`)}
                >
                  {isLoading(`award_badge_${badge.id}`) ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    badge.icon && <span>{badge.icon}</span>
                  )}
                  {badge.display_name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
