// @vitest-environment jsdom
/**
 * The share dialog after a save that failed part way.
 *
 * What did not go through stays staged so the person can try again, and the
 * lists are reloaded. When a staged person is no longer in those lists (they
 * left the team, which is usually why the share failed), the stale stage used
 * to survive the reload: Save stayed enabled, the next Save planned nothing
 * for an id no row shows, sent nothing, and closed the dialog as if it had
 * saved. The dialog now drops the stage for anyone no longer listed, says who
 * was not shared with, and stays open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ me: { userId: 1 }, isLoading: false }),
}));
vi.mock("@/components/shared/turnstile-widget", () => ({
  TurnstileWidget: () => null,
}));

const { ShareTicketDialog, droppedShareSentence } =
  await import("@/components/contact/support-tickets");

const ALEX = { userId: 2, email: "alex@example.com", name: "Alex" };
const BEA = { userId: 3, email: "bea@example.com", name: "Bea" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Answers each request in turn, recording what was sent. */
function serve(...answers: Response[]) {
  const sent: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url: String(url), method: init?.method ?? "GET" });
      const next = answers.shift();
      if (!next) throw new Error(`unexpected request to ${url}`);
      return next;
    }),
  );
  return sent;
}

const saveButton = () =>
  screen.getByRole("button", { name: "Save sharing" }) as HTMLButtonElement;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ShareTicketDialog after a partial failure", () => {
  it("stays open and names the person it could not share with when they drop out of the lists", async () => {
    const sent = serve(
      json({ shares: [], eligible: [ALEX] }),
      json({ error: "You can only share a ticket with a teammate." }, 400),
      json({ shares: [], eligible: [] }),
    );
    const onClose = vi.fn();
    render(<ShareTicketDialog ticketId={42} onClose={onClose} />);

    fireEvent.click(await screen.findByRole("button", { name: /Add Alex/ }));
    fireEvent.click(saveButton());

    expect(
      await screen.findByText(/Could not share with Alex \(alex@example.com\)/),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
    // Nothing left that could be sent, so nothing that could close it.
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());
    expect(onClose).not.toHaveBeenCalled();
    expect(sent.filter((r) => r.method !== "GET")).toHaveLength(1);
  });

  it("names a skipped person who dropped out, and keeps the one still listed staged", async () => {
    const sent = serve(
      json({ shares: [], eligible: [ALEX, BEA] }),
      json({ error: "Could not share the ticket." }, 500),
      json({ shares: [], eligible: [ALEX] }),
      json({ shared: true }, 201),
    );
    const onClose = vi.fn();
    render(<ShareTicketDialog ticketId={42} onClose={onClose} />);

    fireEvent.click(await screen.findByRole("button", { name: /Add Alex/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add Bea/ }));
    fireEvent.click(saveButton());

    const alert = await screen.findByText(/Could not share with Alex/);
    expect(alert.textContent).toMatch(
      /Not shared with Bea \(bea@example.com\), who is no longer on your team/,
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: /Add Alex/ })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );

    // The retry sends Alex alone, and only then does the dialog close.
    fireEvent.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sent.filter((r) => r.method === "POST")).toHaveLength(2);
  });
});

describe("droppedShareSentence", () => {
  const add = (entry: typeof ALEX) => ({
    kind: "add" as const,
    userId: entry.userId,
    label: `${entry.name} (${entry.email})`,
  });

  it("does not call someone the reloaded lists show as shared off the team", () => {
    // Bea left the eligible list because she is shared now (another tab
    // shared her), so "not shared with Bea" would be false.
    const run = {
      done: [],
      failed: { op: add(ALEX), error: "Could not share the ticket." },
      skipped: [add(BEA)],
    };
    expect(
      droppedShareSentence(
        run,
        { added: new Set([ALEX.userId]) },
        { shares: [BEA], eligible: [ALEX] },
      ),
    ).toBeNull();
    expect(
      droppedShareSentence(
        run,
        { added: new Set([ALEX.userId]) },
        { shares: [], eligible: [ALEX] },
      ),
    ).toBe(
      "Not shared with Bea (bea@example.com), who is no longer on your team.",
    );
  });
});
