// @vitest-environment jsdom
/**
 * AI Chats: the tiles, the filters they open and the search agree.
 *
 * The search box filtered the rows the browser had loaded, so a conversation
 * on page two could not be found, and the two quality tiles counted ratings
 * and failed replies while their filters listed conversations. The search
 * now goes to the server and the tiles count conversations.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { AIChatsManager, conversationListQuery } =
  await import("@/components/admin/features/ai-chats-manager");

describe("conversationListQuery", () => {
  it("sends a text search as q", () => {
    expect(conversationListQuery(1, 20, "all", "  bob@example.com ")).toBe(
      "page=1&limit=20&q=bob%40example.com",
    );
  });

  it.each(["42", "#42"])("sends %s as a user id", (term) => {
    expect(conversationListQuery(2, 20, "all", term)).toBe(
      "page=2&limit=20&userId=42",
    );
  });

  it("keeps the quality filter beside the search", () => {
    expect(conversationListQuery(1, 50, "unhelpful", "bob")).toBe(
      "page=1&limit=50&rating=down&q=bob",
    );
    expect(conversationListQuery(1, 50, "errored", "")).toBe(
      "page=1&limit=50&errored=1",
    );
  });
});

describe("the AI Chats panel", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            conversations: [],
            total: 0,
            page: 1,
            limit: 20,
            signals: {
              unhelpfulLast7Days: 9,
              errorsLast7Days: 7,
              unhelpfulConversationsLast7Days: 2,
              erroredConversationsLast7Days: 1,
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the conversation counts on the tiles", async () => {
    render(<AIChatsManager />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const tile = await screen.findByText("Rated unhelpful (7 days)");
    const strip = tile.closest("button") ?? tile.parentElement!;
    await waitFor(() => expect(strip.textContent).toContain("2"));
    expect(strip.textContent).not.toContain("9");
  });

  it("sends the search to the server, starting again from page one", async () => {
    render(<AIChatsManager />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Search conversations"), {
      target: { value: "bob" },
    });

    await waitFor(
      () =>
        expect(
          fetchMock.mock.calls.some(([url]) =>
            String(url).includes("page=1&limit=20&q=bob"),
          ),
        ).toBe(true),
      { timeout: 2000 },
    );
  });
});
