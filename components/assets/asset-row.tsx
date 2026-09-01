"use client";

import Link from "next/link";
import { Clock, Lock } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { ROUTES, SEVERITY_LEVELS } from "@/lib/config/client-constants";
import { VERDICT } from "@/components/public-scans/public-scans-types";
import { SeverityPill } from "@/components/history/severity-pill";
import { formatRelativeTime, formatDate, type AssetRow } from "./assets-types";

const VERDICT_LABEL: Record<AssetRow["safetyRating"], string> = {
  safe: "Clean",
  caution: "Caution",
  unsafe: "Exploitable",
};

/**
 * One host row: links to that host's existing aggregate report at
 * /host/[hostname] (app/host/[hostname]/page.tsx) -- but only when the
 * latest scan is public. That page reads host_reputation, which every
 * private scan is deliberately excluded from (see its own doc comment),
 * so linking a private scan there would land on "hasn't been scanned
 * yet" for a host the caller very much just scanned. A private latest
 * scan links to History instead, where the caller can actually see it.
 * Same rail/verdict language as components/public-scans/public-scan-row.tsx
 * so "Clean / Caution / Exploitable" reads identically everywhere it appears.
 */
export function AssetRowItem({ asset }: { asset: AssetRow }) {
  const verdict = VERDICT[asset.safetyRating];
  const summary = asset.summary || {};

  return (
    <Link
      href={asset.isPublic ? ROUTES.HOST(asset.host) : ROUTES.HISTORY}
      className="group relative flex flex-col gap-2.5 border-l-2 border-transparent py-3.5 pl-4 pr-4 transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid sm:grid-cols-[1fr_110px_1fr_110px] sm:items-center sm:gap-4"
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-[3px]", verdict.rail)}
      />

      {/* Host + scan count */}
      <div className="min-w-0">
        <p className="truncate font-mono text-sm font-medium text-foreground">
          {asset.host}
        </p>
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {asset.scanCount} {asset.scanCount === 1 ? "scan" : "scans"}
          {!asset.isPublic && (
            <span
              className="inline-flex items-center gap-0.5"
              title="Latest scan is private -- view it from History instead of this host's public page."
            >
              <Lock aria-hidden className="h-2.5 w-2.5" />
              private
            </span>
          )}
        </p>
      </div>

      {/* Verdict */}
      <div className="flex items-center">
        <span className={cn("text-xs font-medium", verdict.text)}>
          {VERDICT_LABEL[asset.safetyRating]}
        </span>
      </div>

      {/* Severity counts from the latest scan */}
      <div className="flex flex-wrap items-center gap-1">
        {asset.findingsCount === 0 ? (
          <span className="text-xs text-muted-foreground">0 findings</span>
        ) : (
          <>
            <SeverityPill
              severity={SEVERITY_LEVELS.CRITICAL}
              count={summary.critical || 0}
            />
            <SeverityPill
              severity={SEVERITY_LEVELS.HIGH}
              count={summary.high || 0}
            />
            <SeverityPill
              severity={SEVERITY_LEVELS.MEDIUM}
              count={summary.medium || 0}
            />
            <SeverityPill
              severity={SEVERITY_LEVELS.LOW}
              count={summary.low || 0}
            />
            <SeverityPill
              severity={SEVERITY_LEVELS.INFO}
              count={summary.info || 0}
            />
          </>
        )}
      </div>

      {/* Last scanned */}
      <div
        className="flex items-center gap-1 text-[11px] text-muted-foreground sm:justify-end"
        title={formatDate(asset.latestScannedAt)}
      >
        <Clock aria-hidden className="h-3 w-3 shrink-0" />
        {formatRelativeTime(asset.latestScannedAt)}
      </div>
    </Link>
  );
}
