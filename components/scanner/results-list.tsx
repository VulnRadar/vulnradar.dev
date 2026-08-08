"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  ChevronRight,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Search,
  X,
  Rows3,
  List,
  BotMessageSquare,
  Check,
  CircleHelp,
} from "lucide-react";
import {
  SEVERITY_ORDER,
  SEVERITY_TONE,
} from "@/components/scanner/severity-badge";
import type { Severity, Vulnerability, Category } from "@/lib/scanner/types";
import { cn } from "@/lib/ui/utils";
import { SEVERITY_PRIORITY } from "@/lib/config/constants";
import {
  getQueryParam,
  setQueryParam,
  QUERY_CHANGE_EVENT,
} from "@/lib/ui/url-state";

/** Query param that mirrors the selected finding, e.g. ?finding=missing-csp-header. */
const FINDING_QUERY_PARAM = "finding";

/**
 * Where the list was scrolled to when a finding was opened. IssueDetail
 * scrolls to its own top on open (a separate, correct fix), but coming
 * back should land where you left off in the list rather than snapping to
 * its top every time -- this is what makes that possible across the
 * unmount/remount the dashboard and history pages do when swapping list
 * and detail views.
 */
let savedListScrollY = 0;

const CATEGORY_LABEL: Record<string, string> = {
  headers: "Headers",
  ssl: "SSL",
  tls: "TLS",
  content: "Content",
  cookies: "Cookies",
  configuration: "Config",
  "information-disclosure": "Info disclosure",
  dns: "DNS",
  email: "Email",
  api: "API",
  code: "Code",
  "secrets-extended": "Secrets",
  "vibe-code": "AI code",
  "client-side": "Client-side",
  "supply-chain": "Supply chain",
  "host-validation": "Host validation",
};

function categoryLabel(cat: string) {
  return CATEGORY_LABEL[cat] || cat.replace(/-/g, " ");
}

const AI_VERDICT: Record<
  NonNullable<Vulnerability["aiVerdict"]>,
  { label: string; chip: string; icon: typeof Check }
> = {
  confirmed: {
    label: "Confirmed",
    chip: "bg-primary/10 text-primary border-primary/20",
    icon: Check,
  },
  possible_fp: {
    label: "Possible false positive",
    chip: "bg-muted text-muted-foreground border-border",
    icon: CircleHelp,
  },
  uncertain: {
    label: "Unverified",
    chip: "bg-muted text-muted-foreground border-border",
    icon: CircleHelp,
  },
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

interface ResultsListProps {
  findings: Vulnerability[];
  onSelectIssue: (issue: Vulnerability) => void;
}

export function ResultsList({ findings, onSelectIssue }: ResultsListProps) {
  const [activeSeverities, setActiveSeverities] = useState<Set<Severity>>(
    new Set(SEVERITY_ORDER),
  );
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [sortAsc, setSortAsc] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Deep-linkable selection: the list itself is only ever mounted while no
  // finding is selected (the dashboard and history pages both swap it out
  // for IssueDetail once onSelectIssue fires), so this is the one place
  // that can notice a ?finding=<id> already in the URL - on first mount
  // (page load or refresh) and on every later change (back/forward, or
  // another tab writing the same URL) - and re-select it without either
  // page needing its own copy of this lookup.
  const selectFromUrl = useCallback(() => {
    const id = getQueryParam(FINDING_QUERY_PARAM);
    if (!id) return;
    const match = findings.find((f) => f.id === id);
    if (match) onSelectIssue(match);
  }, [findings, onSelectIssue]);

  useEffect(() => {
    selectFromUrl();
    const onQueryChange = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (detail.key === FINDING_QUERY_PARAM) selectFromUrl();
    };
    window.addEventListener(QUERY_CHANGE_EVENT, onQueryChange);
    window.addEventListener("popstate", selectFromUrl);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onQueryChange);
      window.removeEventListener("popstate", selectFromUrl);
    };
  }, [selectFromUrl]);

  // Restores the scroll position saved in handleSelectIssue below, the
  // moment this list reappears after IssueDetail's onBack unmounts it.
  useEffect(() => {
    if (savedListScrollY > 0) {
      window.scrollTo(0, savedListScrollY);
    }
  }, []);

  const handleSelectIssue = useCallback(
    (issue: Vulnerability) => {
      savedListScrollY = window.scrollY;
      setQueryParam(FINDING_QUERY_PARAM, issue.id);
      onSelectIssue(issue);
    },
    [onSelectIssue],
  );

  const severityCounts = useMemo(() => {
    const counts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    } as Record<Severity, number>;
    for (const f of findings)
      counts[f.severity] = (counts[f.severity] || 0) + 1;
    return counts;
  }, [findings]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<Category, number>();
    for (const f of findings)
      counts.set(f.category, (counts.get(f.category) || 0) + 1);
    return counts;
  }, [findings]);

  const aiCounts = useMemo(() => {
    let verified = 0;
    let falsePositive = 0;
    for (const f of findings) {
      if (f.aiVerdict) verified++;
      if (f.aiVerdict === "possible_fp") falsePositive++;
    }
    return { verified, falsePositive };
  }, [findings]);

  function toggleSeverity(severity: Severity) {
    setActiveSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(severity)) {
        if (next.size > 1) next.delete(severity);
      } else {
        next.add(severity);
      }
      return next;
    });
  }

  const filtered = useMemo(() => {
    let result = findings.filter((f) => activeSeverities.has(f.severity));
    if (activeCategory !== "all") {
      result = result.filter((f) => f.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.title.toLowerCase().includes(query) ||
          f.description.toLowerCase().includes(query),
      );
    }
    return [...result].sort((a, b) => {
      const orderA = SEVERITY_PRIORITY[a.severity] ?? 0;
      const orderB = SEVERITY_PRIORITY[b.severity] ?? 0;
      if (orderA !== orderB) return sortAsc ? orderA - orderB : orderB - orderA;
      return a.title.localeCompare(b.title);
    });
  }, [findings, activeSeverities, activeCategory, sortAsc, searchQuery]);

  const groups = useMemo(() => {
    if (!grouped)
      return [{ severity: null as Severity | null, items: filtered }];
    const order = sortAsc ? [...SEVERITY_ORDER].reverse() : SEVERITY_ORDER;
    return order
      .map((severity) => ({
        severity,
        items: filtered.filter((f) => f.severity === severity),
      }))
      .filter((g) => g.items.length > 0);
  }, [filtered, grouped, sortAsc]);

  const categories = useMemo(
    () => Array.from(categoryCounts.keys()),
    [categoryCounts],
  );
  const isFiltered =
    filtered.length !== findings.length ||
    activeCategory !== "all" ||
    searchQuery.trim().length > 0;

  return (
    <section className="flex flex-col gap-3" aria-label="Scan findings">
      {/* Search + view controls */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
          />
          <input
            type="search"
            placeholder="Filter by title or description"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Filter findings by keyword"
            className={cn(
              "w-full h-9 pl-9 pr-9 rounded-md border border-border bg-card text-base sm:text-sm text-foreground placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear filter"
              className={cn(
                "absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
                FOCUS_RING,
              )}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSortAsc(!sortAsc)}
            aria-label={
              sortAsc
                ? "Sort by severity, most severe first"
                : "Sort by severity, least severe first"
            }
            className={cn(
              "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0",
              FOCUS_RING,
            )}
          >
            {sortAsc ? (
              <ArrowUpNarrowWide className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
            )}
            {sortAsc ? "Least severe first" : "Most severe first"}
          </button>

          <button
            type="button"
            onClick={() => setGrouped(!grouped)}
            aria-pressed={grouped}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border text-xs font-medium transition-colors shrink-0",
              grouped
                ? "border-primary/20 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
              FOCUS_RING,
            )}
          >
            {grouped ? (
              <Rows3 className="h-3.5 w-3.5" />
            ) : (
              <List className="h-3.5 w-3.5" />
            )}
            Group by severity
          </button>
        </div>
      </div>

      {/* Severity filter. Doubles as the legend: colour, name and count together. */}
      <div className="flex overflow-x-auto rounded-md border border-border bg-card divide-x divide-border">
        {SEVERITY_ORDER.map((sev) => {
          const count = severityCounts[sev] || 0;
          const active = activeSeverities.has(sev);
          const tone = SEVERITY_TONE[sev];
          return (
            <button
              key={sev}
              type="button"
              onClick={() => toggleSeverity(sev)}
              aria-pressed={active}
              className={cn(
                "group relative flex-1 min-w-[76px] px-3 py-2 text-left transition-colors",
                active ? "bg-transparent" : "bg-muted/40",
                "hover:bg-muted/60",
                FOCUS_RING,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-0 top-0 h-0.5 transition-opacity",
                  tone.solid,
                  active && count > 0 ? "opacity-100" : "opacity-25",
                )}
              />
              <span
                className={cn(
                  "block text-lg font-semibold tabular-nums leading-none",
                  count === 0
                    ? "text-muted-foreground/40"
                    : active
                      ? tone.text
                      : "text-muted-foreground/60",
                )}
              >
                {count}
              </span>
              <span
                className={cn(
                  "mt-1 block text-[11px]",
                  active ? "text-muted-foreground" : "text-muted-foreground/50",
                )}
              >
                {tone.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Category filter */}
      {categories.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            aria-pressed={activeCategory === "all"}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 h-7 rounded-full border px-2.5 text-xs font-medium transition-colors",
              activeCategory === "all"
                ? "border-primary/20 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
              FOCUS_RING,
            )}
          >
            All categories
            <span className="tabular-nums opacity-70">{findings.length}</span>
          </button>
          {categories.map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(isActive ? "all" : cat)}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 h-7 rounded-full border px-2.5 text-xs font-medium transition-colors",
                  isActive
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                  FOCUS_RING,
                )}
              >
                {categoryLabel(cat)}
                <span className="tabular-nums opacity-70">
                  {categoryCounts.get(cat)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Count + AI verification line */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <p className="text-muted-foreground" aria-live="polite">
          <span className="font-semibold text-foreground tabular-nums">
            {filtered.length}
          </span>{" "}
          {filtered.length === 1 ? "finding" : "findings"}
          {isFiltered && (
            <>
              {" of "}
              <span className="tabular-nums">{findings.length}</span>
            </>
          )}
        </p>
        {aiCounts.verified > 0 && (
          <p className="inline-flex items-center gap-1.5 text-muted-foreground">
            <BotMessageSquare
              aria-hidden
              className="h-3.5 w-3.5 text-primary"
            />
            AI checked{" "}
            <span className="font-medium text-foreground tabular-nums">
              {aiCounts.verified}
            </span>{" "}
            against the live site
            {aiCounts.falsePositive > 0 && (
              <>
                {", "}
                <span className="font-medium text-foreground tabular-nums">
                  {aiCounts.falsePositive}
                </span>{" "}
                may not apply
              </>
            )}
          </p>
        )}
      </div>

      {/* Findings */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-card/50 px-4 py-12 text-center">
          <p className="text-sm font-medium text-foreground">
            Nothing matches those filters
          </p>
          <p className="max-w-xs text-xs text-muted-foreground">
            {findings.length} {findings.length === 1 ? "finding" : "findings"}{" "}
            {findings.length === 1 ? "is" : "are"} hidden. Clear the search box
            or turn a severity back on.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setActiveCategory("all");
              setActiveSeverities(new Set(SEVERITY_ORDER));
            }}
            className={cn(
              "mt-1 inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors",
              FOCUS_RING,
            )}
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div
              key={group.severity ?? "all"}
              className="overflow-hidden rounded-md border border-border bg-card"
            >
              {group.severity && (
                <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                  <span
                    aria-hidden
                    className={cn(
                      "h-2.5 w-2.5 rounded-full shrink-0",
                      SEVERITY_TONE[group.severity].solid,
                    )}
                  />
                  <h3
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wide",
                      SEVERITY_TONE[group.severity].text,
                    )}
                  >
                    {SEVERITY_TONE[group.severity].label}
                  </h3>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {group.items.length}
                  </span>
                </div>
              )}
              <ul className="divide-y divide-border">
                {group.items.map((issue) => (
                  <li key={issue.id}>
                    <FindingRow
                      issue={issue}
                      showSeverity={!group.severity}
                      onSelect={handleSelectIssue}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FindingRow({
  issue,
  showSeverity,
  onSelect,
}: {
  issue: Vulnerability;
  showSeverity: boolean;
  onSelect: (issue: Vulnerability) => void;
}) {
  const tone = SEVERITY_TONE[issue.severity] ?? SEVERITY_TONE.info;
  const verdict = issue.aiVerdict ? AI_VERDICT[issue.aiVerdict] : null;
  const VerdictIcon = verdict?.icon;
  const demoted = issue.aiVerdict === "possible_fp";

  return (
    <button
      type="button"
      onClick={() => onSelect(issue)}
      className={cn(
        "group relative flex w-full items-start gap-3 py-3 pl-4 pr-3 text-left transition-colors hover:bg-muted/40",
        "focus-visible:outline-none focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        demoted && "opacity-70 hover:opacity-100 focus-visible:opacity-100",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          tone.solid,
          tone.emphasis === "quiet" && "opacity-40",
        )}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {showSeverity && (
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wide",
                tone.text,
              )}
            >
              {tone.label}
            </span>
          )}
          <span
            className={cn(
              "text-sm leading-snug text-foreground line-clamp-2 group-hover:text-primary transition-colors",
              tone.emphasis === "loud" && "font-semibold",
              tone.emphasis === "normal" && "font-medium",
              tone.emphasis === "quiet" && "font-normal text-muted-foreground",
            )}
          >
            {issue.title}
          </span>
        </div>

        <span className="text-xs leading-relaxed text-muted-foreground line-clamp-1">
          {issue.description}
        </span>

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {categoryLabel(issue.category)}
          </span>
          {verdict && VerdictIcon && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
                verdict.chip,
              )}
              title={issue.aiReason}
            >
              <VerdictIcon aria-hidden className="h-2.5 w-2.5" />
              AI: {verdict.label}
            </span>
          )}
        </div>
      </div>

      <ChevronRight
        aria-hidden
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
      />
    </button>
  );
}
