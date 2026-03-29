"use client"

import { Search, Filter, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface HistoryFiltersProps {
  filter: string
  onFilterChange: (value: string) => void
  tagFilter: string | null
  onTagFilterChange: (value: string | null) => void
  allTags: string[]
  onClearHistory: () => void
  clearing: boolean
}

export function HistoryFilters({
  filter,
  onFilterChange,
  tagFilter,
  onTagFilterChange,
  allTags,
  onClearHistory,
  clearing,
}: HistoryFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by URL..."
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          className="pl-9 bg-card/50 h-10"
        />
      </div>

      {allTags.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 bg-transparent h-10 shrink-0">
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">{tagFilter || "All Tags"}</span>
              <span className="sm:hidden">Tags</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onTagFilterChange(null)}>
              All Tags
            </DropdownMenuItem>
            {allTags.map((tag) => (
              <DropdownMenuItem key={tag} onClick={() => onTagFilterChange(tag)}>
                {tag}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={onClearHistory}
        disabled={clearing}
        className="text-destructive hover:text-destructive shrink-0 bg-transparent h-10"
      >
        <Trash2 className="h-4 w-4 sm:mr-2" />
        <span className="hidden sm:inline">{clearing ? "Clearing..." : "Clear All"}</span>
      </Button>
    </div>
  )
}
