import type { PublicScan } from "./public-scans-types";
import { PublicScanRow } from "./public-scan-row";

export function PublicScansTable({ scans }: { scans: PublicScan[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="hidden sm:grid grid-cols-[1fr,150px,150px,90px] gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <div>Site</div>
        <div>Verdict</div>
        <div>Findings</div>
        <div className="text-right">Scanned by</div>
      </div>
      <div className="divide-y divide-border">
        {scans.map((scan) => (
          <PublicScanRow key={scan.token} scan={scan} />
        ))}
      </div>
    </div>
  );
}
