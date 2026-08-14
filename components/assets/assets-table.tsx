import type { AssetRow } from "./assets-types";
import { AssetRowItem } from "./asset-row";

export function AssetsTable({ assets }: { assets: AssetRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="hidden sm:grid grid-cols-[1fr,110px,1fr,110px] gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <div>Host</div>
        <div>Rating</div>
        <div>Findings</div>
        <div className="text-right">Last scanned</div>
      </div>
      <div className="divide-y divide-border">
        {assets.map((asset) => (
          <AssetRowItem key={asset.host} asset={asset} />
        ))}
      </div>
    </div>
  );
}
