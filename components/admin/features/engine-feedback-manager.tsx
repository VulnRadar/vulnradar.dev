"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Gauge,
  Sparkles,
  Search,
  RefreshCw,
  AlertTriangle,
  ArrowUpCircle,
  ExternalLink,
} from "lucide-react";
import {
  EmptyState,
  DataTableSkeleton,
  TableScrollArea,
  SortableHeader,
  nextSortDirection,
  Toast,
  type SortDirection,
} from "@/components/admin/shared";
import type { ToastState } from "@/components/admin/types";
import { SeverityBadge, toSeverity } from "@/components/scanner/severity-badge";
import { useModalA11y } from "@/lib/hooks/use-modal-a11y";
import { cn } from "@/lib/ui/utils";

interface AiTagCandidateExample {
  scanId: number;
  url: string;
  scannedAt: string;
}

interface AiTagCandidateSuggestion {
  cwes: string[];
  categories: string[];
  minSeverity: string;
}

interface AiTagCandidateEntry {
  tag: string;
  scanCount: number;
  userCount: number;
  examples: AiTagCandidateExample[];
  suggested: AiTagCandidateSuggestion;
}

interface CheckAccuracyEntry {
  checkId: string;
  title: string;
  category: string | null;
  severity: string | null;
  confirmed: number;
  falsePositive: number;
  notApplicable: number;
  total: number;
  falsePositiveRate: number;
  flagged: boolean;
}

interface TagDismissalEntry {
  tag: string;
  totalFired: number;
  dismissedCount: number;
  dismissalRate: number;
  flagged: boolean;
}

type CheckSortColumn = "title" | "category" | "total" | "falsePositiveRate";
type TagSortColumn = "tag" | "totalFired" | "dismissalRate";

function FlaggedBadge({ flagged }: { flagged: boolean }) {
  if (!flagged) return null;
  return (
    <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] px-1.5 py-0.5 font-medium gap-1">
      <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
      Flagged
    </Badge>
  );
}

/**
 * Admin > System > Engine Feedback. NOT a machine-learning feature -- this
 * page aggregates feedback humans already gave (per-finding verdicts via
 * POST /api/v3/scan/feedback, and auto-tag dismissals via
 * app/api/v3/scan/tags/route.ts) into two read-only reports: how often a
 * check gets marked false_positive, and how often an auto-tag rule gets
 * dismissed as wrong. Nothing on this page changes detection logic --
 * a human reads the numbers and edits lib/scanner/checks-data/*.json or
 * lib/tags/auto-tags.ts by hand.
 */
export function EngineFeedbackManager() {
  const [checks, setChecks] = useState<CheckAccuracyEntry[]>([]);
  const [tags, setTags] = useState<TagDismissalEntry[]>([]);
  const [aiCandidates, setAiCandidates] = useState<AiTagCandidateEntry[]>([]);
  const [minCandidateScans, setMinCandidateScans] = useState<number | null>(
    null,
  );
  const [thresholdPercent, setThresholdPercent] = useState<number | null>(null);
  const [minSampleSize, setMinSampleSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [promoteTarget, setPromoteTarget] =
    useState<AiTagCandidateEntry | null>(null);

  const [checkSearch, setCheckSearch] = useState("");
  const [checkFlaggedOnly, setCheckFlaggedOnly] = useState(false);
  const [checkSortColumn, setCheckSortColumn] =
    useState<CheckSortColumn | null>("falsePositiveRate");
  const [checkSortDirection, setCheckSortDirection] =
    useState<SortDirection>("desc");

  const [tagFlaggedOnly, setTagFlaggedOnly] = useState(false);
  const [tagSortColumn, setTagSortColumn] = useState<TagSortColumn | null>(
    "dismissalRate",
  );
  const [tagSortDirection, setTagSortDirection] =
    useState<SortDirection>("desc");

  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    try {
      const [checksRes, tagsRes, aiCandidatesRes] = await Promise.all([
        fetch("/api/v3/admin/engine-feedback/checks"),
        fetch("/api/v3/admin/engine-feedback/tags"),
        fetch("/api/v3/admin/engine-feedback/ai-tag-candidates"),
      ]);
      if (checksRes.ok) {
        const data = await checksRes.json();
        setChecks(data.checks || []);
        setThresholdPercent(data.thresholdPercent ?? null);
        setMinSampleSize(data.minSampleSize ?? null);
      }
      if (tagsRes.ok) {
        const data = await tagsRes.json();
        setTags(data.tags || []);
      }
      if (aiCandidatesRes.ok) {
        const data = await aiCandidatesRes.json();
        setAiCandidates(data.candidates || []);
        setMinCandidateScans(data.minCandidateScans ?? null);
      }
      if (!checksRes.ok || !tagsRes.ok || !aiCandidatesRes.ok) {
        setToast({ message: "Failed to load engine feedback.", type: "error" });
      }
    } catch {
      setToast({ message: "Failed to load engine feedback.", type: "error" });
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const promoteCandidate = useCallback(
    async (fields: {
      tag: string;
      cwes: string[];
      categories: string[];
      requireBoth: boolean;
      minSeverity: string;
      minCount: number;
    }) => {
      const res = await fetch(
        "/api/v3/admin/engine-feedback/ai-tag-candidates",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setToast({
          message: data.error || "Failed to promote tag.",
          type: "error",
        });
        return;
      }
      setPromoteTarget(null);
      setToast({
        message: `"${fields.tag}" promoted to a permanent rule.`,
        type: "success",
      });
      fetchData();
    },
    [fetchData],
  );

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  const filteredChecks = useMemo(() => {
    const q = checkSearch.trim().toLowerCase();
    let rows = checks;
    if (q) {
      rows = rows.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.checkId.toLowerCase().includes(q) ||
          (c.category || "").toLowerCase().includes(q),
      );
    }
    if (checkFlaggedOnly) rows = rows.filter((c) => c.flagged);
    if (!checkSortColumn || !checkSortDirection) return rows;
    const dir = checkSortDirection === "asc" ? 1 : -1;
    const col = checkSortColumn;
    return [...rows].sort((a, b) => {
      if (col === "title") return a.title.localeCompare(b.title) * dir;
      if (col === "category")
        return (a.category || "").localeCompare(b.category || "") * dir;
      if (col === "total") return (a.total - b.total) * dir;
      return (a.falsePositiveRate - b.falsePositiveRate) * dir;
    });
  }, [
    checks,
    checkSearch,
    checkFlaggedOnly,
    checkSortColumn,
    checkSortDirection,
  ]);

  const filteredTags = useMemo(() => {
    let rows = tags;
    if (tagFlaggedOnly) rows = rows.filter((t) => t.flagged);
    if (!tagSortColumn || !tagSortDirection) return rows;
    const dir = tagSortDirection === "asc" ? 1 : -1;
    const col = tagSortColumn;
    return [...rows].sort((a, b) => {
      if (col === "tag") return a.tag.localeCompare(b.tag) * dir;
      if (col === "totalFired") return (a.totalFired - b.totalFired) * dir;
      return (a.dismissalRate - b.dismissalRate) * dir;
    });
  }, [tags, tagFlaggedOnly, tagSortColumn, tagSortDirection]);

  const flaggedCheckCount = checks.filter((c) => c.flagged).length;
  const flaggedTagCount = tags.filter((t) => t.flagged).length;

  const toggleCheckSort = (column: CheckSortColumn) => {
    const next = nextSortDirection(column, checkSortColumn, checkSortDirection);
    setCheckSortColumn(next.column as CheckSortColumn | null);
    setCheckSortDirection(next.direction);
  };
  const toggleTagSort = (column: TagSortColumn) => {
    const next = nextSortDirection(column, tagSortColumn, tagSortDirection);
    setTagSortColumn(next.column as TagSortColumn | null);
    setTagSortDirection(next.direction);
  };

  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Real feedback from real scans, rolled up so a human can decide what to
          retune. Nothing here is machine learning and nothing here changes a
          detection rule by itself: the left table is every check&apos;s share
          of false_positive verdicts from{" "}
          <code className="text-xs">scan_finding_feedback</code>, the right
          table is how often each{" "}
          <code className="text-xs">lib/tags/auto-tags.ts</code> rule gets
          dismissed as wrong.
          {thresholdPercent !== null && minSampleSize !== null && (
            <>
              {" "}
              A row is flagged at {thresholdPercent}%+ with at least{" "}
              {minSampleSize} sample{minSampleSize === 1 ? "" : "s"}, both
              configurable in Settings &gt; Advanced.
            </>
          )}
        </p>
      </div>

      {/* Check accuracy */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <CardHeader className="pb-4 pt-5 px-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <Gauge className="h-4 w-4 text-primary" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base font-semibold truncate">
                    Check Accuracy
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    False-positive rate per check, from submitted finding
                    feedback.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {flaggedCheckCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-xs font-medium h-6 px-2.5"
                  >
                    {flaggedCheckCount} flagged
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 gap-2 border-border/40"
                  onClick={() => fetchData()}
                  disabled={refreshing}
                  aria-label="Refresh engine feedback"
                >
                  <RefreshCw
                    className={cn("h-4 w-4", refreshing && "animate-spin")}
                    aria-hidden="true"
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex-1">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                  aria-hidden="true"
                />
                <Input
                  placeholder="Search by check name, id, or category..."
                  value={checkSearch}
                  onChange={(e) => setCheckSearch(e.target.value)}
                  aria-label="Search checks"
                  className="pl-9 h-10 bg-background/50 border-border/40 focus:border-primary/50"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground shrink-0 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={checkFlaggedOnly}
                  onChange={(e) => setCheckFlaggedOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                Flagged only
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <DataTableSkeleton rows={6} />
            </div>
          ) : filteredChecks.length === 0 ? (
            <EmptyState
              icon={Gauge}
              title="No check feedback yet"
              description={
                checks.length === 0
                  ? "No finding feedback has been submitted yet (POST /api/v3/scan/feedback)."
                  : "No checks match the current filter."
              }
            />
          ) : (
            <TableScrollArea maxHeight="60vh">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/90">
                  <TableRow className="border-y border-border/50 hover:bg-transparent">
                    <TableHead className="px-5 h-10">
                      <SortableHeader
                        label="Check"
                        active={checkSortColumn === "title"}
                        direction={
                          checkSortColumn === "title"
                            ? checkSortDirection
                            : null
                        }
                        onClick={() => toggleCheckSort("title")}
                      />
                    </TableHead>
                    <TableHead className="px-4 h-10">
                      <SortableHeader
                        label="Category"
                        active={checkSortColumn === "category"}
                        direction={
                          checkSortColumn === "category"
                            ? checkSortDirection
                            : null
                        }
                        onClick={() => toggleCheckSort("category")}
                      />
                    </TableHead>
                    <TableHead className="px-4 h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Severity
                    </TableHead>
                    <TableHead className="px-4 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Confirmed
                    </TableHead>
                    <TableHead className="px-4 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      False Pos.
                    </TableHead>
                    <TableHead className="px-4 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      N/A
                    </TableHead>
                    <TableHead className="px-4 h-10 text-right">
                      <SortableHeader
                        label="Total"
                        align="right"
                        active={checkSortColumn === "total"}
                        direction={
                          checkSortColumn === "total"
                            ? checkSortDirection
                            : null
                        }
                        onClick={() => toggleCheckSort("total")}
                      />
                    </TableHead>
                    <TableHead className="px-5 h-10 text-right">
                      <SortableHeader
                        label="FP Rate"
                        align="right"
                        active={checkSortColumn === "falsePositiveRate"}
                        direction={
                          checkSortColumn === "falsePositiveRate"
                            ? checkSortDirection
                            : null
                        }
                        onClick={() => toggleCheckSort("falsePositiveRate")}
                      />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredChecks.map((c) => (
                    <TableRow key={c.checkId} className="border-border/40">
                      <TableCell className="px-5 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {c.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate font-mono">
                            {c.checkId}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                        {c.category ?? "Unknown"}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        {c.severity ? (
                          <SeverityBadge severity={toSeverity(c.severity)} />
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Unknown
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm tabular-nums">
                        {c.confirmed}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm tabular-nums">
                        {c.falsePositive}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm tabular-nums text-muted-foreground">
                        {c.notApplicable}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm tabular-nums">
                        {c.total}
                      </TableCell>
                      <TableCell className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <span
                            className={cn(
                              "text-sm font-semibold tabular-nums",
                              c.flagged
                                ? "text-destructive"
                                : "text-foreground",
                            )}
                          >
                            {c.falsePositiveRate}%
                          </span>
                          <FlaggedBadge flagged={c.flagged} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Auto-tag dismissal rates */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <CardHeader className="pb-4 pt-5 px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base font-semibold truncate">
                  Auto-Tag Dismissals
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  How often each auto-tag rule (lib/tags/auto-tags.ts) gets
                  dismissed as wrong on a scan.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {flaggedTagCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-xs font-medium h-6 px-2.5"
                >
                  {flaggedTagCount} flagged
                </Badge>
              )}
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={tagFlaggedOnly}
                  onChange={(e) => setTagFlaggedOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                Flagged only
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <DataTableSkeleton rows={4} />
            </div>
          ) : filteredTags.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No auto-tag activity yet"
              description={
                tags.length === 0
                  ? "No auto tag has fired or been dismissed yet."
                  : "No rules match the current filter."
              }
            />
          ) : (
            <TableScrollArea maxHeight="40vh">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/90">
                  <TableRow className="border-y border-border/50 hover:bg-transparent">
                    <TableHead className="px-5 h-10">
                      <SortableHeader
                        label="Tag"
                        active={tagSortColumn === "tag"}
                        direction={
                          tagSortColumn === "tag" ? tagSortDirection : null
                        }
                        onClick={() => toggleTagSort("tag")}
                      />
                    </TableHead>
                    <TableHead className="px-4 h-10 text-right">
                      <SortableHeader
                        label="Total Fired"
                        align="right"
                        active={tagSortColumn === "totalFired"}
                        direction={
                          tagSortColumn === "totalFired"
                            ? tagSortDirection
                            : null
                        }
                        onClick={() => toggleTagSort("totalFired")}
                      />
                    </TableHead>
                    <TableHead className="px-4 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Dismissed
                    </TableHead>
                    <TableHead className="px-5 h-10 text-right">
                      <SortableHeader
                        label="Dismissal Rate"
                        align="right"
                        active={tagSortColumn === "dismissalRate"}
                        direction={
                          tagSortColumn === "dismissalRate"
                            ? tagSortDirection
                            : null
                        }
                        onClick={() => toggleTagSort("dismissalRate")}
                      />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTags.map((t) => (
                    <TableRow key={t.tag} className="border-border/40">
                      <TableCell className="px-5 py-3 text-sm font-medium">
                        {t.tag}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm tabular-nums">
                        {t.totalFired}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm tabular-nums">
                        {t.dismissedCount}
                      </TableCell>
                      <TableCell className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <span
                            className={cn(
                              "text-sm font-semibold tabular-nums",
                              t.flagged
                                ? "text-destructive"
                                : "text-foreground",
                            )}
                          >
                            {t.dismissalRate}%
                          </span>
                          <FlaggedBadge flagged={t.flagged} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScrollArea>
          )}
        </CardContent>
      </Card>

      {/* AI tag candidates */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <CardHeader className="pb-4 pt-5 px-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <ArrowUpCircle
                className="h-4 w-4 text-primary"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold truncate">
                AI Tag Candidates
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tags lib/ai/auto-tag-suggest.ts generated for a scan that
                matched none of the built-in rules, grouped by tag text.
                {minCandidateScans !== null && (
                  <>
                    {" "}
                    Only shown once a tag has appeared on {minCandidateScans}+
                    distinct scans.
                  </>
                )}{" "}
                Promoting one saves it as a permanent, free, deterministic rule.
                No more AI calls needed for that concept.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <DataTableSkeleton rows={3} />
            </div>
          ) : aiCandidates.length === 0 ? (
            <EmptyState
              icon={ArrowUpCircle}
              title="No AI tag candidates yet"
              description="No AI-generated tag has recurred on enough distinct scans to surface here yet."
            />
          ) : (
            <TableScrollArea maxHeight="40vh">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/90">
                  <TableRow className="border-y border-border/50 hover:bg-transparent">
                    <TableHead className="px-5 h-10">Tag</TableHead>
                    <TableHead className="px-4 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Scans
                    </TableHead>
                    <TableHead className="px-4 h-10 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Users
                    </TableHead>
                    <TableHead className="px-4 h-10">Examples</TableHead>
                    <TableHead className="px-5 h-10 text-right">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aiCandidates.map((c) => (
                    <TableRow key={c.tag} className="border-border/40">
                      <TableCell className="px-5 py-3 text-sm font-medium">
                        {c.tag}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm tabular-nums">
                        {c.scanCount}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm tabular-nums">
                        {c.userCount}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {c.examples.map((ex) => (
                            <a
                              key={ex.scanId}
                              href={`/api/v3/history/${ex.scanId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline inline-flex items-center gap-1 w-fit"
                            >
                              {hostnameOf(ex.url)}
                              <ExternalLink
                                className="h-3 w-3 shrink-0"
                                aria-hidden="true"
                              />
                            </a>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 border-border/40"
                          onClick={() => setPromoteTarget(c)}
                        >
                          <ArrowUpCircle
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          Promote
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScrollArea>
          )}
        </CardContent>
      </Card>

      {promoteTarget && (
        <PromoteTagModal
          candidate={promoteTarget}
          onClose={() => setPromoteTarget(null)}
          onPromote={promoteCandidate}
        />
      )}

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const SEVERITY_OPTIONS = ["info", "low", "medium", "high", "critical"] as const;

/**
 * Promote-to-rule form -- deliberately simple (comma-separated text inputs
 * instead of a full multi-select widget) since this is an internal admin
 * tool used rarely, not customer-facing UI. Pre-filled from the
 * candidate's `suggested` fields (a simple frequency analysis the API
 * route already did over the candidate's own findings); the admin is
 * expected to review and adjust before saving, not accept blindly.
 */
function PromoteTagModal({
  candidate,
  onClose,
  onPromote,
}: {
  candidate: AiTagCandidateEntry;
  onClose: () => void;
  onPromote: (fields: {
    tag: string;
    cwes: string[];
    categories: string[];
    requireBoth: boolean;
    minSeverity: string;
    minCount: number;
  }) => Promise<void>;
}) {
  const [cwes, setCwes] = useState(candidate.suggested.cwes.join(", "));
  const [categories, setCategories] = useState(
    candidate.suggested.categories.join(", "),
  );
  const [requireBoth, setRequireBoth] = useState(false);
  const [minSeverity, setMinSeverity] = useState(
    candidate.suggested.minSeverity,
  );
  const [minCount, setMinCount] = useState(1);
  const [saving, setSaving] = useState(false);

  const { dialogProps, titleProps } = useModalA11y({
    open: true,
    onClose,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onPromote({
        tag: candidate.tag,
        cwes: cwes
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
        categories: categories
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
        requireBoth,
        minSeverity,
        minCount,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        {...dialogProps}
      >
        <h3
          className="text-base font-semibold text-foreground mb-1"
          {...titleProps}
        >
          Promote &quot;{candidate.tag}&quot;
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Saves this as a permanent rule in computeAutoTags. Fields below are
          pre-filled from a frequency analysis of the {candidate.scanCount} scan
          {candidate.scanCount === 1 ? "" : "s"} that produced this tag. Review
          before saving.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              CWE ids (comma-separated, e.g. CWE-79, CWE-89)
            </label>
            <Input
              value={cwes}
              onChange={(e) => setCwes(e.target.value)}
              placeholder="CWE-79, CWE-89"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Categories (comma-separated)
            </label>
            <Input
              value={categories}
              onChange={(e) => setCategories(e.target.value)}
              placeholder="dns, email"
              className="h-9 text-sm"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Minimum severity
              </label>
              <select
                value={minSeverity}
                onChange={(e) => setMinSeverity(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Minimum matching findings
              </label>
              <Input
                type="number"
                min={1}
                value={minCount}
                onChange={(e) =>
                  setMinCount(Math.max(1, Number(e.target.value) || 1))
                }
                className="h-9 text-sm"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={requireBoth}
              onChange={(e) => setRequireBoth(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Require BOTH a matching CWE and category on the same finding
            (default: either alone qualifies)
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={handleSave}
            disabled={saving || (!cwes.trim() && !categories.trim())}
          >
            <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {saving ? "Promoting..." : "Promote to Rule"}
          </Button>
        </div>
      </div>
    </div>
  );
}
