"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Share2, ExternalLink, ShieldCheck } from "lucide-react";
import { OG_INSPECT_URL_TEMPLATE } from "@/lib/config/client-constants";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { EmptyState } from "@/components/shared/empty-state";
import { ScanSummary } from "./scan-summary";
import { ResultsList } from "./results-list";
import {
  CrawlPagesInfo,
  type CrawlInfo,
  type CrawlPageData,
} from "./crawl-pages-info";

/**
 * Every panel in the "More about this host" block collapses to one row: a
 * rounded-xl card at px-4 py-3 around a 20px line, so 46px.
 *
 * None of these code-split panels passed a `loading` fallback, and a dynamic()
 * without one renders nothing at all while its chunk is in flight. The block
 * was therefore 0px tall on first paint on all four result surfaces
 * (dashboard, history, /shared, /host) and then pushed the findings list down
 * by several rows at once. It is also why a single h-24 box in the scan
 * skeletons looked plausible: the loaded page really was that short for a
 * moment.
 */
function PanelRowFallback() {
  return (
    <div
      aria-hidden
      className="h-[46px] w-full animate-pulse rounded-xl border border-border bg-card"
    />
  );
}

const ScreenshotPanel = dynamic(
  () =>
    import("./screenshot-panel").then((m) => ({ default: m.ScreenshotPanel })),
  { loading: PanelRowFallback },
);
const ResponseHeaders = dynamic(
  () =>
    import("./response-headers").then((m) => ({ default: m.ResponseHeaders })),
  { loading: PanelRowFallback },
);
const DnsRecordsPanel = dynamic(
  () =>
    import("./dns-records-panel").then((m) => ({ default: m.DnsRecordsPanel })),
  { loading: PanelRowFallback },
);
const PortScanPanel = dynamic(
  () => import("./port-scan-panel").then((m) => ({ default: m.PortScanPanel })),
  { loading: PanelRowFallback },
);
// These two deliberately have no fallback: each returns null when the scan
// carries no threat-intel or software data, and that check lives inside the
// panel. Reserving a row for something that may never render would trade one
// reflow for the opposite one, and duplicating the predicate out here is
// exactly the kind of copy that drifts.
const ThreatIntelPanel = dynamic(() =>
  import("./threat-intel-panel").then((m) => ({ default: m.ThreatIntelPanel })),
);
const SoftwareInventoryPanel = dynamic(() =>
  import("./software-inventory-panel").then((m) => ({
    default: m.SoftwareInventoryPanel,
  })),
);

// Re-exported so existing importers keep resolving these from here; the
// canonical definitions live in ./crawl-pages-info.
export type { CrawlInfo, CrawlPageData };

export interface ScanResultDetailProps {
  result: ScanResult;
  onSelectIssue: (issue: Vulnerability) => void;
  crawlInfo?: CrawlInfo | null;
  /** Host report only: its `duration` is synthetic, so hide the "in Ns" line. */
  hideDuration?: boolean;
  /** Rendered right after the verdict summary. Host report uses it for the trend chart. */
  afterSummary?: ReactNode;
  /** Screenshot image URL. Absent when this scan has no screenshot. */
  screenshotSrc?: string;
  /** Owner only: enables the screenshot capture / re-capture control. Also
   *  renders the panel for a scan that has NO screenshot yet, so an owner who
   *  left the option off can capture one without re-running the whole scan. */
  screenshotRefreshScanId?: string | number;
  onScreenshotRefreshed?: (screenshot: ScanResult["screenshot"]) => void;
  /** Owner only: enables the DNS + port on-demand fetch/refresh controls,
   *  including on a scan that carries neither yet (a scan run without the
   *  port-scan option, or one whose DNS cache was cold). Both panels render
   *  nothing at all when this is absent, which is what the public /host and
   *  /shared views want. */
  refreshScanId?: string | number;
  onDnsRefreshed?: (records: ScanResult["dnsRecords"]) => void;
  onPortRefreshed?: (portScan: ScanResult["portScan"]) => void;
  /** The <SubdomainDiscovery> element, whose owner/read-only mode differs per surface. */
  subdomain?: ReactNode;
  /** Tags + notes cards (owner) or a read-only note (shared). Sits at the end of the panel block. */
  panelFooter?: ReactNode;
  /** Overrides the zero-findings block (the dashboard adds a "New scan" action). */
  emptyFindings?: ReactNode;
  /** Owner only: turns on the findings list's multi-select bulk remediation
   *  bar. Set on the owner's own scan surfaces (dashboard, history); left off
   *  on the public host and shared-token views, which have no remediation. */
  canRemediate?: boolean;
}

const SECTION_HEADING =
  "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/** Rule + label that opens each of the two sections under the verdict, so the
 *  page reads as "the answer, then its two bodies of evidence" rather than as
 *  one undifferentiated stack of cards. The findings section had no heading at
 *  all before, which left the host panels looking like the labelled part of
 *  the page and the actual security result looking like an afterthought. */
function SectionRule({
  title,
  hint,
  aside,
}: {
  title: string;
  hint: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-border/50 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className={SECTION_HEADING}>{title}</h2>
        {aside}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * The body every scan-result surface shares: verdict summary, the "More about
 * this host" panel block, and the findings list. Rendered as a fragment so each
 * page's own flex container controls the spacing (and keeps its own header/CTA
 * chrome as siblings). Extracted from four hand-assembled copies
 * (components/scanner/dashboard-results.tsx, app/history/page.tsx,
 * app/shared/[token]/page.tsx, app/host/[hostname]/page.tsx) that had drifted --
 * SSL grade, threat intel, and software inventory were showing on some and not
 * others. One assembly means a field added to ScanResult can't quietly go
 * missing on one surface again.
 */
export function ScanResultDetail({
  result,
  onSelectIssue,
  crawlInfo,
  hideDuration,
  afterSummary,
  screenshotSrc,
  screenshotRefreshScanId,
  onScreenshotRefreshed,
  refreshScanId,
  onDnsRefreshed,
  onPortRefreshed,
  subdomain,
  panelFooter,
  emptyFindings,
  canRemediate,
}: ScanResultDetailProps) {
  const hasResponseHeaders =
    !!result.responseHeaders && Object.keys(result.responseHeaders).length > 0;

  // Branch keys the scanner records in ScanResult.incomplete, mapped to
  // words a user recognises. Anything unrecognised falls through as-is
  // rather than being dropped, so a new branch still surfaces.
  const INCOMPLETE_LABELS: Record<string, string> = {
    dns: "DNS records",
    tls: "TLS and certificate checks",
    "live-fetch": "Live page fetch",
  };
  const incompleteAreas = (result.incomplete ?? []).map(
    (area) => INCOMPLETE_LABELS[area] ?? area,
  );

  return (
    <>
      {/* Suppress the redirect warning for an authenticated scan: if the user
          supplied a login and it held (the target returned 200 as the real
          page, so this scan IS of the page they wanted), telling them it's
          "behind a login" would be wrong. Authenticated scans go through a
          different executor that doesn't record a redirect at all, so this is a
          belt-and-suspenders guard for any result that carries both. */}
      {result.redirect && !result.authenticated && (
        <div className="flex items-start gap-2.5 rounded-lg border border-[hsl(var(--warning))]/25 bg-[hsl(var(--warning))]/5 px-3.5 py-3">
          <AlertTriangle
            aria-hidden
            className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]"
          />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">
              {result.redirect.kind === "login"
                ? "This page is behind a login"
                : "The scanned page redirected"}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {result.redirect.reason}
            </p>
            <p className="break-all font-mono text-[11px] text-muted-foreground/70">
              {result.redirect.requestedUrl} &rarr; {result.redirect.finalUrl}
            </p>
          </div>
        </div>
      )}

      <ScanSummary result={result} hideHeader hideDuration={hideDuration} />

      {afterSummary}

      {/* Context first, findings second, on every surface. An earlier pass had
          this the other way round (findings straight under the summary, the
          panels last) on the theory that infrastructure detail is trivia in
          front of the security result. The owner reads a report the opposite
          way: what the host is, then what is wrong with it. Because all four
          result surfaces render through this one component, the order only
          has to be right here. The panels are all collapsed by default, so
          this costs roughly one screen-line each before the findings start. */}
      <div className="flex flex-col gap-3">
        <SectionRule
          title="More about this host"
          hint="Infrastructure captured during this scan. The findings are below."
          aside={
            /* Social/OG preview lives off our engine: a link-out to a
               third-party inspector rather than something we fetch. */
            OG_INSPECT_URL_TEMPLATE && result.url ? (
              <a
                href={OG_INSPECT_URL_TEMPLATE.replace(
                  "{url}",
                  encodeURIComponent(result.url),
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Share2 aria-hidden className="h-3.5 w-3.5" />
                Preview social cards
                <ExternalLink aria-hidden className="h-3 w-3 opacity-70" />
              </a>
            ) : undefined
          }
        />

        {/* Two ways in: there is an image to show, or the viewer owns the scan
            and may capture one. The second is why this is not gated on
            `result.screenshot` any more: a scan run without ticking the
            screenshot option rendered no panel at all, so the only route to a
            screenshot was re-running the whole scan. /shared and /host pass no
            refresh id, so they still show the panel only when an image exists. */}
        {(screenshotSrc || screenshotRefreshScanId) && (
          <ScreenshotPanel
            src={screenshotSrc}
            url={result.url}
            width={result.screenshot?.width}
            height={result.screenshot?.height}
            capturedAt={result.screenshot?.capturedAt}
            scanId={screenshotRefreshScanId}
            onRefreshed={onScreenshotRefreshed}
          />
        )}

        {hasResponseHeaders && (
          <ResponseHeaders headers={result.responseHeaders!} />
        )}

        <DnsRecordsPanel
          records={result.dnsRecords}
          scanId={refreshScanId}
          onRefreshed={onDnsRefreshed}
        />

        <PortScanPanel
          portScan={result.portScan}
          scanId={refreshScanId}
          onRefreshed={onPortRefreshed}
        />

        <ThreatIntelPanel threatIntel={result.threatIntel} />

        <SoftwareInventoryPanel softwareInventory={result.softwareInventory} />

        {subdomain}

        {panelFooter}
      </div>

      <div className="flex flex-col gap-3">
        <SectionRule
          title="Findings"
          hint={
            result.findings.length > 0
              ? "Sorted most severe first. Open one for the evidence and the fix."
              : "Nothing to triage on this scan."
          }
          aside={
            result.findings.length > 0 ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {result.findings.length}{" "}
                {result.findings.length === 1 ? "finding" : "findings"}
              </span>
            ) : undefined
          }
        />

        {/* Stays directly above the findings list: it selects whose findings you
            are reading. */}
        {crawlInfo && crawlInfo.pages.length > 1 && (
          <CrawlPagesInfo crawlInfo={crawlInfo} onSelectIssue={onSelectIssue} />
        )}

        {result.findings.length > 0 ? (
          <ResultsList
            findings={result.findings}
            onSelectIssue={onSelectIssue}
            scanUrl={canRemediate ? result.url : undefined}
          />
        ) : (
          (emptyFindings ??
          (incompleteAreas.length > 0 ? (
            /* A no-findings result is only a clean result if everything
               actually ran. ScanResult.incomplete lists branches that did not
               finish inside the time budget, and its contract (lib/scanner/
               types.ts) is explicit that a listed area means "not checked",
               not "checked and clean". Reporting a partial scan as clean is
               the worst failure mode this product has, so say what is
               missing and offer the rescan instead. */
            <EmptyState
              icon={AlertTriangle}
              tone="warning"
              title="No findings, but this scan did not finish"
              description={
                <>
                  {incompleteAreas.join(", ")}{" "}
                  {incompleteAreas.length === 1 ? "did" : "did"} not complete
                  within the time budget, so{" "}
                  {incompleteAreas.length === 1
                    ? "that area was"
                    : "those areas were"}{" "}
                  not checked. Treat this as an incomplete result rather than a
                  clean one, and run the scan again.
                </>
              }
            />
          ) : (
            /* The best news this product delivers, and it used to render at
               size="sm" with no icon: a small green sentence in a dashed box,
               indistinguishable at a glance from "no assets yet". Full size
               and the same shield the verdict above uses. */
            <EmptyState
              icon={ShieldCheck}
              tone="success"
              title="Nothing found on this scan"
              description="Every enabled check ran against this host and none of them fired."
            />
          )))
        )}
      </div>
    </>
  );
}
