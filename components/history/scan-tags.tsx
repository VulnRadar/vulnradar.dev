"use client";

import { useId, useState } from "react";
import { Tag, Sparkles, Plus, X } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { CONFIG_MAX_TAG_LENGTH } from "@/lib/config/config-values";
import type { ScanTag, TagMutationResult } from "./history-types";

/**
 * scan_tags.tag is VARCHAR(50) in the database (see instrumentation.ts). This
 * is the hard column guard, nothing more.
 */
const MAX_CLIENT_TAG_LENGTH = 50;

/**
 * What the server will actually keep. app/api/v3/scan/tags/route.ts does not
 * reject an overlong tag, it silently truncates to the MAX_TAG_LENGTH setting,
 * so a 45-character tag used to be accepted by this form, sent, shortened, and
 * come back as a different string than the user typed, right after the error
 * copy had promised them 50 characters were fine.
 *
 * This is the value the deployment ships with, not the live admin-editable
 * one: /api/v3/config/client does not carry MAX_TAG_LENGTH yet. An admin who
 * lowers the setting can still truncate a tag that this form accepted, which
 * is why the copy below says the limit is where tags get shortened rather than
 * promising a number as a hard rule.
 */
const SERVER_TAG_LENGTH = CONFIG_MAX_TAG_LENGTH;

interface ScanTagsProps {
  // Opaque public_id (History list) or a numeric id (the dashboard's
  // just-completed result). The tags route resolves either shape.
  scanId: string | number;
  tags: ScanTag[];
  /** Both resolve to null when the change stuck, or to the message to show.
   *  These used to be fire-and-forget: the input closed the instant it was
   *  called and nothing awaited the request, so two racing writes could
   *  leave the chip row disagreeing with the server with no error path to
   *  notice it. */
  onAdd: (scanId: string | number, tag: string) => TagMutationResult;
  onRemove: (scanId: string | number, tag: string) => TagMutationResult;
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
  const [pending, setPending] = useState(false);
  // a11y (SC 1.3.1 / 3.3.1): the tag-rejected message was tied to the input
  // by nothing but sitting under it, so a screen-reader user typing an
  // invalid tag got no announcement and no way to find out why nothing
  // happened. aria-describedby links them and role="alert" announces it.
  const errorId = useId();

  const userTagNames = new Set(
    tags.filter((t) => t.source === "user").map((t) => t.tag.toLowerCase()),
  );

  async function submitTag() {
    if (pending) return;
    const trimmed = newTag.trim();
    if (!trimmed) {
      setAdding(false);
      setNewTag("");
      return;
    }
    if (trimmed.length > SERVER_TAG_LENGTH) {
      setError(
        `Tags are shortened to ${SERVER_TAG_LENGTH} characters when saved.`,
      );
      return;
    }
    if (userTagNames.has(trimmed.toLowerCase())) {
      setError("That tag is already on this scan.");
      return;
    }
    setPending(true);
    const failure = await onAdd(scanId, trimmed);
    setPending(false);
    if (failure) {
      // Keep the input open with the text in it, same reasoning as the
      // notes editor: a closed input reads as a saved tag.
      setError(failure);
      return;
    }
    setAdding(false);
    setNewTag("");
    setError(null);
  }

  async function removeTag(tag: string) {
    if (pending) return;
    setPending(true);
    const failure = await onRemove(scanId, tag);
    setPending(false);
    if (failure) setError(failure);
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
                disabled={pending}
                aria-label={`Dismiss auto tag ${t.tag}: not accurate for this scan`}
                title="Tell us this tag is wrong for this scan"
                className="ml-0.5 hover:text-destructive disabled:opacity-50"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(t.tag);
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
                disabled={pending}
                aria-label={`Remove tag ${t.tag}`}
                className="ml-0.5 hover:text-destructive disabled:opacity-50"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(t.tag);
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
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
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
              maxLength={Math.min(SERVER_TAG_LENGTH, MAX_CLIENT_TAG_LENGTH)}
              disabled={pending}
              className="w-20 text-base sm:text-[10px] px-1.5 py-0.5 rounded-md border border-primary/30 bg-background text-foreground focus:outline-hidden disabled:opacity-60"
              autoFocus
            />
          </span>
          {error && (
            <span
              id={errorId}
              role="alert"
              className="text-[10px] text-destructive"
            >
              {error}
            </span>
          )}
        </span>
      ) : (
        <button
          type="button"
          aria-label="Add tag"
          className={cn(
            // a11y (target size): min-h-6 lifts the 18px-tall chip the
            // comment below already measured up to the 24px floor without
            // changing the type size or the dashed-chip look.
            "inline-flex min-h-6 items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors",
            // opacity-0 hides the button but leaves it clickable, and a
            // phone never hovers, so an invisible ~24x18px target sat
            // directly under every history row's URL and ate the tap that
            // was meant to open the scan. pointer-events-none is what
            // actually takes it out of the way, restored the moment the row
            // is hovered or focused.
            revealOnHover &&
              "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto",
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
