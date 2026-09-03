"use client";

import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useId,
  useRef,
} from "react";
import {
  ChevronRight,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Search,
  X,
  Rows3,
  List,
  ListChecks,
  BotMessageSquare,
  Check,
  CircleHelp,
  Loader2,
} from "lucide-react";
import {
  SEVERITY_ORDER,
  SEVERITY_TONE,
} from "@/components/scanner/severity-badge";
import type { Severity, Vulnerability, Category } from "@/lib/scanner/types";
import {
  REMEDIATION_BADGE,
  REMEDIATION_STATUSES,
  REMEDIATION_LABELS,
  type RemediationStatus,
  type FindingRemediation,
} from "@/lib/scanner/remediation";
import { cn } from "@/lib/ui/utils";
import { tourAnchor } from "@/lib/tour/anchors";
import { plural, pluralize } from "@/lib/ui/plural";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { SEVERITY_PRIORITY, API } from "@/lib/config/client-constants";
import { categoryLabel, findingMatchesQuery } from "./finding-search";
import { pruneSelectionToVisible } from "./finding-selection";
import { useTeammates } from "./use-teammates";
import {
  getQueryParam,
  setQueryParam,
  useQueryParam,
  QUERY_CHANGE_EVENT,
  LOCATION_CHANGE_EVENT,
} from "@/lib/ui/url-state";

/** Query param that mirrors the selected finding, e.g. ?finding=missing-csp-header. */
const FINDING_QUERY_PARAM = "finding";

/** Filter state, mirrored into the URL so Back and a shared link both work. */
const SEV_QUERY_PARAM = "sev";
const CAT_QUERY_PARAM = "cat";
const SORT_QUERY_PARAM = "sort";
const GROUP_QUERY_PARAM = "group";
const SEARCH_QUERY_PARAM = "q";

/**
 * Where the list was scrolled to when a finding was opened. IssueDetail
 * scrolls to its own top on open (a separate, correct fix), but coming
 * back should land where you left off in the list rather than snapping to
 * its top every time -- this is what makes that possible across the
 * unmount/remount the dashboard and history pages do when swapping list
 * and detail views.
 *
 * Module-level (not component state) because it has to survive the
 * unmount, which also means it outlives any single scan's ResultsList
 * instance -- this same module is shared by every scan the tab ever
 * renders. savedListKey guards against restoring a scroll position saved
 * against a *different* scan's (or a different filtered view's) findings:
 * without it, opening a finding once and then looking at a shorter,
 * unrelated scan's results later would replay that old pixel offset,
 * clamp to the new page's max scroll, and land the new list at the
 * bottom instead of the top.
 */
let savedListScrollY = 0;
let savedListKey: string | null = null;

function listKey(findings: Vulnerability[]): string {
  return `${findings.length}:${findings[0]?.id ?? ""}`;
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
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

interface ResultsListProps {
  findings: Vulnerability[];
  onSelectIssue: (issue: Vulnerability) => void;
  /** The scanned URL. When provided (the owner's own scan view) it turns on
   *  the multi-select bulk remediation bar; omitted on demo / public / repo
   *  views, which have no per-user remediation to set. */
  scanUrl?: string;
}

export function ResultsList({
  findings,
  onSelectIssue,
  scanUrl,
}: ResultsListProps) {
  // Every filter is URL-backed. They used to be plain useState, and selecting
  // a finding swaps this whole list out for IssueDetail on both host pages, so
  // pressing Back remounted ResultsList with every filter reset to its default
  // while the scroll position was faithfully restored: you landed at an
  // arbitrary offset in a longer list, on every single finding. Params are
  // written with { replace: true } so changing a filter does not pile up
  // history entries; only the ?finding= param pushes, which is what makes Back
  // mean "close this finding". Each param is omitted at its default value, so
  // a clean scan URL stays clean and a filtered view is linkable.
  const [sevParam] = useQueryParam(SEV_QUERY_PARAM, "");
  const [catParam] = useQueryParam(CAT_QUERY_PARAM, "all");
  const [sortParam] = useQueryParam<string>(SORT_QUERY_PARAM, "");
  const [groupParam] = useQueryParam<string>(GROUP_QUERY_PARAM, "");
  const [searchQuery] = useQueryParam<string>(SEARCH_QUERY_PARAM, "");

  // The search box types into local state and lands in the URL on a short
  // delay. Writing the param per keystroke would be one history.replaceState
  // per character, which Safari rate-limits (roughly 100 calls per 30
  // seconds) and then starts dropping, so a fast typist would lose the tail
  // of their query from the URL. Filtering still reads the param, so this
  // only affects when the URL catches up, not what the list shows.
  const [searchInput, setSearchInput] = useState(searchQuery);
  const searchInputRef = useRef(searchInput);
  searchInputRef.current = searchInput;

  const activeSeverities = useMemo(() => {
    const wanted = sevParam
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is Severity =>
        (SEVERITY_ORDER as readonly string[]).includes(s),
      );
    // An empty or unparseable value means "everything", never "nothing":
    // a hand-edited URL must not be able to hide the whole report.
    return wanted.length > 0 ? new Set(wanted) : new Set(SEVERITY_ORDER);
  }, [sevParam]);
  const activeCategory = catParam as Category | "all";
  const sortAsc = sortParam === "asc";
  const grouped = groupParam !== "flat";

  const setFilterParam = useCallback((name: string, value: string | null) => {
    setQueryParam(name, value, { replace: true });
  }, []);
  const setSearchQuery = useCallback(
    (value: string) => {
      setSearchInput(value);
      setFilterParam(SEARCH_QUERY_PARAM, value || null);
    },
    [setFilterParam],
  );

  // Debounced write of the typed query. Clearing the box or restoring a
  // filter from history goes through setSearchQuery / the param sync above
  // instead, so this only ever runs behind live typing.
  useEffect(() => {
    if (searchInput === searchQuery) return;
    const t = setTimeout(
      () => setFilterParam(SEARCH_QUERY_PARAM, searchInput || null),
      250,
    );
    return () => clearTimeout(t);
  }, [searchInput, searchQuery, setFilterParam]);

  // A Back/Forward or a shared link changes the param without going through
  // the box: mirror it back so the input never disagrees with what is filtered.
  useEffect(() => {
    if (searchQuery !== searchInputRef.current) {
      setSearchInput(searchQuery);
    }
  }, [searchQuery]);
  const setActiveCategory = useCallback(
    (value: Category | "all") =>
      setFilterParam(CAT_QUERY_PARAM, value === "all" ? null : value),
    [setFilterParam],
  );
  const setActiveSeverities = useCallback(
    (next: Set<Severity>) =>
      setFilterParam(
        SEV_QUERY_PARAM,
        next.size === SEVERITY_ORDER.length
          ? null
          : SEVERITY_ORDER.filter((s) => next.has(s)).join(","),
      ),
    [setFilterParam],
  );
  const setSortAsc = useCallback(
    (asc: boolean) => setFilterParam(SORT_QUERY_PARAM, asc ? "asc" : null),
    [setFilterParam],
  );
  const setGrouped = useCallback(
    (on: boolean) => setFilterParam(GROUP_QUERY_PARAM, on ? null : "flat"),
    [setFilterParam],
  );

  // Bulk remediation (owner scan only). `selected` holds finding ids; `overlay`
  // lets a bulk change repaint row badges immediately without a parent refetch
  // (effective remediation = overlay value if present, else the finding's
  // server-attached one; a null overlay value means "cleared to open").
  const selectable = Boolean(scanUrl);
  // Selection is opt-in: the list stays clean (no checkboxes) until the owner
  // turns on "Select". Only then do row checkboxes and the bulk bar appear.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overlay, setOverlay] = useState<
    Map<string, FindingRemediation | null>
  >(new Map());
  const [bulkStatus, setBulkStatus] =
    useState<RemediationStatus>("in_progress");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkDue, setBulkDue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState(false);
  const teammates = useTeammates();
  const bulkAssigneeListId = useId();
  const showCheckboxes = selectable && selectMode;

  function exitSelectMode() {
    setSelectMode(false);
    clearSelection();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // The remediation a row should show: a local bulk overlay wins over the
  // server-attached value so badges update the instant a bulk change applies.
  function effectiveRemediation(
    issue: Vulnerability,
  ): FindingRemediation | null {
    return overlay.has(issue.id)
      ? (overlay.get(issue.id) ?? null)
      : (issue.remediation ?? null);
  }

  async function applyBulk() {
    if (!scanUrl || visibleSelected.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkError(false);
    const ids = [...visibleSelected];
    try {
      const body: {
        items: { findingId: string; findingUrl: string }[];
        status: RemediationStatus;
        assignee?: string;
        dueAt?: string;
      } = {
        items: ids.map((id) => ({ findingId: id, findingUrl: scanUrl })),
        status: bulkStatus,
      };
      // Only send assignee/dueAt when actually set, so the bulk change leaves
      // per-finding values it wasn't meant to touch alone (the server treats an
      // absent field as "keep existing").
      if (bulkAssignee.trim()) body.assignee = bulkAssignee.trim();
      if (bulkDue) body.dueAt = bulkDue;

      const res = await fetch(API.SCAN_REMEDIATION_BULK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("bulk failed");

      // Repaint the affected rows locally (no parent refetch needed).
      setOverlay((prev) => {
        const next = new Map(prev);
        for (const id of ids) {
          if (bulkStatus === "open") {
            next.set(id, null);
          } else {
            const base = next.has(id)
              ? next.get(id)
              : findings.find((f) => f.id === id)?.remediation;
            next.set(id, {
              status: bulkStatus,
              note: base?.note ?? null,
              assignee: bulkAssignee.trim() || base?.assignee || null,
              dueAt: bulkDue || base?.dueAt || null,
            });
          }
        }
        return next;
      });
      clearSelection();
    } catch {
      setBulkError(true);
    } finally {
      setBulkBusy(false);
    }
  }

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
    window.addEventListener(LOCATION_CHANGE_EVENT, selectFromUrl);
    window.addEventListener("popstate", selectFromUrl);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onQueryChange);
      window.removeEventListener(LOCATION_CHANGE_EVENT, selectFromUrl);
      window.removeEventListener("popstate", selectFromUrl);
    };
  }, [selectFromUrl]);

  // Restores the scroll position saved in handleSelectIssue below, the
  // moment this list reappears after IssueDetail's onBack unmounts it --
  // but only when it's the same findings list that scroll was saved
  // against (see savedListKey's comment above).
  useEffect(() => {
    if (savedListScrollY > 0 && savedListKey === listKey(findings)) {
      window.scrollTo(0, savedListScrollY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectIssue = useCallback(
    (issue: Vulnerability) => {
      savedListScrollY = window.scrollY;
      savedListKey = listKey(findings);
      setQueryParam(FINDING_QUERY_PARAM, issue.id);
      onSelectIssue(issue);
    },
    [onSelectIssue, findings],
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
    const next = new Set(activeSeverities);
    if (next.has(severity)) {
      // Never let the last severity be turned off: an empty filter set is a
      // blank report with no obvious way back.
      if (next.size > 1) next.delete(severity);
    } else {
      next.add(severity);
    }
    setActiveSeverities(next);
  }

  const filtered = useMemo(() => {
    let result = findings.filter((f) => activeSeverities.has(f.severity));
    if (activeCategory !== "all") {
      result = result.filter((f) => f.category === activeCategory);
    }
    if (searchQuery.trim()) {
      // The predicate (title, description, check id, category key and label)
      // lives in ./finding-search so it can be tested without a DOM.
      result = result.filter((f) => findingMatchesQuery(f, searchQuery));
    }
    return [...result].sort((a, b) => {
      // A finding the owner marked a false positive is already excluded from
      // the summary counts and the danger score server-side
      // (lib/scanner/recompute-scan-score.ts), so leaving it ranked among the
      // live findings made the card and this list contradict each other. It
      // sorts last instead of being hidden: the verdict is triage, not a
      // delete, and a finding that vanished would leave no way to undo it.
      if (Boolean(a.suppressed) !== Boolean(b.suppressed)) {
        return a.suppressed ? 1 : -1;
      }
      const orderA = SEVERITY_PRIORITY[a.severity] ?? 0;
      const orderB = SEVERITY_PRIORITY[b.severity] ?? 0;
      if (orderA !== orderB) return sortAsc ? orderA - orderB : orderB - orderA;

      // Within a severity band, rank by how exploitable the issue actually
      // is. The scanner already computes all three of these signals and the
      // list previously ignored every one of them, falling straight through
      // to an alphabetical tie-break: a CVE under active exploitation sorted
      // no higher than a theoretical one with a similar title. A security
      // report's job is to say what to fix first, so order by:
      //   1. presence in CISA KEV (known exploited in the wild)
      //   2. EPSS (probability of exploitation in the next 30 days)
      //   3. CVSS base score
      // and only then by title, so the order stays stable when nothing
      // distinguishes two findings.
      const kevA = a.inKev ? 1 : 0;
      const kevB = b.inKev ? 1 : 0;
      if (kevA !== kevB) return kevB - kevA;

      const epssA = a.epssScore ?? -1;
      const epssB = b.epssScore ?? -1;
      if (epssA !== epssB) return epssB - epssA;

      const cvssA = a.cvssScore ?? -1;
      const cvssB = b.cvssScore ?? -1;
      if (cvssA !== cvssB) return cvssB - cvssA;

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

  // What the bulk bar counts and what Apply writes to: the selection narrowed
  // to the findings currently on screen. `selected` used to be used directly,
  // and it ignored the filters, so narrowing to Critical left the High picks
  // in it: the bar still counted them and Apply changed findings the reader
  // could no longer see or review. Derived rather than pruned in an effect so
  // widening a filter brings a pick back instead of having silently destroyed
  // it, and so the count can never lag a render behind the list.
  // Not wrapped in useMemo: pruneSelectionToVisible returns the input set
  // unchanged when nothing was hidden, and the React Compiler refuses to
  // preserve a manual memo whose result is not a fresh allocation, which
  // makes it skip optimizing this whole component. Plain, it is one Set walk
  // over at most a few hundred ids per render, and the compiler memoizes it
  // itself.
  const visibleSelected = pruneSelectionToVisible(
    selected,
    filtered.map((f) => f.id),
  );

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
            {...tourAnchor("findingSearch")}
            type="search"
            placeholder="Search findings or paste a check id"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search findings by keyword, check id or category"
            className={cn(
              "w-full h-9 pl-9 pr-9 rounded-md border border-border bg-card text-base sm:text-sm text-foreground placeholder:text-muted-foreground",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear filter"
              className={cn(
                // Same trick as components/scanner/inline-auth-form.tsx: the
                // after: overlay widens the tap area to 44px without growing
                // the 24px icon box, which has to stay inside the h-9 field.
                "absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors after:absolute after:-inset-2.5 hover:bg-muted hover:text-foreground",
                FOCUS_RING,
              )}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* flex-wrap, and none of the three buttons is shrink-0. The labels
            add up to roughly 390px, wider than the ~343px of content width a
            375px phone has, and with shrink-0 on every child the row pushed
            straight out of the card and scrolled the whole document
            sideways. Wrapping to a second line costs nothing and is the only
            thing that keeps the page from scrolling horizontally. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSortAsc(!sortAsc)}
            aria-label={
              sortAsc
                ? "Sort by severity, most severe first"
                : "Sort by severity, least severe first"
            }
            className={cn(
              "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground transition-colors",
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
            aria-label={
              grouped
                ? "Grouped by severity. Switch to a flat list."
                : "Flat list. Group by severity."
            }
            className={cn(
              "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border text-xs font-medium transition-colors",
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
            {/* The label names the view you are in, not an action you might
                take. Grouping is the default (see `grouped` above: it is on
                unless ?group=flat says otherwise), so a button permanently
                reading "Group by severity" described something already true
                and read as an option you had to switch on. The pressed tint
                said otherwise, and the two disagreed. aria-label carries the
                action, which is what a screen reader needs from a control
                whose visible text is a state. */}
            {grouped ? "Grouped" : "Flat list"}
          </button>

          {selectable && (
            <button
              type="button"
              onClick={() =>
                selectMode ? exitSelectMode() : setSelectMode(true)
              }
              aria-pressed={selectMode}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border text-xs font-medium transition-colors",
                selectMode
                  ? "border-primary/20 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
                FOCUS_RING,
              )}
            >
              <ListChecks className="h-3.5 w-3.5" />
              {selectMode ? "Done" : "Select"}
            </button>
          )}
        </div>
      </div>

      {/* Severity filter. Doubles as the legend: colour, name and count together. */}
      <div
        {...tourAnchor("scanSeverity")}
        className="flex overflow-x-auto rounded-xl border border-border bg-card divide-x divide-border"
      >
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
                // 64px wide below sm rather than 76px. Five severities at
                // 76px need 380px, against roughly 358px of usable width on
                // a 390px phone, so the primary triage control started the
                // page already scrolled sideways and "Critical" was the cell
                // that fell off the edge. 5 x 64 fits, and the label still
                // has room at text-[11px].
                "group relative flex-1 min-w-[64px] px-2 py-2 text-left transition-colors sm:min-w-[76px] sm:px-3",
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
              "inline-flex shrink-0 items-center gap-1.5 h-9 sm:h-7 rounded-full border px-3 sm:px-2.5 text-xs font-medium transition-colors",
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
                  "inline-flex shrink-0 items-center gap-1.5 h-9 sm:h-7 rounded-full border px-3 sm:px-2.5 text-xs font-medium transition-colors",
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

      {/* The live region is mounted unconditionally and the visible line is
          not: a region inserted at the same moment as its first text is not
          reliably announced, so filtering would silently change the list for a
          screen reader. sr-only is position:absolute, so it is not a flex item
          and costs no gap. */}
      <p className="sr-only" aria-live="polite">
        {isFiltered
          ? `Showing ${filtered.length} of ${pluralize(findings.length, "finding")}`
          : ""}
      </p>

      {/* This line is the filter's readout, so it speaks only while a filter is
          narrowing the set. It used to print the unfiltered total too, which
          the "Findings" section header states already: the same number landed
          on screen twice with nothing between them but the pill row. */}
      {(isFiltered || aiCounts.verified > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
          {isFiltered && (
            <p className="text-muted-foreground">
              Showing{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {filtered.length}
              </span>{" "}
              of <span className="tabular-nums">{findings.length}</span>{" "}
              {plural(findings.length, "finding")}
            </p>
          )}
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
      )}

      {/* Findings */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          size="sm"
          title="Nothing matches those filters"
          description={`${pluralize(findings.length, "finding")} ${findings.length === 1 ? "is" : "are"} hidden. Clear the search box or turn a severity back on.`}
          action={
            <Button
              variant="outline"
              size="sm"
              className="h-8 bg-transparent text-xs"
              onClick={() => {
                setSearchQuery("");
                setActiveCategory("all");
                setActiveSeverities(new Set(SEVERITY_ORDER));
              }}
            >
              Reset filters
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div
              key={group.severity ?? "all"}
              className="overflow-hidden rounded-xl border border-border bg-card"
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
                {/* The checkbox is drawn inside the row, not beside it. It
                    used to be a bare <input> in a sibling div, so in select
                    mode every row grew a floating square in the left margin,
                    outside the row's own hover/selected surface and pushing
                    the severity rail off the card edge. The row is one control
                    either way: a link out to the finding normally, a checkbox
                    in select mode. */}
                {group.items.map((issue) => (
                  <li key={issue.id}>
                    <FindingRow
                      issue={issue}
                      showSeverity={!group.severity}
                      // In select mode the row toggles selection instead of
                      // opening the finding. It used to navigate: opening a
                      // finding unmounts this whole list (see the docblock on
                      // handleSelectIssue's scroll save), and `selected` is
                      // local state with nowhere to persist, so one mis-tap on
                      // a long list silently threw the whole selection away.
                      // "Done" is the way out of select mode and back to
                      // opening findings.
                      onSelect={
                        showCheckboxes
                          ? (i) => toggleSelect(i.id)
                          : handleSelectIssue
                      }
                      selectable={showCheckboxes}
                      selected={
                        showCheckboxes
                          ? visibleSelected.has(issue.id)
                          : undefined
                      }
                      remediation={effectiveRemediation(issue)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {showCheckboxes && visibleSelected.size > 0 && (
        <div
          // The sticky offset adds --vr-cookie-h: the cookie notice is fixed
          // at the bottom, z-60 against this bar's z-20, and roughly 125px
          // tall on a phone, so a first-time visitor doing bulk triage had
          // the whole bar parked behind it. A sticky bottom offset is
          // measured from the viewport edge, same as a fixed one, so the
          // variable works here.
          className="sticky bottom-[calc(0.75rem+var(--vr-cookie-h,0px))] z-20 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/50 bg-card px-4 py-3 shadow-lg backdrop-blur-xs transition-[bottom] duration-300"
        >
          {/* Icon tile plus a text-sm label, matching the unsaved-changes bar
              in components/admin/features/system-settings-manager.tsx. Both
              are the same kind of object, a floating bar that appears when you
              have pending work and offers to commit or discard it, and they
              looked nothing like each other: this one opened with a bare
              text-xs count and ran straight into a native select. */}
          <span className="flex items-center gap-3">
            <span className="rounded-lg bg-primary/10 p-1.5">
              <ListChecks
                className="h-3.5 w-3.5 text-primary"
                aria-hidden="true"
              />
            </span>
            <span className="text-sm font-medium text-foreground">
              {visibleSelected.size} selected
            </span>
          </span>
          <select
            aria-label="Set status for selected findings"
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as RemediationStatus)}
            className={cn(
              "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground",
              FOCUS_RING,
            )}
          >
            {REMEDIATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {REMEDIATION_LABELS[s]}
              </option>
            ))}
          </select>
          {bulkStatus !== "open" && (
            <>
              <input
                type="text"
                aria-label="Assignee for selected findings"
                list={teammates.length > 0 ? bulkAssigneeListId : undefined}
                value={bulkAssignee}
                onChange={(e) => setBulkAssignee(e.target.value)}
                maxLength={120}
                placeholder="Assignee (optional)"
                className={cn(
                  "h-8 w-36 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground",
                  FOCUS_RING,
                )}
              />
              {teammates.length > 0 && (
                <datalist id={bulkAssigneeListId}>
                  {teammates.map((t) => (
                    <option key={t.id} value={t.name || t.email} />
                  ))}
                </datalist>
              )}
              <input
                type="date"
                aria-label="Due date for selected findings"
                value={bulkDue}
                onChange={(e) => setBulkDue(e.target.value)}
                className={cn(
                  "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground",
                  FOCUS_RING,
                )}
              />
            </>
          )}
          {/* The actions sit right, after an auto margin, so the bar reads
              count on the left and commit/dismiss on the right whatever the
              middle controls are. Real Buttons rather than hand-rolled ones:
              the previous pair reimplemented the primary and ghost variants
              at slightly the wrong height and weight. */}
          <span className="ms-auto flex items-center gap-2">
            <Button
              size="sm"
              onClick={applyBulk}
              disabled={bulkBusy}
              className="h-8 gap-1.5"
            >
              {bulkBusy && (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              )}
              Apply
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="h-8 gap-1.5"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Cancel</span>
            </Button>
          </span>
          {bulkError && (
            <span className="text-xs text-[hsl(var(--severity-high))]">
              Couldn&apos;t apply. Try again.
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function FindingRow({
  issue,
  showSeverity,
  onSelect,
  selectable,
  selected,
  remediation: remediationProp,
}: {
  issue: Vulnerability;
  showSeverity: boolean;
  onSelect: (issue: Vulnerability) => void;
  /** Bulk-select mode: the row becomes a checkbox (it draws its own box and
   *  reports role="checkbox") instead of a link into the finding. */
  selectable?: boolean;
  /** Selection state in bulk-select mode. `undefined` outside select mode, so
   *  the row stays a plain button with no checked state. */
  selected?: boolean;
  /** Effective remediation for the badge. `null` means explicitly open, so it
   *  overrides issue.remediation; undefined falls back to issue.remediation. */
  remediation?: FindingRemediation | null;
}) {
  const tone = SEVERITY_TONE[issue.severity] ?? SEVERITY_TONE.info;
  const verdict = issue.aiVerdict ? AI_VERDICT[issue.aiVerdict] : null;
  const VerdictIcon = verdict?.icon;
  const remediation =
    remediationProp !== undefined
      ? remediationProp
      : (issue.remediation ?? null);
  const remediationBadge =
    remediation && remediation.status !== "open"
      ? REMEDIATION_BADGE[remediation.status]
      : null;
  // Findings the user has closed out (fixed / accepted / won't fix) dim
  // slightly so the still-open work stands out, but stay fully visible and
  // clickable. In-progress is active work, so it is not dimmed.
  const resolved =
    remediation?.status === "fixed" ||
    remediation?.status === "accepted_risk" ||
    remediation?.status === "wont_fix";
  const demoted = issue.aiVerdict === "possible_fp" || resolved;

  return (
    <button
      type="button"
      onClick={() => onSelect(issue)}
      // Every row carries the anchor, not just the first: the tour resolves an
      // anchor to the first copy with a real box, so this works whichever rows
      // a severity filter has left on screen.
      {...tourAnchor("findingRow")}
      // role="checkbox" only in select mode: the row really is a checkbox
      // there, and aria-pressed (what this used to send) describes a toggle
      // button, which is not what a screen reader should announce for a row
      // whose state a bulk action is about to act on.
      role={selectable ? "checkbox" : undefined}
      aria-checked={selectable ? !!selected : undefined}
      className={cn(
        "group relative flex w-full items-start gap-3 py-3 pl-4 pr-3 text-left transition-colors",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        // The hover tint is picked here rather than layered, because two
        // hover:bg-* utilities on one element resolve by stylesheet order,
        // not by the order they are written in.
        selected
          ? "bg-primary/10 ring-1 ring-inset ring-primary/30 hover:bg-primary/15"
          : "hover:bg-muted/40 focus-visible:bg-muted/40",
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

      {selectable && (
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-colors",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background group-hover:border-primary/60",
          )}
        >
          {selected && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
      )}

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
          <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {categoryLabel(issue.category)}
          </span>
          {remediationBadge && (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                remediationBadge.className,
              )}
            >
              {remediationBadge.label}
            </span>
          )}
          {verdict && VerdictIcon && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
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

      {/* No chevron in select mode: the row does not navigate there, and an
          arrow pointing off the card said it did. */}
      {!selectable && (
        <ChevronRight
          aria-hidden
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      )}
    </button>
  );
}
