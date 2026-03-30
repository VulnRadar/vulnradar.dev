"use client"

import { ArrowLeft, Pencil, UserPlus, MoreHorizontal, Trash2, LogOut, Check, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TEAM_ROLES } from "@/lib/config/constants"
import { type Team } from "./teams-types"

interface TeamDetailHeaderProps {
  team: Team
  currentRole: string
  memberCount: number
  editingName: boolean
  nameInput: string
  savingName: boolean
  onBack: () => void
  onEditName: () => void
  onNameInputChange: (v: string) => void
  onSaveName: () => void
  onCancelEdit: () => void
  onToggleInvite: () => void
  onDelete: () => void
  onLeave: () => void
}

export function TeamDetailHeader({
  team, currentRole, memberCount, editingName, nameInput, savingName,
  onBack, onEditName, onNameInputChange, onSaveName, onCancelEdit,
  onToggleInvite, onDelete, onLeave,
}: TeamDetailHeaderProps) {
  const canManage = currentRole === TEAM_ROLES.OWNER || currentRole === TEAM_ROLES.ADMIN

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="h-4 w-4" />Back to Teams
      </button>

      <Card className="bg-card border-border/50">
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={nameInput}
                    onChange={(e) => onNameInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSaveName()
                      if (e.key === "Escape") onCancelEdit()
                    }}
                    className="h-9 text-base font-semibold w-48 sm:w-64"
                    autoFocus
                    maxLength={50}
                  />
                  <Button size="sm" className="h-9 w-9 p-0" onClick={onSaveName} disabled={savingName}>
                    {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={onCancelEdit}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight truncate">{team.name}</h2>
                  {canManage && (
                    <button
                      type="button"
                      onClick={onEditName}
                      className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted shrink-0"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
              <p className="text-sm text-muted-foreground mt-1">
                {memberCount} member{memberCount !== 1 && "s"} · Your role:{" "}
                <span className="capitalize">{currentRole}</span>
              </p>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              {canManage && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={onToggleInvite}>
                  <UserPlus className="h-4 w-4" />
                  <span className="hidden sm:inline">Invite</span>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {currentRole === TEAM_ROLES.OWNER ? (
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                      <Trash2 className="h-4 w-4 mr-2" />Delete Team
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onLeave}>
                      <LogOut className="h-4 w-4 mr-2" />Leave Team
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
