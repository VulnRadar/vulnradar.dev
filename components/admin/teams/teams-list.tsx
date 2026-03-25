"use client"

import { useState } from "react"
import { UsersRound, Search, RefreshCw, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { PaginationControl } from "@/components/ui/pagination-control"
import { cn } from "@/lib/utils"
import { TeamCard } from "./team-card"
import type { TeamWithMembers } from "../types"

interface TeamsListProps {
  teams: TeamWithMembers[]
  loading: boolean
  onRefresh: () => void
  onTeamSelect?: (team: TeamWithMembers) => void
  page: number
  totalPages: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function TeamsList({
  teams,
  loading,
  onRefresh,
  onTeamSelect,
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: TeamsListProps) {
  const [search, setSearch] = useState("")

  const filteredTeams = teams.filter(team => {
    if (!search.trim()) return true
    const searchLower = search.toLowerCase()
    return (
      team.name.toLowerCase().includes(searchLower) ||
      team.slug.toLowerCase().includes(searchLower) ||
      team.owner_email.toLowerCase().includes(searchLower) ||
      team.owner_name?.toLowerCase().includes(searchLower)
    )
  })

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-0 pt-5 px-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <UsersRound className="h-5 w-5 text-muted-foreground" />
            Teams
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search teams..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm bg-muted/30"
              />
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="h-9 gap-1.5" 
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-5 pt-4">
        {filteredTeams.length === 0 ? (
          <div className="py-12 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-3">
              <UsersRound className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {search ? "No teams found" : "No teams yet"}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {search ? "Try a different search term" : "Teams will appear here when created"}
            </p>
          </div>
        ) : (
          <div className={cn(
            "grid gap-3 transition-opacity",
            loading && "opacity-50"
          )}>
            {filteredTeams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                onClick={() => onTeamSelect?.(team)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {filteredTeams.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <PaginationControl
              currentPage={page}
              totalPages={totalPages}
              onPageChange={onPageChange}
              pageSize={pageSize}
              onPageSizeChange={onPageSizeChange}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
