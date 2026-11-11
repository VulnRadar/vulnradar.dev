// @vitest-environment jsdom
/**
 * A notification that fails to save says why, inside the dialog.
 *
 * The create and edit dialog threw the server's reason away ("Failed to save
 * notification") and wrote that into the page's own error line, which sits
 * behind the open dialog. A notice with a bad button link therefore looked
 * like a Save that did nothing. The reason now comes from the response body
 * and is shown in the dialog, which stays open with what was typed; the link
 * rule is also checked before anything is sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const { NotificationsManager } =
  await import("@/components/admin/notifications/notifications-manager");

const SERVER_REASON =
  "The first button's URL must start with https://, http:// or a / path on this site.";

const fetchMock = vi.fn();

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? respond(400, { error: SERVER_REASON })
      : respond(200, { notifications: [] }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openCreateAndFill(actionUrl: string) {
  render(<NotificationsManager />);
  fireEvent.click(await screen.findByRole("button", { name: /^Create$/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Title"), {
    target: { value: "Maintenance tonight" },
  });
  fireEvent.change(within(dialog).getByLabelText("Message"), {
    target: { value: "Scans pause at 22:00 UTC." },
  });
  fireEvent.change(within(dialog).getAllByLabelText("URL / path")[0], {
    target: { value: actionUrl },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Create Notification" }),
  );
  return dialog;
}

const posts = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

describe("saving a notification", () => {
  it("keeps the dialog open and shows the server's reason inside it on a 400", async () => {
    const dialog = await openCreateAndFill("https://example.com/status");

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(SERVER_REASON);
    expect(posts()).toHaveLength(1);
    // Still open, with what was typed.
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(
      (within(dialog).getByLabelText("Title") as HTMLInputElement).value,
    ).toBe("Maintenance tonight");
  });

  it("refuses a link the server would refuse before sending anything", async () => {
    const dialog = await openCreateAndFill("javascript:alert(1)");

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/first button's URL must start with/);
    expect(posts()).toHaveLength(0);
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("keeps an edit open behind its confirmation when the server refuses it", async () => {
    // The edit path saves from useConfirm's onConfirm, which closes on a
    // resolve. handleSave used to resolve on a failure, so both dialogs
    // closed and the edit looked applied.
    const existing = {
      id: 9,
      cookie_id: "notif_abc",
      title: "Old title",
      message: "Old message",
      type: "banner",
      variant: "info",
      audience: "all",
      path_pattern: null,
      starts_at: null,
      ends_at: null,
      is_active: true,
      is_dismissible: true,
      dismiss_duration_hours: null,
      action_label: null,
      action_url: null,
      action_external: false,
      action_label_2: null,
      action_url_2: null,
      action_external_2: false,
      priority: 0,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    };
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? respond(400, { error: SERVER_REASON })
        : respond(200, { notifications: [existing] }),
    );
    render(<NotificationsManager />);
    fireEvent.click(
      (await screen.findAllByRole("button", { name: /edit/i }))[0],
    );
    const editor = await screen.findByRole("dialog");
    fireEvent.click(
      within(editor).getByRole("button", { name: "Save Changes" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Replace it" }));

    // hidden: the confirmation on top marks the editor aria-hidden while open.
    await waitFor(() =>
      expect(
        within(editor).getByRole("alert", { hidden: true }).textContent ?? "",
      ).toContain(SERVER_REASON),
    );
    expect(document.body.contains(editor)).toBe(true);
    expect(
      (
        within(editor).getByLabelText("Title", {
          selector: "input",
        }) as HTMLInputElement
      ).value,
    ).toBe("Old title");
  });

  it("closes the dialog when the save goes through", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? respond(200, { notification: { id: 1 } })
        : respond(200, { notifications: [] }),
    );
    await openCreateAndFill("/pricing");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts()).toHaveLength(1);
  });
});
