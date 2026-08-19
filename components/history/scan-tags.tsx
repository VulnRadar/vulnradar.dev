"use client";

import { useState } from "react";
import { Tag, Sparkles, Plus, X } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import type { ScanTag } from "./history-types";

/**
 * scan_tags.tag is VARCHAR(50) in the database (see instrumentation.ts).
 * The server truncates to the live, admin-configurable MAX_TAG_LENGTH
 * setting (30 by default) rather than rejecting an overlong tag, so this
 * is a client-side sanity check against the hard column limit, not a
 * substitute for that server-side truncation.
 */
const MAX_CLIENT_TAG_LENGTH = 50;

interface ScanTagsProps {
  // Opaque public_id (History list) or a numeric id (the dashboard's
  // just-completed result). The tags route resolves either shape.
  scanId: string | number;
  tags: ScanTag[];
  onAdd: (scanId: string | number, tag: string) => void;
  onRemove: (scanId: string | number, tag: string) => void;
  /** Hides the "+ Add tag" affordance until the row is hovered/focused. Default true. */
  revealOnHover?: boolean;
  /**
   * Hides both the remove control on user tags and the "+ Add tag"
   * affordance -- for a viewer who isn't this scan's owner (e.g. a
   * teammate). The API rejects the mutation anyway (ownership-scoped in
   * SQL), this just keeps the UI from offering a control that can't work.
   */
  readOnly?: boolean;
  className?: string;
}

/**
 * Tag chip row shared by the scan history list (components/history/history-scan-row.tsx),
 * the history detail header, and the dashboard's just-completed result view
 * -- every place a scan's tags are shown or edited. Auto tags (source =
 * 'auto', computed by lib/tags/auto-tags.ts at scan-completion time) render
 * with a Sparkles icon; user tags keep the original Tag icon. Both are
 * removable through the same `onRemove` callback -- for an auto tag this
 * is a "dismiss" (app/api/v3/scan/tags/route.ts logs which rule fired on
 * which scan to auto_tag_dismissals before dropping it from view, so the
 * dismissal survives for the admin Engine Feedback panel even though the
 * chip itself is gone), for a user tag it's a plain delete.
 */
export function ScanTags({
  scanId,
  tags,
  onAdd,
  onRemove,
  revealOnHover = true,
  readOnly = false,
  className,
}: ScanTagsProps) {
  const [adding, setAdding] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [error, setError] = useState<string | null>(null);

  const userTagNames = new Set(
    tags.filter((t) => t.source === "user").map((t) => t.tag.toLowerCase()),
  );

  function submitTag() {
    const trimmed = newTag.trim();
    if (!trimmed) {
      setAdding(false);
      setNewTag("");
      return;
    }
    if (trimmed.length > MAX_CLIENT_TAG_LENGTH) {
      setError(`Keep tags under ${MAX_CLIENT_TAG_LENGTH} characters.`);
      return;
    }
    if (userTagNames.has(trimmed.toLowerCase())) {
      setError("That tag is already on this scan.");
      return;
    }
    onAdd(scanId, trimmed);
    setAdding(false);
    setNewTag("");
    setError(null);
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((t) =>
        t.source === "auto" ? (
          <span
            key={`auto-${t.tag}`}
            title="Detected automatically from this scan's findings"
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-foreground/80 border border-border/60"
          >
            <Sparkles className="h-2.5 w-2.5 text-primary" aria-hidden />
            {t.tag}
            {!readOnly && (
              <button
                type="button"
                aria-label={`Dismiss auto tag ${t.tag}: not accurate for this scan`}
                title="Tell us this tag is wrong for this scan"
                className="ml-0.5 hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(scanId, t.tag);
                }}
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            )}
          </span>
        ) : (
          <span
            key={`user-${t.tag}`}
            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20"
          >
            <Tag className="h-2.5 w-2.5" aria-hidden />
            {t.tag}
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove tag ${t.tag}`}
                className="ml-0.5 hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(scanId, t.tag);
                }}
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            )}
          </span>
        ),
      )}

      {readOnly ? null : adding ? (
        <span
          className="inline-flex flex-col items-start gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="inline-flex items-center gap-1">
            <input
              type="text"
              aria-label="Tag name"
              value={newTag}
              onChange={(e) => {
                setNewTag(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitTag();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setAdding(false);
                  setNewTag("");
                  setError(null);
                }
              }}
              onBlur={submitTag}
              placeholder="tag"
              maxLength={MAX_CLIENT_TAG_LENGTH}
              className="w-20 text-base sm:text-[10px] px-1.5 py-0.5 rounded-md border border-primary/30 bg-background text-foreground focus:outline-none"
              autoFocus
            />
          </span>
          {error && (
            <span className="text-[10px] text-destructive">{error}</span>
          )}
        </span>
      ) : (
        <button
          type="button"
          aria-label="Add tag"
          className={cn(
            "inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors",
            revealOnHover &&
              "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
          )}
          onClick={(e) => {
            e.stopPropagation();
            setAdding(true);
            setNewTag("");
            setError(null);
          }}
        >
          <Plus className="h-2.5 w-2.5" aria-hidden />
          {/* Text label only where the button has room to breathe (the
              "More about this host" tags card) -- the dense history-row
              list keeps the icon-only, hover-revealed version. */}
          {!revealOnHover && "Add tag"}
        </button>
      )}
    </div>
  );
}
