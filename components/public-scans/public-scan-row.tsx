import Image from "next/image";
import Link from "next/link";
import { User, Clock } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { SEVERITY_LEVELS, STAFF_ROLES } from "@/lib/config/constants";
import { SeverityPill } from "@/components/history/severity-pill";
import { ScanTags } from "@/components/history/scan-tags";
import { VERDICT, formatRelativeTime, displayUrl } from "./public-scans-types";
import type { PublicScan } from "./public-scans-types";

export function PublicScanRow({ scan }: { scan: PublicScan }) {
  const verdict = VERDICT[scan.verdict];
  const critical = scan.summary.critical || 0;
  const high = scan.summary.high || 0;
  const medium = scan.summary.medium || 0;
  const low = scan.summary.low || 0;

  return (
    <Link
      href={`/shared/${scan.token}`}
      className="group relative flex flex-col gap-2.5 border-l-2 border-transparent py-3.5 pl-4 pr-4 transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid sm:grid-cols-[1fr,150px,150px,90px] sm:items-center sm:gap-4"
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-[3px]", verdict.rail)}
      />

      {/* URL + tags */}
      <div className="min-w-0">
        <p className="truncate font-mono text-sm font-medium text-foreground">
          {displayUrl(scan.url)}
        </p>
        {scan.tags.length > 0 && (
          <ScanTags
            scanId={0}
            tags={scan.tags}
            onAdd={() => {}}
            onRemove={() => {}}
            readOnly
            revealOnHover={false}
            className="mt-1"
          />
        )}
      </div>

      {/* Verdict */}
      <div className="flex items-center">
        <span className={cn("text-xs font-medium", verdict.text)}>
          {scan.verdict === "safe"
            ? "Clean"
            : scan.verdict === "caution"
              ? "Caution"
              : "Exploitable"}
        </span>
      </div>

      {/* Severity counts */}
      <div className="flex flex-wrap items-center gap-1">
        {critical === 0 && high === 0 && medium === 0 && low === 0 ? (
          <span className="text-xs text-muted-foreground">
            {scan.findingsCount === 0
              ? "0 findings"
              : `${scan.findingsCount} info`}
          </span>
        ) : (
          <>
            <SeverityPill
              severity={SEVERITY_LEVELS.CRITICAL}
              count={critical}
            />
            <SeverityPill severity={SEVERITY_LEVELS.HIGH} count={high} />
            <SeverityPill severity={SEVERITY_LEVELS.MEDIUM} count={medium} />
            <SeverityPill severity={SEVERITY_LEVELS.LOW} count={low} />
          </>
        )}
      </div>

      {/* Scanned by + when */}
      <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end sm:justify-center sm:gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {scan.scannedByAvatar ? (
            <Image
              src={scan.scannedByAvatar}
              alt=""
              width={14}
              height={14}
              className="h-3.5 w-3.5 shrink-0 rounded-full object-cover"
            />
          ) : (
            <User aria-hidden className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">
            {scan.scannedByRole !== STAFF_ROLES.USER ? (
              <span className="font-medium text-primary">{scan.scannedBy}</span>
            ) : (
              scan.scannedBy
            )}
          </span>
        </span>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock aria-hidden className="h-3 w-3" />
          {formatRelativeTime(scan.scannedAt)}
        </span>
      </div>
    </Link>
  );
}
