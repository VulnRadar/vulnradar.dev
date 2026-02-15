"use client"

import { useState, useMemo } from "react"
import { ChevronRight, Filter, SortDesc, Tag } from "lucide-react"
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

const CATEGORY_COLORS: Record<string, string> = {
  headers: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  ssl: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  content: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  cookies: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  configuration: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  "information-disclosure": "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
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
    if (sortAsc) {
      return [...result].sort(
        (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
      )
    }
    return result
  }, [findings, activeSeverities, activeCategory, sortAsc])

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
          <Filter className="h-3.5 w-3.5" />
          <span className="font-medium text-xs uppercase tracking-wide">Filter</span>
        </div>
        <div className="flex flex-wrap gap-1.5 flex-1">
          {ALL_SEVERITIES.map((sev) => {
            const count = findings.filter((f) => f.severity === sev).length
            const active = activeSeverities.has(sev)
            return (
              <button
                key={sev}
                type="button"
                onClick={() => toggleSeverity(sev)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all",
                  active
                    ? "bg-card text-foreground border-border shadow-sm"
                    : "bg-transparent text-muted-foreground border-transparent opacity-40 hover:opacity-70",
                )}
              >
                <SeverityBadge severity={sev} />
                <span>{count}</span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => setSortAsc(!sortAsc)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 self-start sm:self-auto"
        >
          <SortDesc
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              sortAsc && "rotate-180",
            )}
          />
          {sortAsc ? "Low to High" : "High to Low"}
        </button>
      </div>

      {/* Category filter */}
      {categories.length > 1 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
            <Tag className="h-3.5 w-3.5" />
            <span className="font-medium text-xs uppercase tracking-wide">Category</span>
          </div>
          <div className="flex flex-wrap gap-1.5 flex-1">
            <button
              type="button"
              onClick={() => setActiveCategory("all")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all",
                activeCategory === "all"
                  ? "bg-card text-foreground border-border shadow-sm"
                  : "bg-transparent text-muted-foreground border-transparent opacity-40 hover:opacity-70",
              )}
            >
              All
              <span className="text-muted-foreground">{findings.length}</span>
            </button>
            {categories.map((cat) => {
              const count = findings.filter((f) => f.category === cat).length
              const colors = CATEGORY_COLORS[cat] || "bg-muted text-muted-foreground border-border"
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(activeCategory === cat ? "all" : cat)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all capitalize",
                    activeCategory === cat
                      ? cn(colors, "shadow-sm")
                      : "bg-transparent text-muted-foreground border-transparent opacity-40 hover:opacity-70",
                  )}
                >
                  {cat.replace("-", " ")}
                  <span>{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Issue list */}
      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-12 rounded-xl border border-dashed border-border text-sm text-muted-foreground">
            No issues match the current filters.
          </div>
        ) : (
          filtered.map((issue) => (
            <button
              key={issue.id}
              type="button"
              onClick={() => onSelectIssue(issue)}
              className="group flex items-start sm:items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all hover:bg-muted/50 hover:border-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
            >
              <div className="shrink-0 mt-0.5 sm:mt-0">
                <SeverityBadge severity={issue.severity} />
              </div>
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <span className="text-sm font-medium text-foreground leading-snug">
                  {issue.title}
                </span>
                <span className="text-xs text-muted-foreground leading-relaxed line-clamp-2 sm:line-clamp-1">
                  {issue.description}
                </span>
              </div>
              <span className="hidden sm:inline-flex items-center rounded-lg bg-muted px-2 py-0.5 text-xs text-muted-foreground capitalize shrink-0">
                {issue.category.replace("-", " ")}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5 mt-0.5 sm:mt-0" />
            </button>
          ))
        )}
      </div>
    </div>
  )
}
