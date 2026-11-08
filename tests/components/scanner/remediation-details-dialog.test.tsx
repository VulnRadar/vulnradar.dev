/**
 * A finding's tracking details are edited in RemediationDetailsDialog.
 *
 * Picking a status other than Open used to unfold a note, an assignee and a
 * due date with a "Save details" button inside the finding view. The status
 * chips stay one click; the details now show read-only with an Edit details
 * button, disabled until the mount-time GET has brought the freshest values,
 * and the fields open in an EditDialog.
 *
 * Rendered through a pass-through stand-in for components/ui/dialog, with the
 * props handed to EditDialog recorded so the save and close paths can be
 * driven without a DOM.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EditDialogProps } from "@/components/shared/edit-dialog";
import {
  editCloseDecision,
  interpretEditSave,
} from "@/components/shared/edit-dialog-outcome";
import { API } from "@/lib/config/client-constants";

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

const {
  RemediationControl,
  RemediationDetailsDialog,
  remediationDetailsBody,
  remediationDraftDirty,
  postRemediationDetails,
  DETAILS_SAVE_FAILED,
} = await import("@/components/scanner/issue-detail");

function lastProps(): EditDialogProps {
  const props = captured.props.at(-1);
  if (!props) throw new Error("EditDialog was not rendered");
  return props;
}

const SAVED = {
  note: "Patched in 4.2",
  assignee: "sam",
  dueAt: "2026-12-01",
};

beforeEach(() => {
  captured.props.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the tracking card", () => {
  it("shows saved details read-only with an Edit details button", () => {
    const html = renderToStaticMarkup(
      <RemediationControl
        findingId="f1"
        findingUrl="https://example.com"
        // A local timestamp, so the day does not depend on the machine's
        // zone: toDateInputValue reads the server value in local time.
        initial={{
          status: "in_progress",
          ...SAVED,
          dueAt: "2026-12-01T12:00:00",
        }}
      />,
    );
    expect(html).toContain("Patched in 4.2");
    expect(html).toContain("sam");
    expect(html).toContain("Dec 1, 2026");
    const button = /<button[^>]*>Edit details<\/button>/.exec(html);
    expect(button).not.toBeNull();
    // 28px tall, over the 24px floor.
    expect(button![0]).toMatch(/\bh-7\b/);
    // The fields are not in the card any more.
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(captured.props).toHaveLength(0);
  });

  it("keeps the trigger disabled until the mount-time GET settles", () => {
    // Effects do not run under renderToStaticMarkup, so this is the state
    // before the GET has answered.
    const html = renderToStaticMarkup(
      <RemediationControl
        findingId="f1"
        findingUrl="https://example.com"
        initial={{ status: "fixed", ...SAVED }}
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Edit details<\/button>/);
  });

  it("says there is nothing yet and offers Add details", () => {
    const html = renderToStaticMarkup(
      <RemediationControl
        findingId="f1"
        findingUrl="https://example.com"
        initial={{
          status: "in_progress",
          note: null,
          assignee: null,
          dueAt: null,
        }}
      />,
    );
    expect(html).toContain("No details yet");
    expect(html).toMatch(/<button[^>]*>Add details<\/button>/);
  });

  it("shows no details and no trigger while the finding is Open", () => {
    const html = renderToStaticMarkup(
      <RemediationControl findingId="f1" findingUrl="https://example.com" />,
    );
    expect(html).not.toContain("details");
    // The five status chips are still one-click buttons.
    expect(html.match(/aria-pressed=/g)).toHaveLength(5);
  });
});

describe("RemediationDetailsDialog", () => {
  function open(onSave = vi.fn(async () => null), onClose = vi.fn()) {
    const html = renderToStaticMarkup(
      <RemediationDetailsDialog
        status="in_progress"
        initial={SAVED}
        teammates={[
          {
            id: 1,
            name: "Sam Lee",
            email: "sam@example.com",
            avatar_url: null,
          },
        ]}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    return { html, onSave, onClose };
  }

  function fieldFor(html: string, label: string): string {
    const labelFor = new RegExp(
      `<label[^>]*for="([^"]+)"[^>]*>${label}</label>`,
    ).exec(html);
    expect(labelFor, `a label "${label}"`).not.toBeNull();
    const field = new RegExp(
      `<(?:input|textarea)[^>]*id="${labelFor![1]}"[^>]*>(?:[^<]*</textarea>)?`,
    ).exec(html);
    expect(field, `the field labelled "${label}"`).not.toBeNull();
    return field![0];
  }

  it("opens with every field holding the saved value", () => {
    const { html } = open();
    expect(html).toContain("Tracking details");
    expect(fieldFor(html, "Note \\(optional\\)")).toContain(
      ">Patched in 4.2</textarea>",
    );
    expect(fieldFor(html, "Note \\(optional\\)")).toContain('maxLength="2000"');
    const assignee = fieldFor(html, "Assignee \\(optional\\)");
    expect(assignee).toContain('value="sam"');
    expect(assignee).toContain('maxLength="120"');
    expect(assignee).toMatch(/list="[^"]+"/);
    expect(html).toContain('<option value="Sam Lee">');
    const due = fieldFor(html, "Due date \\(optional\\)");
    expect(due).toContain('type="date"');
    expect(due).toContain('value="2026-12-01"');
    expect(html).toContain(">Cancel<");
    expect(lastProps().saveLabel).toBe("Save details");
    expect(lastProps().dirty).toBe(false);
  });

  it("hands its draft to the control's save", async () => {
    const { onSave } = open();
    await lastProps().onSave();
    expect(onSave).toHaveBeenCalledWith(SAVED);
  });

  it("closes on Cancel or Escape without saving", () => {
    const { onSave, onClose } = open();
    const props = lastProps();
    expect(
      editCloseDecision({ busy: false, dirty: props.dirty ?? false }),
    ).toBe("close");
    props.onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("counts any changed field as unsaved work", () => {
    expect(remediationDraftDirty(SAVED, SAVED)).toBe(false);
    expect(remediationDraftDirty({ ...SAVED, note: "x" }, SAVED)).toBe(true);
    expect(remediationDraftDirty({ ...SAVED, assignee: "" }, SAVED)).toBe(true);
    expect(remediationDraftDirty({ ...SAVED, dueAt: "" }, SAVED)).toBe(true);
  });
});

describe("the details save", () => {
  it("builds the same body the status chips send: current status plus the draft", () => {
    expect(
      remediationDetailsBody("f1", "https://example.com", "accepted_risk", {
        note: "  vendor fix due in Q1 ",
        assignee: "",
        dueAt: "2027-01-15",
      }),
    ).toEqual({
      findingId: "f1",
      findingUrl: "https://example.com",
      status: "accepted_risk",
      note: "vendor fix due in Q1",
      assignee: undefined,
      dueAt: "2027-01-15",
    });
  });

  it("POSTs an edited draft under the current status and returns the saved row", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const saved = await postRemediationDetails(
      "f1",
      "https://example.com",
      "in_progress",
      { note: "Ticket VR-118", assignee: " Sam Lee ", dueAt: "" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(API.SCAN_REMEDIATION);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      findingId: "f1",
      findingUrl: "https://example.com",
      status: "in_progress",
      note: "Ticket VR-118",
      assignee: "Sam Lee",
      dueAt: null,
    });
    expect(saved).toEqual({
      status: "in_progress",
      note: "Ticket VR-118",
      assignee: "Sam Lee",
      dueAt: null,
    });
  });

  it("reports a refused or unreachable save as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    expect(await postRemediationDetails("f1", "u", "fixed", SAVED)).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await postRemediationDetails("f1", "u", "fixed", SAVED)).toBeNull();
  });

  it("keeps the dialog open with the retry sentence on failure", () => {
    expect(DETAILS_SAVE_FAILED).toBe("Couldn't save that. Try again.");
    expect(interpretEditSave(DETAILS_SAVE_FAILED)).toEqual({
      kind: "failed",
      message: DETAILS_SAVE_FAILED,
    });
  });
});
