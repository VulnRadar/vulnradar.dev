/**
 * The bulk status change happens in BulkRemediationDialog.
 *
 * The sticky bar used to hold a status select, an assignee, a due date and an
 * Apply button that opened a confirm. It now holds the count, Set status and
 * Cancel; the fields are in an EditDialog whose Save is the explicit step.
 *
 * Rendered through a pass-through stand-in for components/ui/dialog, with the
 * props handed to EditDialog recorded so the save and close paths can be
 * driven without a DOM. The dialog's status is its first useState, so the
 * Open case is rendered by seeding that one call.
 */
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EditDialogProps } from "@/components/shared/edit-dialog";
import {
  editCloseDecision,
  interpretEditSave,
} from "@/components/shared/edit-dialog-outcome";
import { API } from "@/lib/config/client-constants";
import { pruneSelectionToVisible } from "@/components/scanner/finding-selection";

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
const seed = vi.hoisted(() => ({ next: undefined as unknown }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (seed.next !== undefined) {
        const value = seed.next;
        seed.next = undefined;
        return actual.useState(value);
      }
      return actual.useState(initial);
    },
  };
});

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
  BulkRemediationDialog,
  bulkRemediationBody,
  bulkDraftDirty,
  postBulkRemediation,
  BULK_APPLY_FAILED,
  BULK_DEFAULT_STATUS,
} = await import("@/components/scanner/results-list");

function lastProps(): EditDialogProps {
  const props = captured.props.at(-1);
  if (!props) throw new Error("EditDialog was not rendered");
  return props;
}

const TEAMMATES = [
  { id: 1, name: "Sam Lee", email: "sam@example.com", avatar_url: null },
];

function open(
  count: number,
  {
    onApply = vi.fn(async () => null),
    onClose = vi.fn(),
    status,
  }: {
    onApply?: ReturnType<typeof vi.fn>;
    onClose?: ReturnType<typeof vi.fn>;
    status?: string;
  } = {},
) {
  seed.next = status;
  const returnFocusRef = { current: null };
  const html = renderToStaticMarkup(
    <BulkRemediationDialog
      count={count}
      teammates={TEAMMATES}
      onApply={onApply as never}
      onClose={onClose as never}
      returnFocusRef={returnFocusRef}
    />,
  );
  return { html, onApply, onClose, returnFocusRef };
}

beforeEach(() => {
  captured.props.length = 0;
  seed.next = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BulkRemediationDialog", () => {
  it("names the count in its title and its Save", () => {
    const { html } = open(3);
    expect(html).toContain("Set status for 3 findings");
    expect(lastProps().saveLabel).toBe("Apply to 3 findings");
    expect(html).toContain("Apply to 3 findings");
    expect(html).toContain(">Cancel<");

    open(1);
    expect(lastProps().saveLabel).toBe("Apply to 1 finding");
  });

  it("opens on In progress with an empty assignee and due date", () => {
    const { html } = open(2);
    expect(BULK_DEFAULT_STATUS).toBe("in_progress");
    expect(html).toMatch(/<label[^>]*>Status<\/label>/);
    expect(html).toMatch(/<option value="in_progress" selected="">/);
    for (const s of ["open", "fixed", "accepted_risk", "wont_fix"]) {
      expect(html).toContain(`<option value="${s}">`);
    }
    expect(html).toMatch(/<label[^>]*>Assignee \(optional\)<\/label>/);
    expect(html).toMatch(/<label[^>]*>Due date \(optional\)<\/label>/);
    expect(html).toContain('<option value="Sam Lee">');
    const props = lastProps();
    expect(props.destructive).toBe(false);
    expect(props.dirty).toBe(false);
  });

  it("warns that Open clears each finding's details and makes Save destructive", () => {
    const { html } = open(4, { status: "open" });
    expect(html).toMatch(/<option value="open" selected="">/);
    expect(html).toContain(
      "Setting them back to Open also clears the note, assignee and due date saved on each of them.",
    );
    expect(html).not.toContain("Assignee (optional)");
    expect(html).not.toContain("Due date (optional)");
    expect(lastProps().destructive).toBe(true);
    expect(lastProps().dirty).toBe(true);
  });

  it("sends focus back to the Select toggle, since the bar unmounts on success", () => {
    const { returnFocusRef } = open(2);
    expect(lastProps().returnFocusRef).toBe(returnFocusRef);
  });

  it("hands its draft to applyBulk", async () => {
    const { onApply } = open(2);
    await lastProps().onSave();
    expect(onApply).toHaveBeenCalledWith({
      status: "in_progress",
      assignee: "",
      dueAt: "",
    });
  });

  it("closes on Cancel or Escape without applying anything", () => {
    const { onApply, onClose } = open(2);
    const props = lastProps();
    expect(
      editCloseDecision({ busy: false, dirty: props.dirty ?? false }),
    ).toBe("close");
    props.onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("asks before discarding a choice the reader made", () => {
    expect(
      bulkDraftDirty({ status: "in_progress", assignee: "", dueAt: "" }),
    ).toBe(false);
    expect(bulkDraftDirty({ status: "fixed", assignee: "", dueAt: "" })).toBe(
      true,
    );
    expect(
      bulkDraftDirty({ status: "in_progress", assignee: "sam", dueAt: "" }),
    ).toBe(true);
    expect(
      bulkDraftDirty({
        status: "in_progress",
        assignee: "",
        dueAt: "2026-12-01",
      }),
    ).toBe(true);
  });
});

describe("the bulk save", () => {
  it("sends only the selected findings still visible", () => {
    const selected = new Set(["a", "b", "c"]);
    const visible = pruneSelectionToVisible(selected, ["a", "c", "d"]);
    const body = bulkRemediationBody([...visible], "https://example.com", {
      status: "fixed",
      assignee: "",
      dueAt: "",
    });
    expect(body.items).toEqual([
      { findingId: "a", findingUrl: "https://example.com" },
      { findingId: "c", findingUrl: "https://example.com" },
    ]);
  });

  it("omits an empty assignee and due date so each finding keeps its own", () => {
    const body = bulkRemediationBody(["a"], "u", {
      status: "in_progress",
      assignee: "   ",
      dueAt: "",
    });
    expect(body).toEqual({
      items: [{ findingId: "a", findingUrl: "u" }],
      status: "in_progress",
    });
    expect("assignee" in body).toBe(false);
    expect("dueAt" in body).toBe(false);
  });

  it("sends a set assignee trimmed and a set due date", () => {
    expect(
      bulkRemediationBody(["a"], "u", {
        status: "wont_fix",
        assignee: " Sam Lee ",
        dueAt: "2026-12-01",
      }),
    ).toEqual({
      items: [{ findingId: "a", findingUrl: "u" }],
      status: "wont_fix",
      assignee: "Sam Lee",
      dueAt: "2026-12-01",
    });
  });

  it("sends neither field for Open, which clears them", () => {
    const body = bulkRemediationBody(["a"], "u", {
      status: "open",
      assignee: "sam",
      dueAt: "2026-12-01",
    });
    expect(body).toEqual({
      items: [{ findingId: "a", findingUrl: "u" }],
      status: "open",
    });
  });

  it("POSTs the body to the bulk route", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await postBulkRemediation(["a", "c"], "https://example.com", {
      status: "fixed",
      assignee: "",
      dueAt: "2026-12-01",
    });
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(API.SCAN_REMEDIATION_BULK);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      items: [
        { findingId: "a", findingUrl: "https://example.com" },
        { findingId: "c", findingUrl: "https://example.com" },
      ],
      status: "fixed",
      dueAt: "2026-12-01",
    });
  });

  it("reports a refused or unreachable request, which keeps the dialog open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    expect(
      await postBulkRemediation(["a"], "u", {
        status: "fixed",
        assignee: "",
        dueAt: "",
      }),
    ).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(
      await postBulkRemediation(["a"], "u", {
        status: "fixed",
        assignee: "",
        dueAt: "",
      }),
    ).toBe(false);
    expect(BULK_APPLY_FAILED).toBe("Couldn't apply that. Try again.");
    expect(interpretEditSave(BULK_APPLY_FAILED)).toEqual({
      kind: "failed",
      message: BULK_APPLY_FAILED,
    });
  });
});

describe("the sticky bar (source)", () => {
  // The bar renders only with a live selection, which needs state this suite
  // cannot drive, so its markup is read from the source.
  const source = readFileSync("components/scanner/results-list.tsx", "utf8");
  const start = source.indexOf(
    "{showCheckboxes && visibleSelected.size > 0 && (",
  );
  const bar = source.slice(start, source.indexOf("{bulkOpen &&", start));

  it("is found", () => {
    expect(start).toBeGreaterThan(-1);
    expect(bar.length).toBeGreaterThan(0);
  });

  it("keeps its sticky offset above the cookie notice", () => {
    expect(bar).toContain(
      "sticky bottom-[calc(0.75rem+var(--vr-cookie-h,0px))] z-20",
    );
  });

  it("holds the count, Set status and Cancel, and no fields", () => {
    expect(bar).toContain("{visibleSelected.size} selected");
    expect(bar).toMatch(
      /<Button\s+size="sm"\s+onClick=\{\(\) => setBulkOpen\(true\)\}\s+className="h-8 gap-1\.5"\s*>\s*Set status\s*<\/Button>/,
    );
    expect(bar).toContain('aria-label="Clear selection"');
    expect(bar).toContain("onClick={clearSelection}");
    expect(bar).not.toMatch(/<(select|input)\b/);
  });

  it("drops the confirm step: the dialog's Save is the ask", () => {
    expect(source).not.toContain("useConfirm");
  });
});
