// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { describe, it, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { pressEnter, submitForm } from "../../_helpers/dom";
import {
  EditDialog,
  useEditDialogError,
  type EditSaveOutcome,
} from "@/components/shared/edit-dialog";
import { SAVE_FAILED_MESSAGE } from "@/components/shared/save-confirmation-outcome";

type Save = (name: string) => EditSaveOutcome | Promise<EditSaveOutcome>;

/** The call-site shape the docblock prescribes: mounted only while open. */
function Rename({
  onSave,
  onClosed,
  extra,
}: {
  onSave: Save;
  onClosed?: () => void;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Acme");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Rename team
      </button>
      {open && (
        <EditDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setOpen(false);
              onClosed?.();
            }
          }}
          title="Rename team"
          dirty={name !== "Acme"}
          onSave={() => onSave(name)}
        >
          <label htmlFor="team-name">Name</label>
          <input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea aria-label="Notes" />
          {extra}
        </EditDialog>
      )}
    </>
  );
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Rename team" }));
  return screen.getByRole("dialog", { name: "Rename team" });
}

const nameField = () => screen.getByLabelText("Name") as HTMLInputElement;

function typeName(value: string) {
  fireEvent.change(nameField(), { target: { value } });
}

/** Lets the microtasks of a resolved save settle inside React's act scope. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
}

describe("EditDialog in a real DOM", () => {
  it("opens on the trigger with the fields inside the dialog", () => {
    render(<Rename onSave={() => undefined} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const dialog = openDialog();
    expect(within(dialog).getByLabelText("Name")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("saves on Enter in a single-line input, then closes", async () => {
    const onSave = vi.fn<Save>(() => undefined);
    const onClosed = vi.fn();
    render(<Rename onSave={onSave} onClosed={onClosed} />);
    openDialog();
    typeName("Acme Labs");
    pressEnter(nameField());
    await flush();
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Acme Labs");
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
  ])("saves on %s+Enter from a textarea", async (_label, modifier) => {
    const onSave = vi.fn<Save>(() => undefined);
    render(<Rename onSave={onSave} />);
    openDialog();
    fireEvent.keyDown(screen.getByLabelText("Notes"), {
      key: "Enter",
      ...modifier,
    });
    await flush();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("leaves a plain Enter in a textarea alone", async () => {
    const onSave = vi.fn<Save>(() => undefined);
    render(<Rename onSave={onSave} />);
    openDialog();
    fireEvent.keyDown(screen.getByLabelText("Notes"), { key: "Enter" });
    await flush();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("closes on Cancel without saving when nothing changed", () => {
    const onSave = vi.fn<Save>(() => undefined);
    const onClosed = vi.fn();
    render(<Rename onSave={onSave} onClosed={onClosed} />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closes on Escape without a prompt when nothing changed", () => {
    const onClosed = vi.fn();
    render(<Rename onSave={() => undefined} onClosed={onClosed} />);
    openDialog();
    pressEscape();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it.each([
    ["Cancel", () => fireEvent.click(screen.getByText("Cancel"))],
    ["Escape", pressEscape],
  ])("asks before discarding a change on %s", (_label, close) => {
    const onClosed = vi.fn();
    render(<Rename onSave={() => undefined} onClosed={onClosed} />);
    openDialog();
    typeName("Acme Labs");
    close();
    expect(
      screen.getByRole("alertdialog", { name: "Discard your changes?" }),
    ).toBeTruthy();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("goes back to the typed value on Keep editing", () => {
    const onClosed = vi.fn();
    render(<Rename onSave={() => undefined} onClosed={onClosed} />);
    openDialog();
    typeName("Acme Labs");
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
    expect(nameField().value).toBe("Acme Labs");
  });

  it("closes on Discard changes without saving", async () => {
    const onSave = vi.fn<Save>(() => undefined);
    const onClosed = vi.fn();
    render(<Rename onSave={onSave} onClosed={onClosed} />);
    openDialog();
    typeName("Acme Labs");
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await flush();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each<[string, EditSaveOutcome | Error, string]>([
    ["a returned message", "That name is taken.", "That name is taken."],
    [
      "{ ok: false, error }",
      { ok: false, error: "Not allowed." },
      "Not allowed.",
    ],
    ["{ ok: false }", { ok: false }, SAVE_FAILED_MESSAGE],
    ["a throw", new Error("Request failed."), "Request failed."],
  ])(
    "stays open with the typed value after %s",
    async (_label, outcome, shown) => {
      const onClosed = vi.fn();
      render(
        <Rename
          onClosed={onClosed}
          onSave={() => {
            if (outcome instanceof Error) throw outcome;
            return outcome;
          }}
        />,
      );
      openDialog();
      typeName("Acme Labs");
      pressEnter(nameField());
      await flush();
      expect(screen.getByRole("alert").textContent).toContain(shown);
      expect(nameField().value).toBe("Acme Labs");
      expect(nameField().matches(":disabled")).toBe(false);
      expect(onClosed).not.toHaveBeenCalled();
    },
  );

  it.each(["   ", "\n\t "])(
    "shows the generic failure rather than a blank alert for %j",
    async (blank) => {
      const onClosed = vi.fn();
      render(<Rename onSave={() => blank} onClosed={onClosed} />);
      openDialog();
      pressEnter(nameField());
      await flush();
      expect(screen.getByRole("alert").textContent).toContain(
        SAVE_FAILED_MESSAGE,
      );
      expect(onClosed).not.toHaveBeenCalled();
    },
  );

  it("disables the fields and ignores closing and a second save while one runs", async () => {
    const pending = deferred<EditSaveOutcome>();
    const onSave = vi.fn<Save>(() => pending.promise);
    const onClosed = vi.fn();
    render(<Rename onSave={onSave} onClosed={onClosed} />);
    openDialog();
    typeName("Acme Labs");
    pressEnter(nameField());
    await flush();
    expect(nameField().matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeTruthy();

    submitForm(nameField().form as HTMLFormElement);
    pressEscape();
    await flush();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the trigger when it closes", async () => {
    render(<Rename onSave={() => undefined} />);
    const trigger = screen.getByRole("button", { name: "Rename team" });
    trigger.focus();
    openDialog();
    await waitFor(() => expect(document.activeElement).not.toBe(trigger));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("EditDialog and events bubbling through a portal", () => {
  // React bubbles along the component tree, so a popover or nested form that
  // a field renders into document.body still reaches this dialog's form.
  function PortalledNestedForm({ onSubmit }: { onSubmit: () => void }) {
    return createPortal(
      <form
        aria-label="Nested"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input aria-label="Search people" />
      </form>,
      document.body,
    );
  }

  it("does not save on Ctrl+Enter pressed inside a portalled control", async () => {
    const onSave = vi.fn<Save>(() => undefined);
    render(
      <Rename
        onSave={onSave}
        extra={<PortalledNestedForm onSubmit={() => undefined} />}
      />,
    );
    openDialog();
    const portalled = screen.getByLabelText("Search people");
    const notCancelled = fireEvent.keyDown(portalled, {
      key: "Enter",
      ctrlKey: true,
    });
    await flush();
    expect(notCancelled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save when a portalled form submits", async () => {
    const onSave = vi.fn<Save>(() => undefined);
    const onNested = vi.fn();
    render(
      <Rename
        onSave={onSave}
        extra={<PortalledNestedForm onSubmit={onNested} />}
      />,
    );
    openDialog();
    const nested = screen.getByLabelText("Search people")
      .parentElement as HTMLFormElement;
    submitForm(nested);
    await flush();
    expect(onNested).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("useEditDialogError", () => {
  function CodeField() {
    const { error, errorId } = useEditDialogError();
    return (
      <input
        aria-label="Code"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
    );
  }

  function Harness({ onSave }: { onSave: Save }) {
    return (
      <EditDialog
        open
        onOpenChange={() => undefined}
        title="Enter code"
        onSave={() => onSave("")}
      >
        <CodeField />
      </EditDialog>
    );
  }

  const code = () => screen.getByLabelText("Code") as HTMLInputElement;
  const save = async () => {
    submitForm(code().form as HTMLFormElement);
    await flush();
  };

  it("points a field at the failure and clears on the next try", async () => {
    const results: EditSaveOutcome[] = ["Wrong code.", undefined];
    render(<Harness onSave={() => results.shift()} />);
    expect(code().hasAttribute("aria-describedby")).toBe(false);
    expect(code().hasAttribute("aria-invalid")).toBe(false);

    await save();
    const id = code().getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(code().getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(id as string)?.textContent).toContain(
      "Wrong code.",
    );

    await save();
    expect(code().hasAttribute("aria-describedby")).toBe(false);
    expect(code().hasAttribute("aria-invalid")).toBe(false);
  });

  it("keeps the same id from one failure to the next", async () => {
    render(<Harness onSave={() => "Wrong code."} />);
    await save();
    const first = code().getAttribute("aria-describedby");
    await save();
    expect(code().getAttribute("aria-describedby")).toBe(first);
  });

  it("reports no error outside a dialog", () => {
    const { result } = renderHook(() => useEditDialogError());
    expect(result.current).toEqual({ error: null, errorId: undefined });
  });
});
