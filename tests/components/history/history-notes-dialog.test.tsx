/**
 * Notes on a scan are edited in NotesDialog, not in the card.
 *
 * The card used to turn into a textarea in place. It now shows the saved note
 * and an Edit or Add note button, and the textarea lives in an EditDialog with
 * Cancel and Save. No DOM library here, so the dialog is rendered through a
 * pass-through stand-in for components/ui/dialog (its portal renders nothing
 * under renderToStaticMarkup), and the props NotesDialog hands to EditDialog
 * are recorded so the save and close paths can be driven directly.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EditDialogProps } from "@/components/shared/edit-dialog";
import {
  editCloseDecision,
  interpretEditSave,
} from "@/components/shared/edit-dialog-outcome";

vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogBody: Pass,
    DialogClose: Pass,
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
  };
});

const captured = vi.hoisted(() => ({ props: [] as EditDialogProps[] }));

vi.mock("@/components/shared/edit-dialog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/shared/edit-dialog")>();
  return {
    ...actual,
    EditDialog: (props: EditDialogProps) => {
      captured.props.push(props);
      return <actual.EditDialog {...props} />;
    },
  };
});

const { HistoryNotes, NotesDialog, saveNotesDraft, NOTES_KEPT_SENTENCE } =
  await import("@/components/history/history-notes");

function lastProps(): EditDialogProps {
  const props = captured.props.at(-1);
  if (!props) throw new Error("EditDialog was not rendered");
  return props;
}

/** The props of the first element in a JSX tree that matches. */
function findProps(
  node: unknown,
  match: (props: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps(child, match);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const props = (node as { props: Record<string, unknown> }).props;
  if (match(props)) return props;
  return findProps(props.children, match);
}

beforeEach(() => {
  captured.props.length = 0;
});

describe("the notes card", () => {
  const noSave = vi.fn(async () => null);

  it("offers Add note on an empty card, at a 28px target", () => {
    const html = renderToStaticMarkup(
      <HistoryNotes notes="" isOwner onSave={noSave} />,
    );
    expect(html).toMatch(
      /<button[^>]*class="[^"]*\bh-7\b[^"]*"[^>]*>.*Add note<\/button>/,
    );
    expect(html).toContain("No notes yet.");
  });

  it("shows the saved note read-only with an Edit button", () => {
    const html = renderToStaticMarkup(
      <HistoryNotes
        notes="Rotated the key on Friday."
        isOwner
        onSave={noSave}
      />,
    );
    expect(html).toContain("Rotated the key on Friday.");
    expect(html).toMatch(/<button[^>]*>.*Edit<\/button>/);
    // The textarea is no longer in the card at all.
    expect(html).not.toContain("<textarea");
    expect(captured.props).toHaveLength(0);
  });

  it("gives a viewer who is not the owner no edit control", () => {
    const html = renderToStaticMarkup(
      <HistoryNotes notes="Rotated." isOwner={false} onSave={noSave} />,
    );
    expect(html).not.toContain("<button");
    expect(html).toContain("Rotated.");
  });
});

describe("NotesDialog", () => {
  it("opens holding the saved note, with Cancel and Save note", () => {
    const html = renderToStaticMarkup(
      <NotesDialog
        notes="Rotated the key on Friday."
        onSave={vi.fn(async () => null)}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Notes on this scan");
    expect(html).toMatch(/<label[^>]*for="([^"]+)"[^>]*>Scan notes<\/label>/);
    const labelFor = /<label[^>]*for="([^"]+)"/.exec(html)![1];
    expect(html).toMatch(
      new RegExp(
        `<textarea[^>]*id="${labelFor}"[^>]*>Rotated the key on Friday.</textarea>`,
      ),
    );
    expect(html).toContain('maxLength="2000"');
    expect(html).toContain(">Cancel<");
    expect(html).toContain("Save note");

    const props = lastProps();
    expect(props.saveLabel).toBe("Save note");
    expect(props.size).toBe("md");
    // Nothing typed yet: closing does not ask.
    expect(props.dirty).toBe(false);
  });

  it("saves the draft it holds through the page's onSave", async () => {
    const onSave = vi.fn(async (_notes: string) => null);
    renderToStaticMarkup(
      <NotesDialog notes="Seeded" onSave={onSave} onClose={() => {}} />,
    );
    const outcome = await lastProps().onSave();
    expect(onSave).toHaveBeenCalledWith("Seeded");
    expect(interpretEditSave(outcome)).toEqual({ kind: "saved" });
  });

  it("sends an edited draft and accepts an empty note as a save", async () => {
    const onSave = vi.fn(async (_notes: string) => null);
    expect(await saveNotesDraft(onSave, "Patched in 4.2")).toBeNull();
    expect(onSave).toHaveBeenLastCalledWith("Patched in 4.2");
    expect(await saveNotesDraft(onSave, "")).toBeNull();
    expect(onSave).toHaveBeenLastCalledWith("");
  });

  it("keeps the dialog open on a failed save and says the text is still there", async () => {
    const onSave = vi.fn(async () => "Couldn't save these notes.");
    const outcome = await saveNotesDraft(onSave, "Patched in 4.2");
    expect(outcome).toBe(`Couldn't save these notes. ${NOTES_KEPT_SENTENCE}`);
    expect(NOTES_KEPT_SENTENCE).toBe(
      "Your text is still here, nothing was saved.",
    );
    expect(interpretEditSave(outcome)).toEqual({
      kind: "failed",
      message: `Couldn't save these notes. ${NOTES_KEPT_SENTENCE}`,
    });
  });

  it("closes on Cancel or Escape without saving", () => {
    const onSave = vi.fn(async () => null);
    const onClose = vi.fn();
    renderToStaticMarkup(
      <NotesDialog notes="Seeded" onSave={onSave} onClose={onClose} />,
    );
    const props = lastProps();
    // Cancel, Escape, the overlay and the close chip all reach onOpenChange
    // through this decision.
    expect(
      editCloseDecision({ busy: false, dirty: props.dirty ?? false }),
    ).toBe("close");
    props.onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    // A changed draft asks first instead of closing.
    expect(editCloseDecision({ busy: false, dirty: true })).toBe(
      "confirm-discard",
    );
  });

  it("leaves the keyboard to the dialog's form", () => {
    // The handlers that stood here guarded letter shortcuts /history does not
    // have, and the Ctrl+Enter carve-out existed only to work around them.
    renderToStaticMarkup(
      <NotesDialog
        notes=""
        onSave={vi.fn(async () => null)}
        onClose={() => {}}
      />,
    );
    const textarea = findProps(
      lastProps().children,
      (props) => props.placeholder === "Add notes about this scan...",
    );
    expect(textarea).not.toBeNull();
    expect(textarea!.onKeyDown).toBeUndefined();
    expect(textarea!.onKeyUp).toBeUndefined();
  });
});
