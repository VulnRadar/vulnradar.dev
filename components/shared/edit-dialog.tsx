"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineAlert } from "@/components/shared/inline-alert";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  DISCARD_PROMPT,
  editCloseDecision,
  runEditSubmit,
  type EditSaveOutcome,
} from "@/components/shared/edit-dialog-outcome";
import { cn } from "@/lib/ui/utils";

export { KEEP_OPEN, type EditSaveOutcome } from "./edit-dialog-outcome";

export interface EditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The fields. Put `autoFocus` on the first one. */
  children: React.ReactNode;
  /** See the docblock for what each return value does. */
  onSave: () => EditSaveOutcome | Promise<EditSaveOutcome>;
  saveLabel?: string;
  savingLabel?: string;
  cancelLabel?: string;
  /** Something was changed, so closing asks before throwing it away. */
  dirty?: boolean;
  /** False holds Save closed (nothing changed, a required field is empty). */
  canSave?: boolean;
  /** Red Save, for an edit whose effect is hard to take back. */
  destructive?: boolean;
  size?: "sm" | "md" | "lg";
  tier?: "shell" | "compact";
  /**
   * Where focus goes on close when the opener is gone by then (a trigger that
   * unmounts on success). Ignored while that element is not in the document.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * The one dialog for changing something that already exists.
 *
 * THE RULE: editing an existing thing happens here, not in the row. Rename a
 * team, edit a webhook, change someone's role, a note or tags on a scan, an
 * admin record: the row or card shows the current value with an Edit control,
 * and the form opens in this dialog with Cancel and Save in its footer. A row
 * that turns into inputs pushes everything under it around and has no obvious
 * way out. The inline editors this replaces saved on blur, closed before a
 * save resolved, confirmed a discard on desktop but not on mobile, and
 * reported failures in a page banner that the scrim then covered. A button
 * that opens a form in place to add, invite or start something (Add tag,
 * Invite, New ticket) opens this dialog too.
 *
 *   {target && (
 *     <EditDialog
 *       open
 *       onOpenChange={(open) => !open && setTarget(null)}
 *       title="Rename team"
 *       dirty={name !== target.name}
 *       canSave={name.trim() !== "" && name !== target.name}
 *       onSave={() => renameTeam(target.id, name.trim())}
 *     >
 *       <Label htmlFor="team-name">Name</Label>
 *       <Input id="team-name" value={name} autoFocus
 *         onChange={(e) => setName(e.target.value)} />
 *     </EditDialog>
 *   )}
 *
 * What `onSave` may return, and what the dialog does with it:
 *   - nothing, null, "" or { ok: true }: saved, the dialog closes.
 *   - a non-empty string: failed, the dialog stays open showing that string.
 *   - { ok: false, error? }: failed, stays open showing the error, or the
 *     generic "not saved" line when there is none.
 *   - a thrown error: failed, stays open showing its message.
 *   - KEEP_OPEN: stays open, no message, not busy. For a save that hands over
 *     to another step, such as a password prompt.
 * A failed save leaves every field exactly as typed.
 *
 * The dialog owns the busy state, the error and the discard prompt. Enter in a
 * single-line input saves, Ctrl or Cmd+Enter saves from a textarea, Escape and
 * Cancel close, and closing asks first only when `dirty`. While a save is in
 * flight the fields are disabled and closing is ignored.
 *
 * The call site owns the draft. Mount the dialog only while it is open and
 * seed the draft from the item (`useState(item.value)`), so every opening
 * starts from the saved value and a refetch of the list cannot reset what
 * someone is half way through typing.
 *
 * What stays inline, on purpose:
 *   - A switch that applies at once and flips straight back (pause a webhook
 *     or a schedule, a notification preference). Sharing something with a
 *     team is not one of these: it changes what other people can do.
 *   - Whole settings pages, which keep their page and their save bar. A
 *     click-to-edit field inside one is not exempt.
 *   - A create form that is always on screen above its list. Nothing opens, so
 *     nothing moves.
 *   - Read-only expanders (a delivery log, a DNS record) and the composer
 *     under a conversation.
 */
export function EditDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSave,
  saveLabel = "Save changes",
  savingLabel = "Saving...",
  cancelLabel = "Cancel",
  dirty = false,
  canSave = true,
  destructive = false,
  size = "md",
  tier = "shell",
  returnFocusRef,
}: EditDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State alone lets a second Enter through before the re-render that disables
  // the button, so the guard that actually stops a double save is this ref.
  const busyRef = useRef(false);
  const { confirm, confirmDialog } = useConfirm();

  // A dialog that stays mounted across openings must not show last time's
  // error. Adjusted during render, as React advises, rather than in an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setError(null);
  }

  const requestClose = () => {
    const decision = editCloseDecision({ busy: busyRef.current, dirty });
    if (decision === "blocked") return;
    if (decision === "confirm-discard") {
      confirm({
        ...DISCARD_PROMPT,
        danger: true,
        onConfirm: () => onOpenChange(false),
      });
      return;
    }
    onOpenChange(false);
  };

  const submit = () =>
    runEditSubmit({
      onSave,
      canSave,
      busy: busyRef.current,
      setBusy: (next) => {
        busyRef.current = next;
        setBusy(next);
      },
      setError,
      close: () => onOpenChange(false),
    });

  const hasDescription = description !== undefined && description !== null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <DialogContent
          variant={tier}
          size={size}
          {...(hasDescription ? {} : { "aria-describedby": undefined })}
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          {/* The key handler is on the form because the textarea inside it is
              the control; a textarea cannot submit on plain Enter. */}
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey) &&
                !event.defaultPrevented
              ) {
                event.preventDefault();
                event.currentTarget.requestSubmit();
              }
            }}
            className={cn(
              tier === "shell" ? "flex min-h-0 flex-1 flex-col" : "grid gap-4",
            )}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              {hasDescription && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </DialogHeader>
            <DialogBody>
              <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
                {children}
              </fieldset>
              {error && (
                <InlineAlert tone="error" className="mt-4">
                  {error}
                </InlineAlert>
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={requestClose}
              >
                {cancelLabel}
              </Button>
              <Button
                type="submit"
                variant={destructive ? "destructive" : "default"}
                disabled={busy || !canSave}
                className="gap-2"
              >
                {busy && (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                  />
                )}
                {busy ? savingLabel : saveLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}
