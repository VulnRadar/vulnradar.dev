"use client";

import { useId, useState } from "react";
import { Tag, Sparkles, Plus, X } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { tourAnchor } from "@/lib/tour/anchors";
import { CONFIG_MAX_TAG_LENGTH } from "@/lib/config/config-values";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditDialog } from "@/components/shared/edit-dialog";
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

export const TAG_INPUT_MAX_LENGTH = Math.min(
  SERVER_TAG_LENGTH,
  MAX_CLIENT_TAG_LENGTH,
);

/**
 * The two checks that run before a tag is sent. Returns the trimmed tag, or
 * the sentence the dialog shows instead of sending it.
 */
export function checkNewTag(
  input: string,
  tags: ScanTag[],
): { ok: true; tag: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (trimmed.length > SERVER_TAG_LENGTH) {
    return {
      ok: false,
      error: `Tags are shortened to ${SERVER_TAG_LENGTH} characters when saved.`,
    };
  }
  const userTagNames = new Set(
    tags.filter((t) => t.source === "user").map((t) => t.tag.toLowerCase()),
  );
  if (userTagNames.has(trimmed.toLowerCase())) {
    return { ok: false, error: "That tag is already on this scan." };
  }
  return { ok: true, tag: trimmed };
}

/** The add dialog's save: null when the tag stuck, otherwise the message to
 *  show while the dialog stays open with the text in it. */
export async function submitNewTag(
  scanId: string | number,
  input: string,
  tags: ScanTag[],
  onAdd: ScanTagsProps["onAdd"],
): Promise<string | null> {
  const checked = checkNewTag(input, tags);
  if (!checked.ok) return checked.error;
  return (await onAdd(scanId, checked.tag)) || null;
}

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
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function removeTag(tag: string) {
    if (pending) return;
    setPending(true);
    setRemoveError(null);
    const failure = await onRemove(scanId, tag);
    setPending(false);
    // Shown beside the chips. It used to be set into the add input's error
    // slot, which only rendered while that input was open, so a failed
    // remove said nothing at all.
    if (failure) setRemoveError(failure);
  }

  return (
    <div
      {...tourAnchor("historyTags")}
      className={cn("flex flex-wrap items-center gap-1", className)}
    >
      {tags.map((t) =>
        t.source === "auto" ? (
          <span
            key={`auto-${t.tag}`}
            title="Detected automatically from this scan's findings"
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-foreground/80 border border-border/60"
          >
            <Sparkles className="h-2.5 w-2.5 text-primary" aria-hidden />
            {t.tag}
            {/* after:-inset-2 widens the hit area without growing the box.
                The visible control is a 10px X with no padding, so the
                tappable target was about 10x10 - well under the 24px floor
                in SC 2.5.8, on a row where tags sit at gap-1 and the thing
                next to it is another tag's remove button. Same trick
                inline-auth-form.tsx already uses for its small icon
                button. */}
            {!readOnly && (
              <button
                type="button"
                disabled={pending}
                aria-label={`Dismiss auto tag ${t.tag}: not accurate for this scan`}
                title="Tell us this tag is wrong for this scan"
                className="relative z-10 ml-0.5 after:absolute after:-inset-2 hover:text-destructive disabled:opacity-50"
                onClick={() => removeTag(t.tag)}
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
                className="relative z-10 ml-0.5 after:absolute after:-inset-2 hover:text-destructive disabled:opacity-50"
                onClick={() => removeTag(t.tag)}
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            )}
          </span>
        ),
      )}

      {!readOnly && (
        <button
          type="button"
          aria-label="Add tag"
          className={cn(
            // a11y (target size): min-h-6 lifts the 18px-tall chip the
            // comment below already measured up to the 24px floor without
            // changing the type size or the dashed-chip look.
            "relative z-10 inline-flex min-h-6 items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors",
            // opacity-0 hides the button but leaves it clickable, and a
            // phone never hovers, so an invisible ~24x18px target sat
            // directly under every history row's URL and ate the tap that
            // was meant to open the scan. pointer-events-none is what
            // actually takes it out of the way, restored the moment the row
            // is hovered or focused.
            revealOnHover &&
              "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto",
          )}
          onClick={() => {
            setRemoveError(null);
            setAdding(true);
          }}
        >
          <Plus className="h-2.5 w-2.5" aria-hidden />
          {/* Text label only where the button has room to breathe (the
              "More about this host" tags card) -- the dense history-row
              list keeps the icon-only, hover-revealed version. */}
          {!revealOnHover && "Add tag"}
        </button>
      )}

      {removeError && (
        <span role="alert" className="text-[10px] text-destructive">
          {removeError}
        </span>
      )}

      {/* Mounted only while open: every history row has its own ScanTags,
          so a dialog kept closed in the tree would be one per row. It also
          means each opening starts from an empty field. */}
      {adding && !readOnly && (
        <AddTagDialog
          scanId={scanId}
          tags={tags}
          onAdd={onAdd}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

/**
 * One field, saved by Enter or the Save button and by nothing else. The inline
 * input this replaced also saved on blur, so clicking anywhere else on the row
 * after a typo added the typo.
 */
export function AddTagDialog({
  scanId,
  tags,
  onAdd,
  onClose,
}: {
  scanId: string | number;
  tags: ScanTag[];
  onAdd: ScanTagsProps["onAdd"];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const fieldId = useId();

  return (
    <EditDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Add a tag"
      saveLabel="Add tag"
      tier="compact"
      size="sm"
      dirty={draft.trim() !== ""}
      canSave={draft.trim() !== ""}
      onSave={() => submitNewTag(scanId, draft, tags, onAdd)}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId}>Tag</Label>
        <Input
          id={fieldId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // A React portal still bubbles through the history row, so keys
          // typed here would otherwise reach the page's shortcuts. Enter
          // still submits: that is the form's default action, not a bubble.
          onKeyDown={(e) => e.stopPropagation()}
          maxLength={TAG_INPUT_MAX_LENGTH}
          placeholder="e.g. staging"
          autoComplete="off"
          autoFocus
        />
      </div>
    </EditDialog>
  );
}
