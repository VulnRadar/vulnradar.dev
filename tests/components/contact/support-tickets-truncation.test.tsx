// @vitest-environment jsdom
/**
 * GET /support-tickets returns at most its page of tickets and says when
 * there were more. The list used to stop at the hundredth ticket with nothing
 * on screen to say it had, so a long-running account read it as the whole
 * history.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ me: { userId: 1 }, isLoading: false }),
}));
vi.mock("@/components/shared/turnstile-widget", () => ({
  TurnstileWidget: () => null,
}));

const { SupportTickets } = await import("@/components/contact/support-tickets");

function ticket(id: number) {
  return {
    id,
    subject: `Ticket ${id}`,
    category: "other",
    status: "open",
    created_at: "2026-01-01T00:00:00.000Z",
    last_message_at: "2026-01-01T00:00:00.000Z",
    message_count: 1,
    shared: false,
    shared_owner_name: null,
  };
}

function serveList(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the ticket list's page limit", () => {
  it("says it shows only the newest tickets, with the limit the server reported", async () => {
    serveList({
      tickets: [ticket(1), ticket(2)],
      limit: 2,
      truncated: true,
    });
    render(<SupportTickets />);
    expect(
      await screen.findByText(
        "Showing your 2 most recently active tickets. Older ones are kept, but not listed here.",
      ),
    ).toBeTruthy();
  });

  it("says nothing about a limit the list did not reach", async () => {
    serveList({ tickets: [ticket(1)], limit: 100, truncated: false });
    render(<SupportTickets />);
    await screen.findByText("Ticket 1");
    expect(screen.queryByText(/most recently active tickets/)).toBeNull();
  });
});
