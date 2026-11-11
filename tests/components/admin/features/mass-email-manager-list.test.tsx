// @vitest-environment jsdom
/**
 * The broadcast list in a browser: what it shows when the list fails to load,
 * who each broadcast went to and how it went, what the Send and Resend
 * confirms promise, and the preview.
 *
 * bug-ui-admin-18 (mass-email half): a failed list fetch rendered as "No
 * broadcasts yet", which on this panel reads as "nothing was ever sent".
 * bug-ui-admin-11: the confirms named no number, and Resend claimed to mail
 * everyone again, which it never did.
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

const { MassEmailManager } =
  await import("@/components/admin/features/mass-email-manager");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Answer = (body: Record<string, unknown>) => Response;

/** Answers by the request's action, recording each action requested. */
function serve(answers: Record<string, Answer | Answer[]>) {
  const seen: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      seen.push(body);
      const entry = answers[body.action];
      const answer = Array.isArray(entry) ? entry.shift() : entry;
      if (!answer) return json({ templates: [] });
      return answer(body);
    }),
  );
  return seen;
}

const SENT = {
  id: "7",
  title: "October release",
  status: "sent",
  state: "sent",
  created_at: "2026-10-01T10:00:00Z",
  sent_at: "2026-10-01T11:00:00Z",
  segment_filter: { segment: "premium" },
  recipients: 12,
  sent_count: 10,
  failed_count: 2,
  pending_count: 0,
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the broadcast list", () => {
  it("shows an error with Retry when the list fails, and Retry refetches", async () => {
    const seen = serve({
      list: [
        () => json({ error: "Internal server error" }, 500),
        () => json({ messages: [SENT] }),
      ],
    });
    render(<MassEmailManager />);

    expect(await screen.findByText("Could not load broadcasts.")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    // Not the empty state: a failed load is not "nothing was ever sent".
    expect(screen.queryByText("No broadcasts yet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("October release")).toBeTruthy();
    expect(screen.queryByText("Could not load broadcasts.")).toBeNull();
    expect(seen.filter((b) => b.action === "list")).toHaveLength(2);
  });

  it("shows each broadcast's audience and what became of its mail", async () => {
    serve({ list: () => json({ messages: [SENT] }) });
    render(<MassEmailManager />);
    expect(await screen.findByText("All Premium Users")).toBeTruthy();
    expect(
      screen.getByText("Delivered to 10 recipients, 2 failed"),
    ).toBeTruthy();
  });

  it("shows a queued draft as sending, with no Send button to press again", async () => {
    serve({
      list: () =>
        json({
          messages: [
            {
              ...SENT,
              id: "8",
              title: "Queued one",
              status: "draft",
              state: "sending",
              sent_count: 3,
              failed_count: 0,
              pending_count: 5,
            },
          ],
        }),
    });
    render(<MassEmailManager />);
    expect(await screen.findByText("Queued one")).toBeTruthy();
    expect(screen.getAllByText("Sending").length).toBeGreaterThan(0);
    expect(screen.getByText("Sending: 3 delivered so far")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send now/ })).toBeNull();
  });

  it("states what a resend retries before it is confirmed", async () => {
    const seen = serve({
      list: () => json({ messages: [SENT] }),
      audience: () =>
        json({
          counts: {
            audience: 13,
            newRecipients: 1,
            failed: 2,
            alreadySent: 10,
            pending: 0,
            toReach: 3,
          },
        }),
    });
    render(<MassEmailManager />);
    fireEvent.click(await screen.findByRole("button", { name: /Send again/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      await within(dialog).findByText(
        /retries 2 failed deliveries and mails 1 person who joined the audience since/,
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        /10 recipients who already have it are not mailed again/,
      ),
    ).toBeTruthy();
    expect(seen.find((b) => b.action === "audience")?.id).toBe("7");
  });

  it("previews the server's logo in a preview no rounder than its dialog", async () => {
    serve({
      list: () =>
        json({
          messages: [],
          logoUrl: "https://cdn.example.test/custom-logo.png",
        }),
    });
    render(<MassEmailManager />);
    await screen.findByText("No broadcasts yet");

    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const frame = (await screen.findByTitle(
      "Email Preview",
    )) as HTMLIFrameElement;
    expect(frame.className).toContain("rounded-lg");
    expect(frame.className).not.toContain("rounded-xl");
    expect(frame.getAttribute("srcdoc")).toContain(
      "https://cdn.example.test/custom-logo.png",
    );
  });
});

describe("saving a specific-address draft", () => {
  it("sends the address trimmed and lower-cased", async () => {
    const seen = serve({
      list: () => json({ messages: [] }),
      create: () => json({ success: true, message: { id: 1 } }),
    });
    render(<MassEmailManager />);
    await screen.findByText("No broadcasts yet");

    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Hello" },
    });
    fireEvent.change(screen.getByLabelText("Content (HTML supported)"), {
      target: { value: "<p>hi</p>" },
    });
    fireEvent.change(screen.getByLabelText("Recipients"), {
      target: { value: "specific" },
    });
    fireEvent.change(screen.getByLabelText("Email Address"), {
      target: { value: "  Someone@Example.COM " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save as Draft/ }));

    await waitFor(() =>
      expect(seen.find((b) => b.action === "create")).toBeTruthy(),
    );
    expect(seen.find((b) => b.action === "create")?.segment_filter).toEqual({
      segment: "email:someone@example.com",
    });
  });
});
