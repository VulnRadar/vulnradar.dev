"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  ArrowLeft,
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
import { Button } from "@/components/ui/button";
import { SEVERITY_TONE } from "@/components/scanner/severity-badge";
import type { Vulnerability } from "@/lib/scanner/types";
import { cn } from "@/lib/ui/utils";
import { copyToClipboard } from "@/lib/ui/clipboard";
import { API } from "@/lib/config/constants";
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

const AI_VERDICT_COPY: Record<
  NonNullable<Vulnerability["aiVerdict"]>,
  { headline: string; tone: string }
> = {
  confirmed: {
    headline: "AI probed the live site and confirmed this finding",
    tone: "border-primary/20 bg-primary/5 text-primary",
  },
  possible_fp: {
    headline: "AI thinks this one may not apply to your site",
    tone: "border-[hsl(var(--severity-medium))]/30 bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))]",
  },
  uncertain: {
    headline: "AI could not reach a verdict, review this one by hand",
    tone: "border-border bg-muted text-muted-foreground",
  },
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
}: {
  findingId: string;
  findingUrl: string;
  scanHistoryId?: number | null;
}) {
  const [verdict, setVerdict] = useState<FeedbackVerdict | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<FeedbackVerdict | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets stale feedback state before the fresh fetch-on-mount below; the actual verdict setState calls happen only after the request resolves
    setLoaded(false);
    setVerdict(null);
    setError(false);
    fetch(
      `${API.SCAN_FEEDBACK}?url=${encodeURIComponent(findingUrl)}&findingId=${encodeURIComponent(findingId)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { feedback?: { verdict: FeedbackVerdict }[] } | null) => {
        if (cancelled || !data?.feedback?.length) return;
        setVerdict(data.feedback[0].verdict);
      })
      .catch(() => {
        /* best-effort preload; the buttons still work without it */
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
          scanHistoryId: scanHistoryId ?? undefined,
          verdict: next,
        }),
      });
      if (!res.ok) throw new Error("Failed to save feedback");
      setVerdict(next);
    } catch {
      setError(true);
    } finally {
      setSaving(null);
    }
  }

  if (!loaded) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
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
            aria-pressed={verdict === v}
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

interface IssueDetailProps {
  issue: Vulnerability;
  onBack: () => void;
  /** The scanned URL this finding came from. Also doubles as the
   *  scan_finding_feedback lookup key (see FindingFeedback above) -- pass
   *  this only from an authenticated view of the caller's own scan. */
  findingUrl?: string;
  scanHistoryId?: number | null;
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
    <div className="overflow-hidden rounded-md border border-border bg-muted/40">
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

function Evidence({ evidence }: { evidence: string }) {
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
    <div className="overflow-hidden rounded-md border border-border bg-card">
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
    </div>
  );
}

export function IssueDetail({
  issue,
  onBack,
  findingUrl,
  scanHistoryId,
}: IssueDetailProps) {
  const [activeTab, setActiveTab] = useState(0);
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

      {/* Header. The severity rail runs the full height so it reads before the text. */}
      <header className="relative overflow-hidden rounded-md border border-border bg-card">
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-1",
            tone.solid,
            tone.emphasis === "quiet" && "opacity-40",
          )}
        />
        <div className="flex flex-col gap-3 py-4 pl-5 pr-4 sm:py-5 sm:pl-6 sm:pr-5">
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
            "flex items-start gap-3 rounded-md border px-4 py-3",
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

      {findingUrl && (
        <FindingFeedback
          findingId={issue.id}
          findingUrl={findingUrl}
          scanHistoryId={scanHistoryId}
        />
      )}

      <Evidence evidence={issue.evidence} />

      {/* Why it matters: prose with the risk pulled out, not another icon card. */}
      <section className="grid grid-cols-1 gap-6 rounded-md border border-border bg-card p-4 sm:p-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
      <section className="rounded-md border border-border bg-card p-4 sm:p-5">
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
      </section>

      {issue.codeExamples.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Working example
            </h3>
            {issue.codeExamples.length > 1 && (
              <div
                role="tablist"
                aria-label="Code examples"
                className="flex gap-1 overflow-x-auto rounded-md bg-muted p-1"
              >
                {issue.codeExamples.map((example, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === i}
                    onClick={() => setActiveTab(i)}
                    className={cn(
                      "shrink-0 whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors",
                      activeTab === i
                        ? "bg-card text-foreground shadow-sm"
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
            code={issue.codeExamples[activeTab].code}
            language={issue.codeExamples[activeTab].language}
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
                "inline-flex items-center gap-1.5 rounded text-sm text-primary hover:underline",
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
