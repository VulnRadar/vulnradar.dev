import { Skeleton } from "@/components/ui/skeleton";
import { SEVERITY_ORDER } from "@/components/scanner/severity-badge";

/**
 * The loading shape of ScanResultDetail: the verdict panel, the "More about
 * this host" panel stack, and the findings list with its toolbar.
 *
 * One copy, because there were two. components/scanner/shared-scan-skeleton.tsx
 * and components/history/history-detail-skeleton.tsx held byte-identical
 * versions of everything below, differing only in a FINDING_ROW_COUNT that had
 * already drifted (4 on one, 5 on the other). Both now compose this and keep
 * only their own header chrome, so the next correction to the real component
 * lands in one place instead of needing to be noticed twice.
 */

/**
 * Readout cells in ScanSummary's instrument strip: risk score, SSL grade,
 * engine confidence, checks run, duration, scanned. Each is conditional on the
 * scan carrying that field, so this is the full-scan case rather than a
 * guaranteed count. It was 3, which on a phone is the difference between one
 * wrapped row and two, since the strip is flex-wrap with a basis-24 floor.
 */
const READOUT_COUNT = 6;

/**
 * DnsRecordsPanel, PortScanPanel, ThreatIntelPanel, SoftwareInventoryPanel and
 * the subdomain block all render unconditionally (each handles its own empty
 * state), collapsed to a single row. Screenshot and response headers are on top
 * of that when the scan captured them. This used to be one h-24 box, which is
 * roughly half of what actually arrives.
 */
const HOST_PANEL_COUNT = 5;
const COLLAPSED_PANEL = "h-[46px] w-full rounded-xl";

const FINDING_ROW_COUNT = 5;

/** SectionRule's real geometry: border-t, pt-5, gap-1, heading over a hint. */
function SectionRuleSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border/50 pt-5">
      <Skeleton className={`h-3 ${titleWidth}`} />
      <Skeleton className="h-3 w-64 max-w-full" />
    </div>
  );
}

export function ScanDetailSkeleton() {
  return (
    <>
      {/* ScanSummary's verdict panel. Matched to its real geometry (44px
          glyph, a two-line headline at text-2xl, the readout strip with no
          icon tiles) so the panel does not jump a row taller the moment the
          scan resolves. */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-1 gap-6 py-5 pl-5 pr-4 sm:py-7 sm:pl-7 sm:pr-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] lg:gap-9">
          <div className="flex gap-4">
            <Skeleton className="h-11 w-11 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <Skeleton className="h-6 w-64 max-w-full" />
              <Skeleton className="h-4 w-full max-w-sm" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
          {/* The divider and the 36px inset the real right column carries.
              Without them the column shifted right and grew a rule the moment
              the scan landed. */}
          <div className="flex flex-col gap-3 lg:border-l lg:border-border/70 lg:pl-9">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-4 w-full max-w-xs" />
          </div>
        </div>
        <div className="flex flex-wrap items-stretch divide-x divide-border border-t border-border bg-muted/30">
          {Array.from({ length: READOUT_COUNT }).map((_, i) => (
            <div
              key={i}
              className="flex min-w-0 flex-1 basis-24 flex-col gap-1.5 px-3.5 py-2.5 sm:px-4"
            >
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionRuleSkeleton titleWidth="w-32" />
        {Array.from({ length: HOST_PANEL_COUNT }).map((_, i) => (
          <Skeleton key={i} className={COLLAPSED_PANEL} />
        ))}
      </div>

      <SectionRuleSkeleton titleWidth="w-20" />

      {/* ResultsList opens with its own controls, not with the list. Leaving
          them out put roughly 120px of toolbar between the section rule and
          the first row the instant the findings arrived. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Skeleton className="h-9 flex-1 rounded-md" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-36 rounded-md" />
            <Skeleton className="h-9 w-40 rounded-md" />
          </div>
        </div>

        {/* Severity filter strip: one cell per severity, and it doubles as the
            legend, so the cell count is the severity scale itself. */}
        <div className="flex divide-x divide-border overflow-hidden rounded-xl border border-border bg-card">
          {SEVERITY_ORDER.map((sev) => (
            <div
              key={sev}
              className="flex min-w-[64px] flex-1 flex-col gap-1 px-2 py-2 sm:min-w-[76px] sm:px-3"
            >
              <Skeleton className="h-[18px] w-6" />
              <Skeleton className="h-2.5 w-12" />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-9 w-24 shrink-0 rounded-full sm:h-7"
            />
          ))}
        </div>

        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {Array.from({ length: FINDING_ROW_COUNT }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="h-5 w-16 shrink-0 rounded-md" />
              <Skeleton className="h-4 min-w-0 flex-1" />
              <Skeleton className="h-4 w-4 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
