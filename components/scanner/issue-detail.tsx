"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BotMessageSquare,
  Check,
  ChevronDown,
  CircleCheck,
  CircleSlash,
  Copy,
  ExternalLink,
  Flag,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SEVERITY_TONE } from "@/components/scanner/severity-badge";
import type { Vulnerability } from "@/lib/scanner/types";
import { cn } from "@/lib/ui/utils";
import { tourAnchor } from "@/lib/tour/anchors";
import { copyToClipboard } from "@/lib/ui/clipboard";
import { API, APP_NAME } from "@/lib/config/client-constants";
import {
  REMEDIATION_STATUSES,
  REMEDIATION_LABELS,
  type RemediationStatus,
  type FindingRemediation,
} from "@/lib/scanner/remediation";
import {
  toDisplayExcerpts,
  truncateExcerpt,
  EXCERPT_PREVIEW_COUNT,
} from "@/lib/scanner/evidence-excerpts";
import { useTeammates } from "./use-teammates";
import {
  getQueryParam,
  removeQueryParam,
  QUERY_CHANGE_EVENT,
} from "@/lib/ui/url-state";

/** Same key results-list.tsx writes when a finding is selected. */
const FINDING_QUERY_PARAM = "finding";

const CATEGORY_LABEL: Record<string, string> = {
  headers: "Security headers",
  ssl: "SSL certificate",
  tls: "TLS configuration",
  content: "Content analysis",
  cookies: "Cookie security",
  configuration: "Server configuration",
  "information-disclosure": "Information disclosure",
  dns: "DNS records",
  email: "Email authentication",
  api: "API surface",
  code: "Static analysis",
  "secrets-extended": "Exposed secrets",
  "vibe-code": "AI-generated code patterns",
  "client-side": "Client-side JavaScript",
  "supply-chain": "Supply chain",
  "host-validation": "Host validation",
  reputation: "Threat reputation",
  "active-probes": "Active probing",
};

/**
 * a11y (SC 1.4.3): the first two used to paint a tinted surface UNDER their
 * own accent text, and this block sits on the page background rather than on a
 * card, so the tint composited straight over --background. On light mode that
 * measured 4.41:1 for text-primary on bg-primary/5, and 4.02:1 for the medium
 * severity on its /10, both on a 14px medium headline, i.e. normal text under
 * the 4.5:1 floor. The accent now sits on --card, where the same two colours
 * measure 5.15:1 and 5.14:1, and the tone is carried by the border instead.
 * It also lands on the rule the rest of the page follows: the severity-tinted
 * header is the only toned surface, everything under it is a neutral card.
 */
const AI_VERDICT_COPY: Record<
  NonNullable<Vulnerability["aiVerdict"]>,
  { headline: string; tone: string }
> = {
  confirmed: {
    headline: "AI probed the live site and confirmed this finding",
    tone: "border-primary/30 bg-card text-primary",
  },
  possible_fp: {
    headline: "AI thinks this one may not apply to your site",
    tone: "border-[hsl(var(--severity-medium))]/40 bg-card text-[hsl(var(--severity-medium))]",
  },
  uncertain: {
    headline: "AI could not reach a verdict, review this one by hand",
    tone: "border-border bg-muted text-muted-foreground",
  },
};

const FOCUS_RING =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

const EVIDENCE_PREVIEW_LINES = 8;

type FeedbackVerdict = "confirmed" | "false_positive" | "not_applicable";

const FEEDBACK_OPTIONS: {
  verdict: FeedbackVerdict;
  label: string;
  icon: typeof Check;
}[] = [
  { verdict: "confirmed", label: "Confirmed", icon: CircleCheck },
  { verdict: "false_positive", label: "False positive", icon: Flag },
  { verdict: "not_applicable", label: "Not applicable", icon: CircleSlash },
];

/**
 * Per-finding feedback: false_positive / confirmed / not_applicable,
 * persisted via the existing app/api/v3/scan/feedback/route.ts (POST +
 * GET) -- the route and its DB table already worked, nothing in the UI
 * called it. Marking a finding false_positive here also feeds Part 1's
 * regression-alert diff (lib/scanner/regression-alert.ts): a suppressed
 * finding never counts as "new" on a later scan.
 *
 * Only rendered when the caller supplies `findingUrl` (the scanned URL),
 * which is why IssueDetail's other call sites (public host page, shared
 * share-token page, demo, GitHub repo scans) don't get this control --
 * feedback requires a signed-in session AND a real scanned URL, neither of
 * which those views have.
 */
function FindingFeedback({
  findingId,
  findingUrl,
  scanHistoryId,
  onVerdictChanged,
}: {
  findingId: string;
  findingUrl: string;
  scanHistoryId?: string | number | null;
  /** Called after a verdict is saved successfully. The server already
   *  recalculates and persists the scan's summary/dangerScore excluding
   *  false_positive-marked findings (lib/scanner/recompute-scan-score.ts);
   *  nothing previously told the currently-open view to pick that up, so
   *  the on-screen risk score looked unchanged until the scan was
   *  reopened. Callers should refetch/patch their scan state here. */
  onVerdictChanged?: () => void;
}) {
  const [verdict, setVerdict] = useState<FeedbackVerdict | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<FeedbackVerdict | null>(null);
  const [error, setError] = useState(false);
  // Separate from `error`, which is a SAVE failure. A failed READ used to be
  // swallowed: `loaded` flipped true with `verdict` still null, so all three
  // buttons rendered unpressed and a finding the user had already marked
  // "False positive" read as never marked, with nothing said. Absence of a
  // verdict and inability to read one are different claims.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets stale feedback state before the fresh fetch-on-mount below; the actual verdict setState calls happen only after the request resolves
    setLoaded(false);
    setVerdict(null);
    setError(false);
    setLoadFailed(false);
    fetch(
      `${API.SCAN_FEEDBACK}?url=${encodeURIComponent(findingUrl)}&findingId=${encodeURIComponent(findingId)}`,
    )
      .then((res) => {
        if (!res.ok) throw new Error("feedback read failed");
        return res.json();
      })
      .then((data: { feedback?: { verdict: FeedbackVerdict }[] } | null) => {
        if (cancelled || !data?.feedback?.length) return;
        setVerdict(data.feedback[0].verdict);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [findingId, findingUrl]);

  async function submit(next: FeedbackVerdict) {
    setSaving(next);
    setError(false);
    try {
      const res = await fetch(API.SCAN_FEEDBACK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findingId,
          findingUrl,
          // The feedback route keys its ownership check + score recompute on
          // the numeric primary key, so only send a numeric id. The opaque
          // public_id (were it ever passed here) is omitted rather than sent.
          scanHistoryId:
            typeof scanHistoryId === "number" ? scanHistoryId : undefined,
          verdict: next,
        }),
      });
      if (!res.ok) throw new Error("Failed to save feedback");
      setVerdict(next);
      onVerdictChanged?.();
    } catch {
      setError(true);
    } finally {
      setSaving(null);
    }
  }

  if (!loaded) return null;

  return (
    <div
      {...tourAnchor("findingTriage")}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
    >
      <span className="text-xs font-medium text-muted-foreground">
        Mark this result:
      </span>
      <div className="flex flex-wrap gap-1.5">
        {FEEDBACK_OPTIONS.map(({ verdict: v, label, icon: Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => submit(v)}
            disabled={saving !== null}
            // Undefined, not false, while the stored verdict could not be
            // read: aria-pressed="false" asserts "not marked", which is the
            // thing we do not know.
            aria-pressed={loadFailed ? undefined : verdict === v}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
              verdict === v
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
              FOCUS_RING,
            )}
          >
            <Icon aria-hidden className="h-3.5 w-3.5" />
            {saving === v ? "Saving..." : label}
          </button>
        ))}
      </div>
      {error && (
        <span className="text-xs text-[hsl(var(--severity-high))]">
          Couldn&apos;t save that, try again.
        </span>
      )}
    </div>
  );
}

/** A stored due date (timestamptz string) formatted for an
 *  <input type="date"> ("YYYY-MM-DD"), or "" when there is none. Uses the
 *  date's local components so the day shown matches the day picked. */
function toDateInputValue(due: string | null | undefined): string {
  if (!due) return "";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** True when a due date is in the past (day granularity) AND the finding is
 *  still open work, so the "overdue" badge only nags about things that
 *  actually still need doing (not ones already fixed / accepted / won't-fix). */
function isOverdue(
  due: string | null | undefined,
  status: RemediationStatus,
): boolean {
  if (!due) return false;
  if (status === "fixed" || status === "accepted_risk" || status === "wont_fix")
    return false;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

/**
 * The owner's per-finding remediation lifecycle: Open / In progress / Fixed
 * / Accepted risk / Won't fix, plus an optional note and free-text assignee,
 * saved via app/api/v3/scan/remediation/route.ts. Distinct from
 * FindingFeedback above: that records whether the finding is accurate (and
 * feeds the global confidence model); THIS records what the user has done
 * about it, and persists across rescans of the same target because it is
 * keyed on the stable finding_id (see lib/scanner/remediation.ts).
 *
 * Same gating as FindingFeedback: only rendered when the caller supplies
 * `findingUrl` (the owner's own authenticated scan), so the public host
 * page and shared share-token page never show it.
 */
function RemediationControl({
  findingId,
  findingUrl,
  initial,
  onChanged,
}: {
  findingId: string;
  findingUrl: string;
  /** Server-attached current status for this finding, if any. */
  initial?: FindingRemediation;
  /** Called after a status/note change saves, so the list badge can update
   *  in-session without a refetch. `null` means reset to the implicit
   *  "open" default (the row was cleared). */
  onChanged?: (
    findingId: string,
    remediation: FindingRemediation | null,
  ) => void;
}) {
  const [status, setStatus] = useState<RemediationStatus>(
    initial?.status ?? "open",
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [assignee, setAssignee] = useState(initial?.assignee ?? "");
  const [dueAt, setDueAt] = useState(toDateInputValue(initial?.dueAt));
  const [saving, setSaving] = useState(false);
  const [savedDetails, setSavedDetails] = useState(false);
  const [error, setError] = useState(false);
  const noteFieldId = useId();
  const assigneeFieldId = useId();
  const dueFieldId = useId();
  const assigneeListId = useId();
  const teammates = useTeammates();

  // Freshest value wins: seed from the server-attached status, then confirm
  // against the API on mount (it may have changed in another tab/session).
  useEffect(() => {
    let cancelled = false;
    fetch(
      `${API.SCAN_REMEDIATION}?url=${encodeURIComponent(findingUrl)}&findingId=${encodeURIComponent(findingId)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            remediation?: {
              status: RemediationStatus;
              note: string | null;
              assignee: string | null;
              due_at: string | null;
            }[];
          } | null,
        ) => {
          if (cancelled || !data?.remediation?.length) return;
          const row = data.remediation[0];
          setStatus(row.status);
          setNote(row.note ?? "");
          setAssignee(row.assignee ?? "");
          setDueAt(toDateInputValue(row.due_at));
        },
      )
      .catch(() => {
        /* best-effort preload; the control still works without it */
      });
    return () => {
      cancelled = true;
    };
  }, [findingId, findingUrl]);

  async function save(
    nextStatus: RemediationStatus,
    opts: { note: string; assignee: string; dueAt: string },
  ) {
    setSaving(true);
    setError(false);
    setSavedDetails(false);
    try {
      if (nextStatus === "open") {
        const res = await fetch(
          `${API.SCAN_REMEDIATION}?url=${encodeURIComponent(findingUrl)}&findingId=${encodeURIComponent(findingId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error("Failed to clear status");
        onChanged?.(findingId, null);
      } else {
        const res = await fetch(API.SCAN_REMEDIATION, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            findingId,
            findingUrl,
            status: nextStatus,
            note: opts.note.trim() || undefined,
            assignee: opts.assignee.trim() || undefined,
            dueAt: opts.dueAt || null,
          }),
        });
        if (!res.ok) throw new Error("Failed to save remediation status");
        onChanged?.(findingId, {
          status: nextStatus,
          note: opts.note.trim() || null,
          assignee: opts.assignee.trim() || null,
          dueAt: opts.dueAt || null,
        });
      }
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function selectStatus(next: RemediationStatus) {
    setStatus(next);
    await save(next, { note, assignee, dueAt });
  }

  async function saveDetails() {
    const ok = await save(status, { note, assignee, dueAt });
    if (ok) {
      setSavedDetails(true);
      setTimeout(() => setSavedDetails(false), 2000);
    }
  }

  // rounded-xl, matching the FindingFeedback card directly above it: both are
  // panels on the radius ladder, and the two now render as a pair.
  //
  // a11y (SC 1.4.3): this used to be bg-primary/5, and the selected status
  // chip inside it was bg-primary/15 text-primary. Composited, that put the
  // 12px chip label on roughly 19% primary, where --primary-text measures
  // 4.01:1 in light mode: an AA failure on the control that records what you
  // are doing about a finding. bg-card here and /10 on the chip (the value
  // FindingFeedback already uses) measures 4.78:1. It also settles the rule
  // the rest of this page now follows: the severity-tinted header is the only
  // toned surface, and everything under it is a neutral card.
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold text-foreground">
          Your remediation tracking
        </span>
        <div
          role="group"
          aria-label="Remediation status"
          className="flex flex-wrap gap-1.5"
        >
          {REMEDIATION_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => selectStatus(s)}
              disabled={saving}
              aria-pressed={status === s}
              className={cn(
                "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                status === s
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground",
                FOCUS_RING,
              )}
            >
              {REMEDIATION_LABELS[s]}
            </button>
          ))}
        </div>
        {isOverdue(dueAt, status) && (
          <span className="inline-flex items-center rounded-md border border-[hsl(var(--severity-high))]/30 bg-[hsl(var(--severity-high))]/10 px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--severity-high))]">
            Overdue
          </span>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Kept separate from the accuracy feedback above, and remembered the next
        time you scan this target.
      </p>

      {status !== "open" && (
        <div className="flex flex-col gap-2 border-t border-primary/15 pt-3">
          <div className="flex flex-col gap-1.5 sm:flex-row">
            <div className="flex flex-1 flex-col gap-1">
              <label
                htmlFor={noteFieldId}
                className="text-[11px] font-medium text-muted-foreground"
              >
                Note (optional)
              </label>
              <input
                id={noteFieldId}
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                placeholder="e.g. patched in release 4.2, ticket VR-118"
                className={cn(
                  "h-8 rounded-md border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground",
                  FOCUS_RING,
                )}
              />
            </div>
            <div className="flex flex-col gap-1 sm:w-44">
              <label
                htmlFor={assigneeFieldId}
                className="text-[11px] font-medium text-muted-foreground"
              >
                Assignee (optional)
              </label>
              <input
                id={assigneeFieldId}
                type="text"
                // A teammate picker with a free-text fallback: the datalist
                // suggests people you share a team with, but you can still type
                // any name. Solo users (no teammates) just get the free field.
                list={teammates.length > 0 ? assigneeListId : undefined}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                maxLength={120}
                placeholder={
                  teammates.length > 0
                    ? "Pick a teammate or type"
                    : "name or handle"
                }
                className={cn(
                  "h-8 rounded-md border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground",
                  FOCUS_RING,
                )}
              />
              {teammates.length > 0 && (
                <datalist id={assigneeListId}>
                  {teammates.map((t) => (
                    <option key={t.id} value={t.name || t.email} />
                  ))}
                </datalist>
              )}
            </div>
            <div className="flex flex-col gap-1 sm:w-40">
              <label
                htmlFor={dueFieldId}
                className="text-[11px] font-medium text-muted-foreground"
              >
                Due date (optional)
              </label>
              <input
                id={dueFieldId}
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className={cn(
                  "h-8 rounded-md border border-border bg-card px-2.5 text-xs text-foreground",
                  FOCUS_RING,
                )}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={saveDetails}
              disabled={saving}
              className={cn("h-7 px-2.5 text-xs", FOCUS_RING)}
            >
              {saving ? "Saving..." : savedDetails ? "Saved" : "Save details"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <span className="text-xs text-[hsl(var(--severity-high))]">
          Couldn&apos;t save that, try again.
        </span>
      )}
    </div>
  );
}

interface IssueDetailProps {
  issue: Vulnerability;
  onBack: () => void;
  /** The scanned URL this finding came from. Also doubles as the
   *  scan_finding_feedback lookup key (see FindingFeedback above) -- pass
   *  this only from an authenticated view of the caller's own scan. */
  findingUrl?: string;
  scanHistoryId?: string | number | null;
  /** Forwarded to FindingFeedback -- see its own doc comment. */
  onVerdictChanged?: () => void;
  /** Forwarded to RemediationControl: called after the owner changes this
   *  finding's remediation status, so the caller can update the list badge
   *  in-session. `null` means the status was cleared back to open. */
  onRemediationChanged?: (
    findingId: string,
    remediation: FindingRemediation | null,
  ) => void;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (await copyToClipboard(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      {...tourAnchor("findingFix")}
      className="overflow-hidden rounded-xl border border-border bg-muted/40"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <Terminal aria-hidden className="h-3 w-3" />
          {language}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 gap-1.5 px-2 text-xs", FOCUS_RING)}
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className="font-mono text-foreground">{code}</code>
      </pre>
    </div>
  );
}

/**
 * The verbatim proof behind the free-text evidence above it: the actual
 * Set-Cookie, the actual script src, the actual line of markup, with the
 * response line number where the check knows it.
 *
 * Every check has produced these since the engine rewrite and nothing
 * rendered them, so README's promise of "the header, the certificate field,
 * or the response body fragment that triggered it, not just a rule name" was
 * shipped to the AI verifier and to nobody else.
 *
 * The values are fragments of a scanned third party's page, so:
 * toDisplayExcerpts strips the characters that can hide or reorder
 * themselves, every value reaches the DOM as a React text child (never as
 * markup), the long ones are cut to a preview with an explicit control to see
 * the rest, and each sits in its own overflow-x container so one 400-character
 * line scrolls instead of widening the page.
 */
function EvidenceExcerpts({ excerpts }: { excerpts: unknown }) {
  const items = useMemo(() => toDisplayExcerpts(excerpts), [excerpts]);
  const [openValues, setOpenValues] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);

  if (items.length === 0) return null;

  const overflows = items.length > EXCERPT_PREVIEW_COUNT;
  const visible =
    showAll || !overflows ? items : items.slice(0, EXCERPT_PREVIEW_COUNT);

  function toggleValue(index: number) {
    setOpenValues((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="border-t border-border">
      <div className="flex items-center justify-between gap-2 bg-muted/40 px-4 py-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Verbatim proof
        </h4>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {items.length} {items.length === 1 ? "excerpt" : "excerpts"}
        </span>
      </div>
      <ul className="flex flex-col gap-3 px-4 py-3">
        {visible.map((ex, i) => {
          const { preview, truncated } = truncateExcerpt(ex.value);
          const open = openValues.has(i);
          return (
            <li key={i} className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[11px] font-medium text-foreground">
                  {ex.label}
                </span>
                {ex.line !== undefined && (
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    line {ex.line}
                  </span>
                )}
              </div>
              <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-[12px] leading-relaxed text-foreground">
                {open || !truncated ? ex.value : `${preview}...`}
              </pre>
              {truncated && (
                <button
                  type="button"
                  onClick={() => toggleValue(i)}
                  aria-expanded={open}
                  className={cn(
                    "mt-1 rounded-sm text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground",
                    FOCUS_RING,
                  )}
                >
                  {open
                    ? "Show less"
                    : `Show the full ${ex.value.length} characters`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {overflows && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          aria-expanded={showAll}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
            FOCUS_RING,
          )}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              showAll && "rotate-180",
            )}
          />
          {showAll ? "Collapse excerpts" : `Show all ${items.length} excerpts`}
        </button>
      )}
    </div>
  );
}

function Evidence({
  evidence,
  excerpts,
}: {
  evidence: string;
  excerpts?: unknown;
}) {
  const panelId = useId();
  const lines = useMemo(
    () => evidence.split("\n").filter((l) => l.length > 0),
    [evidence],
  );
  const [expanded, setExpanded] = useState(false);
  const overflows = lines.length > EVIDENCE_PREVIEW_LINES;
  const visible =
    expanded || !overflows ? lines : lines.slice(0, EVIDENCE_PREVIEW_LINES);

  return (
    <div
      {...tourAnchor("findingEvidence")}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What the scanner saw
        </h3>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
      </div>
      <div id={panelId} className="overflow-x-auto px-4 py-3">
        <ul className="flex min-w-0 flex-col gap-1">
          {visible.map((line, i) => (
            <li
              key={i}
              className="whitespace-pre-wrap break-all font-mono text-[13px] leading-relaxed text-foreground"
            >
              {line}
            </li>
          ))}
        </ul>
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
            FOCUS_RING,
          )}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              expanded && "rotate-180",
            )}
          />
          {expanded ? "Collapse evidence" : `Show all ${lines.length} lines`}
        </button>
      )}
      <EvidenceExcerpts excerpts={excerpts} />
    </div>
  );
}

export function IssueDetail({
  issue,
  onBack,
  findingUrl,
  scanHistoryId,
  onVerdictChanged,
  onRemediationChanged,
}: IssueDetailProps) {
  const [activeTab, setActiveTab] = useState(0);
  // This component explicitly supports `issue` changing while mounted (see
  // the effect keyed on issue.id below, and the key={issue.id} that
  // RemediationControl was given for the same reason), but activeTab was
  // never reset. Going from a finding with three code examples with tab 2
  // open to one with a single example read issue.codeExamples[2].code and
  // threw, taking out the whole view. Clamping is enough and it also
  // survives a findings array being replaced in place.
  const exampleTab = Math.min(
    activeTab,
    Math.max(0, issue.codeExamples.length - 1),
  );
  const tone = SEVERITY_TONE[issue.severity] ?? SEVERITY_TONE.info;
  const verdict = issue.aiVerdict ? AI_VERDICT_COPY[issue.aiVerdict] : null;
  const category = CATEGORY_LABEL[issue.category] || issue.category;

  const handleBack = useCallback(() => {
    removeQueryParam(FINDING_QUERY_PARAM);
    onBack();
  }, [onBack]);

  // Opening a finding swaps the list for this detail view in place, so the
  // window keeps whatever scroll position the list happened to be at
  // (often mid-page) instead of landing at the top of the new content.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [issue.id]);

  // Deep-linkable selection, other half of results-list.tsx: if the
  // ?finding= param stops matching this issue (browser back/forward, or
  // it's cleared some other way) while this detail view is still mounted,
  // fall back to the list instead of silently drifting out of sync with
  // the URL.
  useEffect(() => {
    const inSync = () => getQueryParam(FINDING_QUERY_PARAM) === issue.id;
    const syncFromUrl = () => {
      if (!inSync()) onBack();
    };
    const onQueryChange = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (detail.key === FINDING_QUERY_PARAM) syncFromUrl();
    };
    window.addEventListener(QUERY_CHANGE_EVENT, onQueryChange);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener(QUERY_CHANGE_EVENT, onQueryChange);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, [issue.id, onBack]);

  return (
    <article className="flex flex-col gap-4">
      <button
        type="button"
        onClick={handleBack}
        className={cn(
          "group inline-flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          FOCUS_RING,
        )}
      >
        <ArrowLeft
          aria-hidden
          className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
        />
        Back to findings
      </button>

      {/* Header. Same rule the scan verdict follows: the one panel that states
          what the page is ABOUT carries the tone, and every panel below it is a
          neutral card. Rail, tinted edge and a tint overlay over the card base,
          so severity registers before a word of it is read. Info is untinted on
          purpose (SEVERITY_TONE.panel is empty there): it is not a problem. */}
      <header
        className={cn(
          "relative overflow-hidden rounded-xl border bg-card",
          tone.emphasis === "quiet" ? "border-border" : tone.border,
        )}
      >
        <span
          aria-hidden
          className={cn("pointer-events-none absolute inset-0", tone.panel)}
        />
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-1",
            tone.solid,
            tone.emphasis === "quiet" && "opacity-40",
          )}
        />
        <div className="relative flex flex-col gap-3 py-4 pl-5 pr-4 sm:py-5 sm:pl-6 sm:pr-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span
              className={cn(
                "text-xs font-semibold uppercase tracking-wide",
                tone.text,
              )}
            >
              {tone.label}
            </span>
            <span aria-hidden className="h-3 w-px bg-border" />
            <span className="text-xs text-muted-foreground">{category}</span>
            {issue.confidence != null && (
              <>
                <span aria-hidden className="h-3 w-px bg-border" />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {issue.confidence}% detection confidence
                </span>
              </>
            )}
            {issue.inKev && (
              <>
                <span aria-hidden className="h-3 w-px bg-border" />
                <span className="text-xs font-semibold text-[hsl(var(--severity-critical))]">
                  Actively exploited (CISA KEV)
                </span>
              </>
            )}
            {issue.epssScore != null && (
              <>
                <span aria-hidden className="h-3 w-px bg-border" />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {(issue.epssScore * 100).toFixed(1)}% EPSS
                </span>
              </>
            )}
            {/* The scanner computes a CVSS 3.1 base score from the vector for
                every finding that has one, and it was rendered nowhere in the
                product: the score sat in the API response and the SARIF export
                only. It belongs next to the other two exploitability signals,
                since together they are what tells a reader what to fix first.
                The vector is the title so the derivation stays inspectable. */}
            {issue.cvssScore != null && (
              <>
                <span aria-hidden className="h-3 w-px bg-border" />
                <span
                  className="text-xs tabular-nums text-muted-foreground"
                  title={issue.cvssVector}
                >
                  CVSS {issue.cvssScore.toFixed(1)}
                </span>
              </>
            )}
          </div>
          <h2 className="text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
            {issue.title}
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {issue.description}
          </p>
          {issue.detectionMethod && (
            <p className="font-mono text-[11px] text-muted-foreground/80">
              Detected by: {issue.detectionMethod}
              {issue.cveIds && issue.cveIds.length > 0 && (
                <> &middot; {issue.cveIds.join(", ")}</>
              )}
            </p>
          )}
          {!issue.detectionMethod &&
            issue.cveIds &&
            issue.cveIds.length > 0 && (
              <p className="font-mono text-[11px] text-muted-foreground/80">
                {issue.cveIds.join(", ")}
              </p>
            )}
        </div>
      </header>

      {verdict && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border px-4 py-3",
            verdict.tone,
          )}
        >
          <BotMessageSquare aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {verdict.headline}
              {issue.aiConfidence != null && (
                <span className="ml-1.5 text-xs font-normal tabular-nums opacity-80">
                  ({issue.aiConfidence}% confidence)
                </span>
              )}
            </p>
            {issue.aiReason && (
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {issue.aiReason}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Keyed on the finding, like RemediationControl below: without it the
          panel's expand state (which lines are shown, which excerpt values
          are open) survives a move to the next finding and applies itself to
          content it was never about. */}
      <Evidence
        key={issue.id}
        evidence={issue.evidence}
        excerpts={issue.evidenceExcerpts}
      />

      {/* Triage sits here, directly under the evidence, rather than at the
          very bottom of the page where it used to live. Both cards are
          actions about the finding, not a footnote to it: by this point the
          reader has the severity, the description and the raw evidence, which
          is everything needed to say "that is real" or "I am on it", and none
          of it requires first reading the fix guide. Below the evidence rather
          than above it because judging accuracy before being shown what the
          scanner saw is guesswork. Feedback (is this finding correct?) comes
          before remediation tracking (what am I doing about it?), which is the
          order the two cards' own copy assumes. */}
      {findingUrl && (
        <FindingFeedback
          findingId={issue.id}
          findingUrl={findingUrl}
          scanHistoryId={scanHistoryId}
          onVerdictChanged={onVerdictChanged}
        />
      )}

      {findingUrl && (
        <RemediationControl
          key={issue.id}
          findingId={issue.id}
          findingUrl={findingUrl}
          initial={issue.remediation}
          onChanged={onRemediationChanged}
        />
      )}

      {/* Why it matters: prose with the risk pulled out, not another icon card. */}
      <section className="grid grid-cols-1 gap-6 rounded-xl border border-border bg-card p-4 sm:p-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What this means
          </h3>
          <p className="text-sm leading-relaxed text-foreground/90">
            {issue.explanation}
          </p>
        </div>
        <div
          className={cn(
            "flex flex-col gap-2 rounded-md border-l-2 bg-muted/40 py-3 pl-4 pr-3",
            tone.border,
          )}
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            If left unfixed
          </h3>
          <p className="text-sm leading-relaxed text-foreground/90">
            {issue.riskImpact}
          </p>
        </div>
      </section>

      {/* Fix: the reason anyone opened this page. Numbered prose, no badges. */}
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          How to fix it
        </h3>
        <ol className="flex flex-col gap-3">
          {issue.fixSteps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="shrink-0 pt-px font-mono text-xs tabular-nums text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="leading-relaxed text-foreground/90">{step}</span>
            </li>
          ))}
        </ol>
        <Link
          href="/checks"
          className={cn(
            "mt-4 inline-flex items-center gap-1 text-xs text-primary hover:underline",
            FOCUS_RING,
          )}
        >
          Browse all {APP_NAME} fix guides
          <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      </section>

      {issue.codeExamples.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Working example
            </h3>
            {/* A group of toggle buttons, not a tablist: role="tab" promises
                a matching role="tabpanel" with aria-controls and arrow-key
                navigation, none of which this control has, so the promise
                only misled a screen reader ("tab, 1 of 3" governing nothing).
                aria-pressed says what these buttons really do. */}
            {issue.codeExamples.length > 1 && (
              <div
                role="group"
                aria-label="Code examples"
                className="flex gap-1 scroll-x-only rounded-md bg-muted p-1"
              >
                {issue.codeExamples.map((example, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={exampleTab === i}
                    onClick={() => setActiveTab(i)}
                    className={cn(
                      // Geometry matched to components/ui/tabs.tsx, the
                      // segmented-control primitive, at its dense size: same
                      // rounded-sm pill raised on bg-background, so the two
                      // segmented controls in the product read as one idiom
                      // even though this one is a toggle group rather than a
                      // tablist (see the comment above).
                      "shrink-0 whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium transition-all",
                      exampleTab === i
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                      FOCUS_RING,
                    )}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <CodeBlock
            code={issue.codeExamples[exampleTab].code}
            language={issue.codeExamples[exampleTab].language}
          />
        </section>
      )}

      {issue.references && issue.references.length > 0 && (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/50 pt-4">
          <span className="text-xs text-muted-foreground">Read more:</span>
          {issue.references.map((ref, i) => (
            <a
              key={i}
              href={ref}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm text-sm text-primary hover:underline",
                FOCUS_RING,
              )}
            >
              {safeHostname(ref)}
              <ExternalLink aria-hidden className="h-3 w-3" />
            </a>
          ))}
        </footer>
      )}
    </article>
  );
}

function safeHostname(ref: string) {
  try {
    return new URL(ref).hostname.replace(/^www\./, "");
  } catch {
    return ref;
  }
}
