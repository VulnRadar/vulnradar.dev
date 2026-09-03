import type { Share } from "./shares-types";
import { SharesRow } from "./shares-row";

interface SharesTableProps {
  shares: Share[];
  revoking: number | null;
  togglingPubliclyListed: number | null;
  onRevoke: (id: number) => void;
  onOpenShareModal: (share: Share) => void;
  onTogglePubliclyListed: (share: Share) => void;
}

export function SharesTable({
  shares,
  revoking,
  togglingPubliclyListed,
  onRevoke,
  onOpenShareModal,
  onTogglePubliclyListed,
}: SharesTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Table header - hidden on mobile */}
      {/* Expires is its own column. It used to be a second line inside
          "Shared", which put the one setting people come here to change
          under a header naming a different fact. */}
      <div className="hidden sm:grid grid-cols-[1fr_110px_100px_110px_120px_80px] gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <div>Target</div>
        <div>Status</div>
        <div>Findings</div>
        <div>Shared</div>
        <div>Expires</div>
        <div className="text-right">Actions</div>
      </div>

      <div className="divide-y divide-border">
        {shares.map((share) => (
          <SharesRow
            key={share.id}
            share={share}
            revoking={revoking === share.id}
            togglingPubliclyListed={togglingPubliclyListed === share.id}
            onRevoke={onRevoke}
            onOpenShareModal={onOpenShareModal}
            onTogglePubliclyListed={onTogglePubliclyListed}
          />
        ))}
      </div>
    </div>
  );
}
