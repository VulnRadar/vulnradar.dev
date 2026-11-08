/**
 * EditDialog: the outcome mapping, the close decision and the submit sequence
 * (pure, under node), and the markup the dialog renders around them.
 */
import { createContext, useContext, type ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DISCARD_PROMPT,
  KEEP_OPEN,
  editCloseDecision,
  interpretEditSave,
  interpretEditThrow,
  runEditSubmit,
  type EditSaveOutcome,
} from "@/components/shared/edit-dialog-outcome";
import { SAVE_FAILED_MESSAGE } from "@/components/shared/save-confirmation-outcome";

// The dialog renders through a portal, which renderToStaticMarkup leaves
// empty. The stand-in keeps the one thing the markup tests need from the real
// primitive: DialogBody is a band in the shell tier and a plain block in the
// compact one.
vi.mock("@/components/ui/dialog", () => {
  const Tier = createContext("compact");
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogContent: ({
      children,
      variant = "compact",
    }: {
      children?: ReactNode;
      variant?: string;
    }) => <Tier.Provider value={variant}>{children}</Tier.Provider>,
    DialogHeader: Pass,
    DialogTitle: ({ children }: { children?: ReactNode }) => (
      <h2>{children}</h2>
    ),
    DialogDescription: ({ children }: { children?: ReactNode }) => (
      <p>{children}</p>
    ),
    DialogBody: function DialogBody({ children }: { children?: ReactNode }) {
      const tier = useContext(Tier);
      return tier === "shell" ? (
        <div data-band="body">{children}</div>
      ) : (
        <>{children}</>
      );
    },
    DialogFooter: Pass,
  };
});

const { EditDialog } = await import("@/components/shared/edit-dialog");

describe("interpretEditSave", () => {
  it.each<[string, EditSaveOutcome]>([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["{ ok: true }", { ok: true }],
  ])("treats %s as saved", (_label, outcome) => {
    expect(interpretEditSave(outcome)).toEqual({ kind: "saved" });
  });

  it("fails with a returned message", () => {
    expect(interpretEditSave("Name already taken")).toEqual({
      kind: "failed",
      message: "Name already taken",
    });
  });

  it("fails with the generic line for { ok: false } with no error", () => {
    expect(interpretEditSave({ ok: false })).toEqual({
      kind: "failed",
      message: SAVE_FAILED_MESSAGE,
    });
  });

  it("fails with the error carried by { ok: false, error }", () => {
    expect(interpretEditSave({ ok: false, error: "Not allowed" })).toEqual({
      kind: "failed",
      message: "Not allowed",
    });
  });

  it("keeps the dialog open for KEEP_OPEN", () => {
    expect(interpretEditSave(KEEP_OPEN)).toEqual({ kind: "kept-open" });
  });
});

describe("interpretEditThrow", () => {
  it("uses the message of an Error", () => {
    expect(interpretEditThrow(new Error("Request failed (500)"))).toEqual({
      kind: "failed",
      message: "Request failed (500)",
    });
  });

  it("uses the generic line for anything that is not an Error", () => {
    expect(interpretEditThrow("boom")).toEqual({
      kind: "failed",
      message: SAVE_FAILED_MESSAGE,
    });
  });
});

describe("editCloseDecision", () => {
  it("ignores a close while a save is in flight, dirty or not", () => {
    expect(editCloseDecision({ busy: true, dirty: false })).toBe("blocked");
    expect(editCloseDecision({ busy: true, dirty: true })).toBe("blocked");
  });

  it("asks before discarding changes", () => {
    expect(editCloseDecision({ busy: false, dirty: true })).toBe(
      "confirm-discard",
    );
  });

  it("closes straight away when nothing changed", () => {
    expect(editCloseDecision({ busy: false, dirty: false })).toBe("close");
  });

  it("words the prompt for the discard", () => {
    expect(DISCARD_PROMPT.confirmLabel).toBe("Discard changes");
    expect(DISCARD_PROMPT.cancelLabel).toBe("Keep editing");
  });
});

function harness(
  onSave: () => EditSaveOutcome | Promise<EditSaveOutcome>,
  overrides: { canSave?: boolean; busy?: boolean } = {},
) {
  const calls = {
    busy: [] as boolean[],
    errors: [] as (string | null)[],
    close: vi.fn(),
  };
  const run = () =>
    runEditSubmit({
      onSave,
      canSave: overrides.canSave ?? true,
      busy: overrides.busy ?? false,
      setBusy: (b) => calls.busy.push(b),
      setError: (m) => calls.errors.push(m),
      close: calls.close,
    });
  return { calls, run };
}

describe("runEditSubmit", () => {
  it("saves once, closes, and clears busy", async () => {
    const onSave = vi.fn(async () => undefined);
    const { calls, run } = harness(onSave);

    await expect(run()).resolves.toEqual({ kind: "saved" });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(calls.close).toHaveBeenCalledTimes(1);
    expect(calls.errors).toEqual([null]);
    expect(calls.busy).toEqual([true, false]);
  });

  it("shows a returned message and does not close", async () => {
    const { calls, run } = harness(() => "Name already taken");

    await expect(run()).resolves.toEqual({
      kind: "failed",
      message: "Name already taken",
    });

    expect(calls.close).not.toHaveBeenCalled();
    expect(calls.errors).toEqual([null, "Name already taken"]);
    expect(calls.busy).toEqual([true, false]);
  });

  it("shows the generic line for { ok: false } and does not close", async () => {
    const { calls, run } = harness(async () => ({ ok: false }));

    await run();

    expect(calls.close).not.toHaveBeenCalled();
    expect(calls.errors.at(-1)).toBe(SAVE_FAILED_MESSAGE);
    expect(calls.busy).toEqual([true, false]);
  });

  it("shows the message of a throw and does not close", async () => {
    const { calls, run } = harness(async () => {
      throw new Error("Network down");
    });

    await expect(run()).resolves.toEqual({
      kind: "failed",
      message: "Network down",
    });

    expect(calls.close).not.toHaveBeenCalled();
    expect(calls.errors.at(-1)).toBe("Network down");
    expect(calls.busy).toEqual([true, false]);
  });

  it("neither closes nor reports an error for KEEP_OPEN, and clears busy", async () => {
    const { calls, run } = harness(() => KEEP_OPEN);

    await expect(run()).resolves.toEqual({ kind: "kept-open" });

    expect(calls.close).not.toHaveBeenCalled();
    expect(calls.errors).toEqual([null]);
    expect(calls.busy).toEqual([true, false]);
  });

  it("is ignored while a save is already running", async () => {
    const onSave = vi.fn();
    const { calls, run } = harness(onSave, { busy: true });

    await expect(run()).resolves.toBeNull();

    expect(onSave).not.toHaveBeenCalled();
    expect(calls.busy).toEqual([]);
    expect(calls.close).not.toHaveBeenCalled();
  });

  it("is ignored when the form cannot be saved yet", async () => {
    const onSave = vi.fn();
    const { calls, run } = harness(onSave, { canSave: false });

    await expect(run()).resolves.toBeNull();

    expect(onSave).not.toHaveBeenCalled();
    expect(calls.busy).toEqual([]);
  });

  it("clears busy even when closing throws", async () => {
    const setBusy = vi.fn();
    await expect(
      runEditSubmit({
        onSave: () => undefined,
        canSave: true,
        busy: false,
        setBusy,
        setError: () => {},
        close: () => {
          throw new Error("unmounted");
        },
      }),
    ).rejects.toThrow("unmounted");
    expect(setBusy).toHaveBeenLastCalledWith(false);
  });
});

function render(props: Partial<Parameters<typeof EditDialog>[0]> = {}) {
  return renderToStaticMarkup(
    <EditDialog
      open
      onOpenChange={() => {}}
      title="Rename team"
      description="Members see the new name straight away."
      onSave={() => {}}
      {...props}
    >
      <input id="team-name" defaultValue="Acme" />
    </EditDialog>,
  );
}

describe("EditDialog markup", () => {
  it("renders the title, the description and the fields", () => {
    const html = render();
    expect(html).toContain("Rename team");
    expect(html).toContain("Members see the new name straight away.");
    expect(html).toContain('id="team-name"');
  });

  it("leaves out the description element when there is none", () => {
    const html = render({ description: undefined });
    expect(html).not.toContain("Members see");
    expect(html).not.toContain("<p>");
  });

  it("puts Cancel before Save, and Save is the submit button", () => {
    const html = render();
    const cancel = html.indexOf("Cancel");
    const save = html.indexOf("Save changes");
    expect(cancel).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(cancel);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Cancel<\/button>/);
    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*>Save changes<\/button>/,
    );
  });

  it("honours custom labels", () => {
    const html = render({ saveLabel: "Rename", cancelLabel: "Never mind" });
    expect(html).toContain("Rename</button>");
    expect(html).toContain("Never mind</button>");
  });

  it("enables Save by default and disables it when canSave is false", () => {
    expect(render()).not.toMatch(/type="submit"[^>]*disabled/);
    expect(render({ canSave: false })).toMatch(
      /<button[^>]*type="submit"[^>]*disabled/,
    );
  });

  it("carries the destructive variant only when asked", () => {
    const plain = render();
    const destructive = render({ destructive: true });
    const saveClass = (html: string) =>
      /<button[^>]*class="([^"]*)"[^>]*type="submit"/.exec(html)?.[1] ??
      /<button[^>]*type="submit"[^>]*class="([^"]*)"/.exec(html)?.[1] ??
      "";
    expect(saveClass(destructive)).toContain("bg-destructive");
    expect(saveClass(plain)).not.toContain("bg-destructive");
  });

  it("wraps the fields in a fieldset inside one novalidate form", () => {
    const html = render();
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).toContain("noValidate");
    expect(html).toContain("<fieldset");
  });

  it("uses the body band in the shell tier and drops it in the compact tier", () => {
    const shell = render();
    const compact = render({ tier: "compact" });
    expect(shell).toContain('data-band="body"');
    expect(shell).toContain("flex min-h-0 flex-1 flex-col");
    expect(compact).not.toContain('data-band="body"');
    expect(compact).toContain("grid gap-4");
  });

  it("renders no error and no discard prompt before anything happens", () => {
    const html = render({ dirty: true });
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain(DISCARD_PROMPT.title);
  });
});
