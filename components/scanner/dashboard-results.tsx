"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import dynamic from "next/dynamic";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import type { FindingRemediation } from "@/lib/scanner/remediation";
import type { ScanAuthReport } from "@/lib/scanner/auth/types";
import {
  HistoryNotes,
  HistoryTagsCard,
  type ScanTag,
  type TagMutationResult,
} from "@/components/history";
import { AuthenticatedBadge } from "./authenticated-badge";
import { SubdomainDiscovery } from "./subdomain-discovery";
import { ScanResultDetail, type CrawlInfo } from "./scan-result-detail";
import { copyToClipboard } from "@/lib/ui/clipboard";
import { tourAnchor } from "@/lib/tour/anchors";
import { API } from "@/lib/config/client-constants";

// The trigger is an h-8 w-8 control in a header row, and without a fallback
// the row rendered one button short until the chunk landed.
const ScanActionsMenu = dynamic(
  () =>
    import("./scan-actions-menu").then((m) => ({ default: m.ScanActionsMenu })),
  {
    loading: () => (
      <div
        aria-hidden
        className="h-8 w-8 animate-pulse rounded-md border border-border bg-card"
      />
    ),
  },
);
const IssueDetail = dynamic(() =>
  import("./issue-detail").then((m) => ({ default: m.IssueDetail })),
);

interface DashboardResultsProps {
  result: ScanResult;
  selectedIssue: Vulnerability | null;
  onSelectIssue: (issue: Vulnerability | null) => void;
  scanHistoryId: string | number | null;
  /** Opaque public id for the completed scan. Preferred over the numeric
   *  scanHistoryId for the screenshot URL and its refresh route so neither
   *  exposes the internal numeric id. Falls back to scanHistoryId when a
   *  record predates it. */
  scanPublicId?: string | null;
  scanNotes: string;
  scanTags: ScanTag[];
  onAddTag: (scanId: string | number, tag: string) => TagMutationResult;
  onRemoveTag: (scanId: string | number, tag: string) => TagMutationResult;
  crawlInfo: CrawlInfo | null;
  authReport?: ScanAuthReport | null;
  /** The visibility this scan was actually requested with. Undefined means the
   *  server default (public). */
  initialIsPublic?: boolean;
  onReset: () => void;
  onScanSubdomain: (url: string) => void;
  /** Resolves to null when saved, or the message to show on failure. */
  onSaveNotes: (notes: string) => Promise<string | null>;
  onFindingsUpdated?: (findings: Vulnerability[]) => void;
  onVerdictChanged?: () => void;
}

export function DashboardResults({
  result,
  selectedIssue,
  onSelectIssue,
  scanHistoryId,
  scanPublicId,
  scanNotes,
  scanTags,
  onAddTag,
  onRemoveTag,
  crawlInfo,
  authReport,
  initialIsPublic,
  onReset,
  onScanSubdomain,
  onSaveNotes,
  onFindingsUpdated,
  onVerdictChanged,
}: DashboardResultsProps) {
  const [copied, setCopied] = useState(false);
  // Seeded from the visibility the scan was actually requested with, not from
  // a flat `true`. The comment here used to say this view has no "start
  // private" control, which stopped being true when ScanForm grew its "Keep
  // this scan private" toggle: a scan the user deliberately ran private came
  // back offering "Make private" behind a padlock, and nothing ever corrected
  // it, so the only way to make that scan public was to leave the page.
  // scan_history.is_public still defaults to true, so undefined means public.
  const [isPublic, setIsPublic] = useState(initialIsPublic !== false);
  // Overrides result.aiSummary once a "Generate AI summary" action finishes,
  // so the summary shows up in ScanSummary immediately instead of only
  // after the next fetch of this scan. Undefined until then, so
  // displayResult below falls back to whatever result.aiSummary already had
  // (e.g. re-opening a scan that was summarized in an earlier session).
  const [aiSummary, setAiSummary] = useState<string | undefined>(undefined);
  // In-session remediation overrides so the list badge updates the moment a
  // status changes in the detail view, without refetching the whole scan.
  // `null` value means "cleared back to open". Merged over the server-
  // attached result.findings[].remediation below.
  const [remediationOverrides, setRemediationOverrides] = useState<
    Map<string, FindingRemediation | null>
  >(new Map());
  // Owner refresh overrides: a successful "refresh" on the DNS / port /
  // screenshot panels updates just that capture in place, without refetching
  // the whole scan. Undefined until the owner refreshes one, so displayResult
  // falls back to whatever the scan already carried.
  const [dnsOverride, setDnsOverride] =
    useState<ScanResult["dnsRecords"]>(undefined);
  const [portScanOverride, setPortScanOverride] =
    useState<ScanResult["portScan"]>(undefined);
  const [screenshotOverride, setScreenshotOverride] =
    useState<ScanResult["screenshot"]>(undefined);

  const findingsWithRemediation = useMemo(() => {
    if (remediationOverrides.size === 0) return result.findings;
    return result.findings.map((f) => {
      if (!remediationOverrides.has(f.id)) return f;
      const override = remediationOverrides.get(f.id);
      return override
        ? { ...f, remediation: override }
        : { ...f, remediation: undefined };
    });
  }, [result.findings, remediationOverrides]);

  const handleRemediationChanged = useCallback(
    (findingId: string, remediation: FindingRemediation | null) => {
      setRemediationOverrides((prev) => {
        const next = new Map(prev);
        next.set(findingId, remediation);
        return next;
      });
    },
    [],
  );

  if (selectedIssue) {
    const displayIssue =
      findingsWithRemediation.find((f) => f.id === selectedIssue.id) ??
      selectedIssue;
    return (
      // The tour anchor sits here rather than inside IssueDetail because this
      // wrapper is the one element that exists for exactly as long as a
      // finding is open: it is what the "open a finding" step waits to appear,
      // and unlike the evidence block or the fix snippet it is never
      // conditional on what the finding happens to contain.
      <div {...tourAnchor("findingDetail")} className="pt-6">
        <IssueDetail
          issue={displayIssue}
          onBack={() => onSelectIssue(null)}
          findingUrl={result.url}
          scanHistoryId={scanHistoryId}
          onVerdictChanged={onVerdictChanged}
          onRemediationChanged={handleRemediationChanged}
        />
      </div>
    );
  }

  async function copyUrl() {
    if (await copyToClipboard(result.url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const displayUrl = result.url.replace(/^https?:\/\//, "");
  const displayResult: ScanResult = {
    ...result,
    ...(aiSummary ? { aiSummary } : {}),
    ...(dnsOverride ? { dnsRecords: dnsOverride } : {}),
    ...(portScanOverride ? { portScan: portScanOverride } : {}),
    ...(screenshotOverride ? { screenshot: screenshotOverride } : {}),
  };

  return (
    <div className="flex flex-col gap-4 pt-6">
      {/* Target + actions */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* The scanned URL is the heading for this view. A finished scan
              replaces the console, and the "Scan a host" h1 goes with it, so
              /dashboard?scan=... had no h1 at all and the document lost its
              title landmark at exactly the moment it had something to say.
              Same defect and same fix as history-detail-header.tsx.

              The h1 wraps the button rather than sitting inside it: a button
              takes phrasing content and a heading is not phrasing content. */}
          <h1 className="flex min-w-0 items-center">
            <button
              type="button"
              onClick={copyUrl}
              aria-label="Copy scanned URL"
              className="group flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate font-mono text-base font-semibold text-foreground transition-colors group-hover:text-primary">
                {displayUrl}
              </span>
              {copied ? (
                <Check
                  aria-hidden
                  className="h-4 w-4 shrink-0 text-[hsl(var(--success))]"
                />
              ) : (
                <Copy
                  aria-hidden
                  className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              )}
            </button>
          </h1>
          {authReport?.status === "authenticated" && (
            <AuthenticatedBadge className="shrink-0" />
          )}
        </div>

        <div
          {...tourAnchor("scanActions")}
          className="flex shrink-0 flex-wrap items-center gap-2"
        >
          <Button
            variant="outline"
            onClick={onReset}
            size="sm"
            className="h-8 gap-1.5 bg-transparent"
          >
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            New scan
          </Button>
          <ScanActionsMenu
            result={displayResult}
            scanId={scanHistoryId}
            isOwner={Boolean(scanHistoryId)}
            onDeleted={onReset}
            onVerified={onFindingsUpdated}
            onSummaryGenerated={setAiSummary}
            isPublic={isPublic}
            onPrivacyChanged={setIsPublic}
          />
        </div>
      </div>

      {authReport?.status === "lost" && (
        <div className="flex items-start gap-3 rounded-md border border-[hsl(var(--severity-high))]/30 bg-[hsl(var(--severity-high))]/10 px-4 py-3">
          <AlertTriangle
            aria-hidden
            className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--severity-high))]"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[hsl(var(--severity-high))]">
              Session dropped mid-scan
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-foreground/90">
              The scanner signed in but lost the session before the run finished
              {authReport.reason ? `: ${authReport.reason}` : "."} Findings from
              after that point reflect the logged-out surface, not the
              authenticated one. Treat this report as partial.
            </p>
          </div>
        </div>
      )}

      <ScanResultDetail
        result={{ ...displayResult, findings: findingsWithRemediation }}
        onSelectIssue={onSelectIssue}
        canRemediate
        crawlInfo={crawlInfo}
        screenshotSrc={
          displayResult.screenshot && scanHistoryId
            ? API.SCAN_SCREENSHOT(scanPublicId ?? scanHistoryId)
            : undefined
        }
        screenshotRefreshScanId={scanPublicId ?? scanHistoryId ?? undefined}
        onScreenshotRefreshed={setScreenshotOverride}
        refreshScanId={scanHistoryId ?? undefined}
        onDnsRefreshed={setDnsOverride}
        onPortRefreshed={setPortScanOverride}
        subdomain={
          <SubdomainDiscovery
            url={result.url}
            onScanSubdomain={onScanSubdomain}
            initialResult={result.subdomains ?? null}
          />
        }
        panelFooter={
          scanHistoryId ? (
            <>
              {/* HistoryTagsCard has a closed prop list and lives under
                  components/history, so the tour's anchor goes on a wrapper
                  here. Block-level, inside a column, so it changes no layout. */}
              <div {...tourAnchor("scanTags")}>
                <HistoryTagsCard
                  scanId={scanHistoryId}
                  tags={scanTags}
                  onAdd={onAddTag}
                  onRemove={onRemoveTag}
                />
              </div>
              <HistoryNotes
                notes={scanNotes}
                isOwner={true}
                onSave={onSaveNotes}
              />
            </>
          ) : undefined
        }
        emptyFindings={
          /* Only when the scan actually finished. This override was passed
             unconditionally, which made ScanResultDetail's own "no findings,
             but this scan did not finish" branch unreachable on /dashboard:
             a run whose DNS or TLS branch timed out with zero findings was
             told "Every enabled check ran and none of them fired", directly
             under a summary card that had correctly called it partial. The
             other three surfaces that render a scan (history, shared, host)
             pass no override and always got the warning.

             A clean scan is the best result this product returns, so it is
             drawn as a verdict (success tone, the same shield the summary
             above uses) rather than as the grey "nothing here yet" box it
             rendered as before, which read identically to an empty asset
             list. */
          (displayResult.incomplete ?? []).length > 0 ? undefined : (
            <EmptyState
              icon={ShieldCheck}
              tone="success"
              title="Zero findings on this host"
              description="Every enabled check ran and none of them fired. Add a note so you know what state the host was in, or scan another target."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onReset}
                  className="h-8 gap-1.5 bg-transparent"
                >
                  <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                  New scan
                </Button>
              }
            />
          )
        }
      />
    </div>
  );
}
