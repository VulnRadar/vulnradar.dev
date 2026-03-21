"use client"

import { useState, useMemo } from "react"
import { ChevronRight, Filter, ArrowUpDown, Search, X } from "lucide-react"
import { SeverityBadge } from "@/components/scanner/severity-badge"
import type { Severity, Vulnerability, Category } from "@/lib/scanner/types"
import { cn } from "@/lib/utils"
import { SEVERITY_LEVELS, SEVERITY_PRIORITY } from "@/lib/constants"

const ALL_SEVERITIES: Severity[] = [
  SEVERITY_LEVELS.CRITICAL,
  SEVERITY_LEVELS.HIGH,
  SEVERITY_LEVELS.MEDIUM,
  SEVERITY_LEVELS.LOW,
  SEVERITY_LEVELS.INFO
] as Severity[]

const SEVERITY_ORDER: Record<Severity, number> = SEVERITY_PRIORITY

const SEVERITY_CONFIG: Record<Severity, { dot: string; label: string }> = {
  critical: { dot: "bg-red-500", label: "Critical" },
  high: { dot: "bg-orange-500", label: "High" },
  medium: { dot: "bg-yellow-500", label: "Medium" },
  low: { dot: "bg-blue-500", label: "Low" },
  info: { dot: "bg-muted-foreground", label: "Info" },
}

const CATEGORY_CONFIG: Record<string, { bg: string; text: string }> = {
  headers: { bg: "bg-blue-500/10", text: "text-blue-500" },
  ssl: { bg: "bg-purple-500/10", text: "text-purple-500" },
  content: { bg: "bg-amber-500/10", text: "text-amber-500" },
  cookies: { bg: "bg-orange-500/10", text: "text-orange-500" },
  configuration: { bg: "bg-cyan-500/10", text: "text-cyan-500" },
  "information-disclosure": { bg: "bg-rose-500/10", text: "text-rose-500" },
}

interface ResultsListProps {
  findings: Vulnerability[]
  onSelectIssue: (issue: Vulnerability) => void
}

export function ResultsList({ findings, onSelectIssue }: ResultsListProps) {
  const [activeSeverities, setActiveSeverities] = useState<Set<Severity>>(
    new Set(ALL_SEVERITIES),
  )
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all")
  const [sortAsc, setSortAsc] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  // Get unique categories from findings
  const categories = useMemo(() => {
    const cats = new Set<Category>()
    for (const f of findings) cats.add(f.category)
    return Array.from(cats)
  }, [findings])

  function toggleSeverity(severity: Severity) {
    setActiveSeverities((prev) => {
      const next = new Set(prev)
      if (next.has(severity)) {
        if (next.size > 1) next.delete(severity)
      } else {
        next.add(severity)
      }
      return next
    })
  }

  const filtered = useMemo(() => {
    let result = findings.filter((f) => activeSeverities.has(f.severity))
    if (activeCategory !== "all") {
      result = result.filter((f) => f.category === activeCategory)
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (f) =>
          f.title.toLowerCase().includes(query) ||
          f.description.toLowerCase().includes(query)
      )
    }
    if (sortAsc) {
      return [...result].sort(
        (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
      )
    }
    return result
  }, [findings, activeSeverities, activeCategory, sortAsc, searchQuery])

  return (
    <div className="flex flex-col gap-3">
      {/* Search and Controls */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search issues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-8 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Sort Toggle */}
        <button
          type="button"
          onClick={() => setSortAsc(!sortAsc)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border text-xs font-medium transition-colors shrink-0",
            sortAsc
              ? "bg-primary/10 border-primary/20 text-primary"
              : "bg-card border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          {sortAsc ? "Low → High" : "High → Low"}
        </button>
      </div>

      {/* Severity Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
          <Filter className="h-3.5 w-3.5" />
          <span className="font-medium">Severity</span>
        </div>
        {ALL_SEVERITIES.map((sev) => {
          const count = findings.filter((f) => f.severity === sev).length
          const active = activeSeverities.has(sev)
          const config = SEVERITY_CONFIG[sev]
          return (
            <button
              key={sev}
              type="button"
              onClick={() => toggleSeverity(sev)}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 rounded-full border px-2.5 text-xs font-medium transition-all",
                active
                  ? "bg-card border-border text-foreground shadow-sm"
                  : "bg-transparent border-transparent text-muted-foreground opacity-50 hover:opacity-75",
              )}
            >
              <span className={cn("w-2 h-2 rounded-full", config.dot)} />
              <span>{config.label}</span>
              <span className={cn(
                "tabular-nums",
                active ? "text-muted-foreground" : "text-muted-foreground/50"
              )}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Category Filter Pills */}
      {categories.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
            <span className="font-medium">Category</span>
          </div>
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 rounded-full border px-2.5 text-xs font-medium transition-all",
              activeCategory === "all"
                ? "bg-card border-border text-foreground shadow-sm"
                : "bg-transparent border-transparent text-muted-foreground opacity-50 hover:opacity-75",
            )}
          >
            All
          </button>
          {categories.map((cat) => {
            const count = findings.filter((f) => f.category === cat).length
            const config = CATEGORY_CONFIG[cat] || { bg: "bg-muted", text: "text-muted-foreground" }
            const isActive = activeCategory === cat
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(isActive ? "all" : cat)}
                className={cn(
                  "inline-flex items-center gap-1.5 h-7 rounded-full border px-2.5 text-xs font-medium transition-all capitalize",
                  isActive
                    ? cn(config.bg, "border-transparent", config.text, "shadow-sm")
                    : "bg-transparent border-transparent text-muted-foreground opacity-50 hover:opacity-75",
                )}
              >
                {cat.replace("-", " ")}
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Results Count */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          Showing <span className="font-medium text-foreground">{filtered.length}</span> of{" "}
          <span className="font-medium text-foreground">{findings.length}</span> issues
        </span>
      </div>

      {/* Issue List */}
      <div className="flex flex-col rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted/50 mb-3">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">No issues found</p>
            <p className="text-xs text-muted-foreground">
              {searchQuery ? "Try adjusting your search" : "Try changing your filters"}
            </p>
          </div>
        ) : (
          filtered.map((issue, idx) => {
            const catConfig = CATEGORY_CONFIG[issue.category] || { bg: "bg-muted", text: "text-muted-foreground" }
            return (
              <button
                key={issue.id}
                type="button"
                onClick={() => onSelectIssue(issue)}
                className={cn(
                  "group flex items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50",
                  idx === 0 && "rounded-t-xl",
                  idx === filtered.length - 1 && "rounded-b-xl"
                )}
              >
                {/* Severity indicator */}
                <div className="shrink-0">
                  <SeverityBadge severity={issue.severity} />
                </div>

                {/* Content */}
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground leading-snug line-clamp-1 group-hover:text-primary transition-colors">
                    {issue.title}
                  </span>
                  <span className="text-xs text-muted-foreground leading-relaxed line-clamp-1">
                    {issue.description}
                  </span>
                </div>

                {/* Category badge */}
                <span className={cn(
                  "hidden sm:inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize shrink-0",
                  catConfig.bg,
                  catConfig.text
                )}>
                  {issue.category.replace("-", " ")}
                </span>

                {/* Arrow */}
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 transition-all group-hover:text-foreground group-hover:translate-x-0.5" />
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
