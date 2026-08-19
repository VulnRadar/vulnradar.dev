"use client";

import { Tag } from "lucide-react";
import { ScanTags } from "./scan-tags";
import type { ScanTag } from "./history-types";

interface HistoryTagsCardProps {
  scanId: string | number;
  tags: ScanTag[];
  onAdd: (scanId: string | number, tag: string) => void;
  onRemove: (scanId: string | number, tag: string) => void;
  /** Hides the "+ Add tag" control -- for a viewer who isn't this scan's
   *  owner. When readOnly and there are no tags, the whole card is hidden
   *  rather than shown empty, same as HistoryNotes on a public page. */
  readOnly?: boolean;
}

/**
 * Tags as a "More about this host" row, matching HistoryNotes' bordered-card
 * treatment (icon + label header, content below) instead of the cramped
 * pill row that used to sit directly under the URL on every result-detail
 * view. Shared by app/history/page.tsx, components/scanner/dashboard-results.tsx,
 * and app/shared/[token]/page.tsx.
 */
export function HistoryTagsCard({
  scanId,
  tags,
  onAdd,
  onRemove,
  readOnly = false,
}: HistoryTagsCardProps) {
  if (readOnly && tags.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium text-foreground">Tags</h3>
      </div>
      <ScanTags
        scanId={scanId}
        tags={tags}
        onAdd={onAdd}
        onRemove={onRemove}
        readOnly={readOnly}
        revealOnHover={false}
      />
    </div>
  );
}
