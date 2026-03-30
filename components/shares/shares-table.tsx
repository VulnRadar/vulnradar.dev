import type { Share } from "./shares-types"
import { SharesRow } from "./shares-row"

interface SharesTableProps {
  shares: Share[]
  revoking: number | null
  onRevoke: (id: number) => void
  onOpenShareModal: (share: Share) => void
}

export function SharesTable({ shares, revoking, onRevoke, onOpenShareModal }: SharesTableProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      {/* Table header - hidden on mobile */}
      <div className="hidden sm:grid grid-cols-[1fr,100px,100px,130px,80px] gap-4 px-5 py-3 border-b border-border/50 bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <div>URL</div>
        <div>Status</div>
        <div>Issues</div>
        <div>Shared</div>
        <div className="text-right">Actions</div>
      </div>

      <div className="divide-y divide-border/50">
        {shares.map((share) => (
          <SharesRow
            key={share.id}
            share={share}
            revoking={revoking === share.id}
            onRevoke={onRevoke}
            onOpenShareModal={onOpenShareModal}
          />
        ))}
      </div>
    </div>
  )
}
