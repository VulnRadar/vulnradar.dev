"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";
import { ScanSummary } from "./scan-summary";
import { ResultsList } from "./results-list";
import { CrawlPagesInfo } from "./crawl-pages-info";

const ScreenshotPanel = dynamic(() =>
  import("./screenshot-panel").then((m) => ({ default: m.ScreenshotPanel })),
);
const ResponseHeaders = dynamic(() =>
  import("./response-headers").then((m) => ({ default: m.ResponseHeaders })),
);
const DnsRecordsPanel = dynamic(() =>
  import("./dns-records-panel").then((m) => ({ default: m.DnsRecordsPanel })),
);
const PortScanPanel = dynamic(() =>
  import("./port-scan-panel").then((m) => ({ default: m.PortScanPanel })),
);
const ThreatIntelPanel = dynamic(() =>
  import("./threat-intel-panel").then((m) => ({ default: m.ThreatIntelPanel })),
);
const SoftwareInventoryPanel = dynamic(() =>
  import("./software-inventory-panel").then((m) => ({
    default: m.SoftwareInventoryPanel,
  })),
);

/** Shape of the crawl result_meta every full renderer passes through. */
export interface CrawlPageData {
  url: string;
  findings: Vulnerability[];
  findings_count: number;
  summary: Record<string, number>;
  duration: number;
}

export interface CrawlInfo {
  pagesDiscovered: number;
  pagesScanned: number;
  pages: CrawlPageData[];
}

export interface ScanResultDetailProps {
  result: ScanResult;
  onSelectIssue: (issue: Vulnerability) => void;
  crawlInfo?: CrawlInfo | null;
  /** Host report only: its `duration` is synthetic, so hide the "in Ns" line. */
  hideDuration?: boolean;
  /**
   * The full "More about this host" panel set (screenshot, DNS, ports, threat
   * intel, software inventory, plus the subdomain/footer slots). Defaults on.
   * The host-aggregate report sets this false: its data source only carries
   * response headers, so it shows just those under the same heading.
   */
  extendedPanels?: boolean;
  /** Rendered right after the verdict summary. Host report uses it for the trend chart. */
  afterSummary?: ReactNode;
  /** Screenshot image URL. Combined with `result.screenshot`, gates the panel. */
  screenshotSrc?: string;
  /** Owner only: enables the screenshot re-capture control. */
  screenshotRefreshScanId?: string | number;
  onScreenshotRefreshed?: (screenshot: ScanResult["screenshot"]) => void;
  /** Owner only: enables the DNS + port on-demand fetch/refresh controls. */
  refreshScanId?: string | number;
  onDnsRefreshed?: (records: ScanResult["dnsRecords"]) => void;
  onPortRefreshed?: (portScan: ScanResult["portScan"]) => void;
  /** The <SubdomainDiscovery> element, whose owner/read-only mode differs per surface. */
  subdomain?: ReactNode;
  /** Tags + notes cards (owner) or a read-only note (shared). Sits at the end of the panel block. */
  panelFooter?: ReactNode;
  /** Overrides the zero-findings block (the dashboard adds a "New scan" action). */
  emptyFindings?: ReactNode;
}

const SECTION_HEADING =
  "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

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
  extendedPanels = true,
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
}: ScanResultDetailProps) {
  const hasResponseHeaders =
    !!result.responseHeaders && Object.keys(result.responseHeaders).length > 0;

  return (
    <>
      <ScanSummary result={result} hideHeader hideDuration={hideDuration} />

      {afterSummary}

      {crawlInfo && crawlInfo.pages.length > 1 && (
        <CrawlPagesInfo crawlInfo={crawlInfo} onSelectIssue={onSelectIssue} />
      )}

      {extendedPanels ? (
        <div className="flex flex-col gap-3 border-t border-border/50 pt-5">
          <h2 className={SECTION_HEADING}>More about this host</h2>

          {result.screenshot && screenshotSrc && (
            <ScreenshotPanel
              src={screenshotSrc}
              url={result.url}
              width={result.screenshot.width}
              height={result.screenshot.height}
              capturedAt={result.screenshot.capturedAt}
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

          <SoftwareInventoryPanel
            softwareInventory={result.softwareInventory}
          />

          {subdomain}

          {panelFooter}
        </div>
      ) : (
        hasResponseHeaders && (
          <div className="flex flex-col gap-3 border-t border-border/50 pt-5">
            <h2 className={SECTION_HEADING}>More about this host</h2>
            <ResponseHeaders headers={result.responseHeaders!} />
          </div>
        )
      )}

      {result.findings.length > 0 ? (
        <ResultsList findings={result.findings} onSelectIssue={onSelectIssue} />
      ) : (
        (emptyFindings ?? (
          <div className="rounded-md border border-dashed border-border bg-card/50 px-4 py-10 text-center">
            <p className="text-sm font-semibold text-[hsl(var(--success))]">
              Nothing found on this scan
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every enabled check ran against this host and none of them fired.
            </p>
          </div>
        ))
      )}
    </>
  );
}
