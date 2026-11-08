/**
 * The two support-ticket dialogs: opening a ticket and choosing who it is
 * shared with.
 *
 * Both used to be in the page (an inline form that replaced the list, a panel
 * whose every Add and Remove fired at once and whose Remove took a teammate's
 * access away without asking). They are EditDialogs now. Run under node, so
 * the dialog primitive is a pass-through, the decisions are tested as the pure
 * functions they were extracted into, and the component is rendered to static
 * markup for what it shows.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { editCloseDecision } from "@/components/shared/edit-dialog-outcome";
import {
  EMPTY_TICKET_DRAFT,
  createTicket,
  newTicketBody,
  newTicketCanSave,
  newTicketDirty,
  planShareOps,
  remainingStaged,
  runShareOps,
  sendShareOp,
  shareFailureMessage,
  type NewTicketDraft,
  type ShareEntry,
  type ShareLists,
} from "@/components/contact/support-ticket-dialog-logic";
import {
  TICKET_CATEGORIES,
  TICKET_MESSAGE_MAX,
  TICKET_SUBJECT_MAX,
} from "@/lib/support/ticket-constants";

vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogBody: Pass,
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: ({ children }: { children?: ReactNode }) => (
      <h2>{children}</h2>
    ),
  };
});

vi.mock("@/lib/config/client-constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/client-constants")>()),
  TURNSTILE_ENABLED: true,
}));

vi.mock("@/components/shared/turnstile-widget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile" />,
}));

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ me: { userId: 1 }, isLoading: false }),
}));

interface CapturedProps {
  onSave: () => unknown;
  onOpenChange: (open: boolean) => void;
  dirty?: boolean;
  canSave?: boolean;
  saveLabel?: string;
  title?: ReactNode;
}
const captured: CapturedProps[] = [];

// The real dialog, with its props recorded so a handler can be driven.
vi.mock("@/components/shared/edit-dialog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/shared/edit-dialog")>();
  return {
    ...actual,
    EditDialog: (props: CapturedProps & Record<string, unknown>) => {
      captured.push(props);
      return actual.EditDialog(props as never);
    },
  };
});

const {
  NewTicketDialog,
  ShareTicketDialog,
  ShareTicketFields,
  SupportTickets,
} = await import("@/components/contact/support-tickets");

const SOURCE = readFileSync(
  path.resolve(__dirname, "../../../components/contact/support-tickets.tsx"),
  "utf8",
);

const last = () => captured[captured.length - 1];

afterEach(() => {
  captured.length = 0;
  vi.unstubAllGlobals();
});

function buttonTag(html: string, label: string): string {
  const tags = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const tag = tags.find((t) => t.replace(/<[^>]+>/g, "").trim() === label);
  if (!tag) throw new Error(`no button labelled "${label}" in:\n${html}`);
  return tag;
}

const ann: ShareEntry = { userId: 1, email: "ann@example.com", name: "Ann" };
const bob: ShareEntry = { userId: 2, email: "bob@example.com", name: null };
const cy: ShareEntry = { userId: 3, email: "cy@example.com", name: "Cy" };
const di: ShareEntry = { userId: 4, email: "di@example.com", name: null };
const lists: ShareLists = { shares: [ann, bob], eligible: [cy, di] };

describe("the New ticket button", () => {
  it("is always on screen, names itself, and opens a dialog", () => {
    const html = renderToStaticMarkup(<SupportTickets />);
    const tag = buttonTag(html, "New ticket");
    expect(tag).toContain('data-focus-id="new-ticket"');
    expect(tag).toContain('aria-haspopup="dialog"');
    // 36px tall: over the 24px floor and the 44px that primary phone actions want
    expect(tag).toMatch(/\bh-9\b/);
    expect(SOURCE).not.toContain('view !== "new"');
    expect(SOURCE).not.toMatch(/useState<"list" \| "new"/);
  });

  it("does not render the dialog until it is opened", () => {
    expect(renderToStaticMarkup(<SupportTickets />)).not.toContain(
      "Open ticket",
    );
  });
});

describe("NewTicketDialog", () => {
  const html = () =>
    renderToStaticMarkup(
      <NewTicketDialog onClose={() => {}} onCreated={() => {}} />,
    );

  it("shows every field empty, with a real label on each, Cancel and Open ticket", () => {
    const out = html();
    expect(out).toContain("New ticket");
    for (const field of [
      "ticket-subject",
      "ticket-category",
      "ticket-message",
    ]) {
      expect(out).toContain(`id="${field}"`);
      expect(out).toContain(`for="${field}"`);
    }
    expect(out).toContain(`maxLength="${TICKET_SUBJECT_MAX}"`);
    expect(out).toContain(`maxLength="${TICKET_MESSAGE_MAX}"`);
    expect(out.match(/<option\b/g)).toHaveLength(TICKET_CATEGORIES.length);
    expect(out).toContain('data-testid="turnstile"');
    expect(buttonTag(out, "Cancel")).toBeTruthy();
    expect(buttonTag(out, "Open ticket")).toBeTruthy();
  });

  it("starts with Save closed, and the captcha is one of the things holding it", () => {
    expect(buttonTag(html(), "Open ticket")).toContain("disabled");
    expect(last().saveLabel).toBe("Open ticket");
    expect(last().canSave).toBe(false);
    expect(last().dirty).toBe(false);
  });

  it("puts autoFocus on Subject, not on a later field", () => {
    const dialog = SOURCE.slice(
      SOURCE.indexOf("export function NewTicketDialog"),
    );
    const subject = dialog.slice(dialog.indexOf('id="ticket-subject"'));
    const message = subject.indexOf('id="ticket-message"');
    expect(subject.slice(0, message)).toContain("autoFocus");
    expect(subject.slice(message)).not.toContain("autoFocus");
  });

  it("does not use the page-level error banner for a create failure", () => {
    const dialog = SOURCE.slice(
      SOURCE.indexOf("export function NewTicketDialog"),
    );
    expect(dialog.slice(0, dialog.indexOf("type ShareLoad"))).not.toContain(
      "setError(",
    );
  });

  it("closing without a save never sends anything", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onClose = vi.fn();
    const onCreated = vi.fn();
    renderToStaticMarkup(
      <NewTicketDialog onClose={onClose} onCreated={onCreated} />,
    );
    // Untouched, Escape and Cancel close at once.
    expect(
      editCloseDecision({ busy: false, dirty: last().dirty ?? false }),
    ).toBe("close");
    last().onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("a refused create returns the message, so the dialog stays open, and opens nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Slow down. Try again in a minute." }),
      })),
    );
    const onCreated = vi.fn();
    renderToStaticMarkup(
      <NewTicketDialog onClose={() => {}} onCreated={onCreated} />,
    );
    await expect(last().onSave()).resolves.toBe(
      "Slow down. Try again in a minute.",
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("a created ticket hands its id on and returns nothing, so the dialog closes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ticket: { id: 42 } }),
      })),
    );
    const onCreated = vi.fn();
    renderToStaticMarkup(
      <NewTicketDialog onClose={() => {}} onCreated={onCreated} />,
    );
    await expect(last().onSave()).resolves.toBeUndefined();
    expect(onCreated).toHaveBeenCalledWith(42);
  });
});

describe("the new-ticket decisions", () => {
  const filled: NewTicketDraft = {
    subject: "Scan stuck",
    category: "scanning",
    message: "It has said queued for an hour.",
    turnstileToken: null,
  };

  it("is dirty once any field has text, and not for the category alone", () => {
    expect(newTicketDirty(EMPTY_TICKET_DRAFT)).toBe(false);
    expect(newTicketDirty({ ...EMPTY_TICKET_DRAFT, category: "billing" })).toBe(
      false,
    );
    expect(newTicketDirty({ ...EMPTY_TICKET_DRAFT, subject: "x" })).toBe(true);
    expect(newTicketDirty({ ...EMPTY_TICKET_DRAFT, message: "x" })).toBe(true);
    expect(newTicketDirty({ ...EMPTY_TICKET_DRAFT, message: "   " })).toBe(
      false,
    );
  });

  it("needs a subject and a message, and the token only when the captcha is on", () => {
    expect(newTicketCanSave(EMPTY_TICKET_DRAFT, false)).toBe(false);
    expect(newTicketCanSave({ ...filled, message: "" }, false)).toBe(false);
    expect(newTicketCanSave({ ...filled, subject: "  " }, false)).toBe(false);
    expect(newTicketCanSave(filled, false)).toBe(true);
    expect(newTicketCanSave(filled, true)).toBe(false);
    expect(newTicketCanSave({ ...filled, turnstileToken: "tok" }, true)).toBe(
      true,
    );
  });

  it("sends { subject, category, message, turnstileToken }", () => {
    expect(newTicketBody({ ...filled, turnstileToken: "tok" }, true)).toEqual({
      subject: "Scan stuck",
      category: "scanning",
      message: "It has said queued for an hour.",
      turnstileToken: "tok",
    });
    expect(
      newTicketBody({ ...filled, turnstileToken: "stale" }, false),
    ).toEqual(expect.objectContaining({ turnstileToken: null }));
  });

  it("POSTs an edited draft's values, and reports the new ticket's id", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ ticket: { id: 9 } }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await createTicket(
      { ...filled, turnstileToken: "tok" },
      true,
    );
    expect(result).toEqual({ ok: true, id: 9 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/support-tickets$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      subject: "Scan stuck",
      category: "scanning",
      message: "It has said queued for an hour.",
      turnstileToken: "tok",
    });
  });

  it("maps every failure to a message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "No." }) })),
    );
    expect(await createTicket(filled, false)).toEqual({
      ok: false,
      error: "No.",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    expect(await createTicket(filled, false)).toEqual({
      ok: false,
      error: "Could not open the ticket.",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await createTicket(filled, false)).toEqual({
      ok: false,
      error: "Could not open the ticket.",
    });

    // A 200 that does not carry a ticket is not a created ticket.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    expect(await createTicket(filled, false)).toEqual({
      ok: false,
      error: "Could not open the ticket.",
    });
  });
});

describe("the Share button", () => {
  it("keeps one fixed label and says it opens a dialog, not that it is expanded", () => {
    expect(SOURCE).toContain('aria-haspopup="dialog"');
    expect(SOURCE).not.toContain("aria-expanded");
    expect(SOURCE).not.toContain("Done sharing");
    const button = SOURCE.slice(
      SOURCE.indexOf("onClick={() => setShareOpen(true)}"),
    );
    expect(button.slice(0, 300)).toMatch(/Share\s*<\/Button>/);
    // 32px tall, over the 24px floor
    expect(SOURCE).toMatch(
      /className="h-8 gap-1\.5 px-2 text-xs[^"]*"\s+onClick=\{\(\) => setShareOpen\(true\)\}/,
    );
  });

  it("is closed by opening another thread, and leaves the reply draft alone", () => {
    const openThread = SOURCE.slice(SOURCE.indexOf("const openThread"));
    expect(openThread.slice(0, 1400)).toContain("setShareOpen(false)");
    expect(openThread.slice(0, 1400)).not.toContain("setReply(");
  });
});

describe("ShareTicketDialog", () => {
  it("shows the loading line and holds Save closed until the lists arrive", () => {
    const out = renderToStaticMarkup(
      <ShareTicketDialog ticketId={5} onClose={() => {}} />,
    );
    expect(out).toContain("Who can see this ticket");
    expect(out).toContain("Loading...");
    expect(buttonTag(out, "Save sharing")).toContain("disabled");
    expect(buttonTag(out, "Cancel")).toBeTruthy();
    expect(last().canSave).toBe(false);
    expect(last().dirty).toBe(false);
  });

  it("closing without a save sends nothing", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onClose = vi.fn();
    renderToStaticMarkup(<ShareTicketDialog ticketId={5} onClose={onClose} />);
    last().onOpenChange(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ShareTicketFields", () => {
  const render = (added: number[] = [], removed: number[] = [], l = lists) =>
    renderToStaticMarkup(
      <ShareTicketFields
        lists={l}
        added={new Set(added)}
        removed={new Set(removed)}
        onToggleAdd={() => {}}
        onToggleRemove={() => {}}
      />,
    );

  it("gives every current share a Remove toggle and every teammate an Add toggle", () => {
    const out = render();
    expect(out).toContain("Ann (ann@example.com)");
    expect(out).toContain("bob@example.com");
    expect(out.match(/aria-label="Remove /g)).toHaveLength(2);
    expect(out.match(/aria-label="Add /g)).toHaveLength(2);
    expect(out.match(/aria-pressed="false"/g)).toHaveLength(4);
    expect(out).not.toContain('aria-pressed="true"');
  });

  it("marks what is staged, and says a removed teammate loses access", () => {
    const out = render([3], [2]);
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(out).toMatch(
      /aria-pressed="true"[^>]*aria-label="Remove bob@example\.com"/,
    );
    expect(out).toContain(
      "A teammate you remove can no longer see or reply to this ticket.",
    );
  });

  it("keeps every toggle over the 24px floor and nothing in the dialog rounded-xl", () => {
    const out = render();
    const toggles = out.match(/<button\b[^>]*>/g) ?? [];
    expect(toggles).toHaveLength(4);
    for (const t of toggles) expect(t).toMatch(/\bh-8\b/);
    expect(out.match(/<li\b[^>]*min-h-8/g)).toHaveLength(4);
    expect(out).not.toContain("rounded-xl");
    const body = SOURCE.slice(
      SOURCE.indexOf("export function NewTicketDialog"),
    );
    expect(body).not.toContain("rounded-xl");
  });

  it("says so when there is no one to add", () => {
    expect(render([], [], { shares: [ann], eligible: [] })).toContain(
      "Everyone on your team already has access.",
    );
    expect(render([], [], { shares: [], eligible: [] })).toContain(
      "No teammates to share with yet. Add people to a team first.",
    );
  });

  it("leaves out the removal note when no one has access yet", () => {
    expect(render([], [], { shares: [], eligible: [cy] })).not.toContain(
      "can no longer see",
    );
  });
});

describe("what Save sends for the share dialog", () => {
  it("plans the staged adds first, then the removes, each in list order", () => {
    const ops = planShareOps(lists, new Set([4, 3]), new Set([2, 1]));
    expect(ops.map((o) => `${o.kind}:${o.userId}`)).toEqual([
      "add:3",
      "add:4",
      "remove:1",
      "remove:2",
    ]);
  });

  it("plans nothing when nothing is staged, and ignores ids that are not in the lists", () => {
    expect(planShareOps(lists, new Set(), new Set())).toEqual([]);
    expect(planShareOps(lists, new Set([99]), new Set([98]))).toEqual([]);
  });

  it("turns them into POSTs and then DELETEs against the shares route, in order", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(
          `${init?.method ?? "GET"} ${url.replace(/^.*\/support-tickets/, "")} ${init?.body ?? ""}`.trim(),
        );
        return { ok: true, json: async () => ({}) };
      }),
    );
    const ops = planShareOps(lists, new Set([3]), new Set([2]));
    const run = await runShareOps(ops, (op) => sendShareOp(5, op));
    expect(run.failed).toBeNull();
    expect(calls).toEqual([
      'POST /5/shares {"userId":3}',
      "DELETE /5/shares?userId=2",
    ]);
    expect(shareFailureMessage(run)).toBeNull();
  });

  it("stops at the first failure and says what did go through", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls.push(init?.method ?? "GET");
        // The second request fails.
        if (calls.length === 2) {
          return {
            ok: false,
            json: async () => ({ error: "Not on your team" }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
    const ops = planShareOps(lists, new Set([3, 4]), new Set([1]));
    const run = await runShareOps(ops, (op) => sendShareOp(5, op));

    expect(calls).toEqual(["POST", "POST"]);
    expect(run.done.map((o) => o.userId)).toEqual([3]);
    expect(run.failed?.op.userId).toBe(4);
    expect(run.skipped.map((o) => o.userId)).toEqual([1]);

    const message = shareFailureMessage(run);
    expect(message).toBe(
      "Shared with Cy (cy@example.com). Could not share with di@example.com: Not on your team. 1 other change was not tried.",
    );
    expect(message).not.toMatch(/[–—·]/);

    // What went through is now the saved state; the failed one and what was
    // never tried stay staged.
    const left = remainingStaged(run);
    expect([...left.added]).toEqual([4]);
    expect([...left.removed]).toEqual([1]);
  });

  it("names a remove that went through and falls back to a plain message when the server gave none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "DELETE"
          ? { ok: true, json: async () => ({}) }
          : { ok: false, json: async () => ({}) },
      ),
    );
    const ops = [...planShareOps(lists, new Set(), new Set([2]))];
    const first = await runShareOps(ops, (op) => sendShareOp(5, op));
    expect(shareFailureMessage(first)).toBeNull();

    const failingFirst = await runShareOps(
      planShareOps(lists, new Set([3]), new Set([2])),
      (op) => sendShareOp(5, op),
    );
    expect(shareFailureMessage(failingFirst)).toBe(
      "Could not share with Cy (cy@example.com): Could not share the ticket. 1 other change was not tried.",
    );
    expect(failingFirst.done).toEqual([]);
  });

  it("a network error is a failure, not a throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const run = await runShareOps(
      planShareOps(lists, new Set(), new Set([1])),
      (op) => sendShareOp(5, op),
    );
    expect(run.failed?.error).toBe("Could not update sharing.");
    expect(shareFailureMessage(run)).toBe(
      "Could not remove Ann (ann@example.com): Could not update sharing.",
    );
  });
});
