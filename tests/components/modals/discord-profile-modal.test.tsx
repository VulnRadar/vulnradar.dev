// @vitest-environment jsdom
/**
 * The post-connect "sync your profile" dialog is mounted on every page, so its
 * query string is reachable from any link. It used to read the name and avatar
 * it offered from that query string and PATCH them to the profile route, which
 * made /anything?discord_connected=true&discord_username=evil a one-click
 * rewrite of the victim's display name and avatar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { API } from "@/lib/config/client-constants";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => nav.params,
}));

const { DiscordProfileModal } =
  await import("@/components/modals/discord-profile-modal");

const mockFetch = vi.fn();

function status(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const STORED = {
  connected: true,
  discordId: "123",
  discordUsername: "real-name",
  discordAvatar: "hash",
  avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.png?size=256",
  justConnected: true,
};

beforeEach(() => {
  nav.params = new URLSearchParams(
    "discord_connected=true&discord_username=evil&discord_avatar=https://evil.example/x.png",
  );
  nav.replace.mockReset();
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  // jsdom reports window.location.replace as "not implemented".
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DiscordProfileModal", () => {
  it("shows the stored name and never the one in the URL", async () => {
    mockFetch.mockResolvedValueOnce(status(STORED));

    render(<DiscordProfileModal />);

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getAllByText("real-name").length).toBeGreaterThan(0);
    expect(screen.queryByText("evil")).toBeNull();
    expect(document.body.innerHTML).not.toContain("evil.example");
    expect(mockFetch).toHaveBeenCalledWith(API.ACCOUNT_DISCORD);
  });

  it("saves through the sync route, sending which fields and no values", async () => {
    mockFetch.mockResolvedValueOnce(status(STORED));
    mockFetch.mockResolvedValueOnce(status({ success: true, updated: [] }));

    render(<DiscordProfileModal />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Sync selected" }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe(API.ACCOUNT_DISCORD);
    expect(url).not.toBe(API.AUTH.UPDATE);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      syncAvatar: true,
      syncName: true,
    });
    expect(String(init.body)).not.toContain("evil");
  });

  it("stays shut when the connection was not made just now", async () => {
    mockFetch.mockResolvedValueOnce(
      status({ ...STORED, justConnected: false }),
    );

    render(<DiscordProfileModal />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays shut when the account has no connection", async () => {
    mockFetch.mockResolvedValueOnce(status({ connected: false }));

    render(<DiscordProfileModal />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays shut when the status request fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("offline"));

    render(<DiscordProfileModal />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks the server nothing without the connected flag", () => {
    nav.params = new URLSearchParams("discord_username=evil");

    render(<DiscordProfileModal />);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clears every parameter it owns when skipped", async () => {
    mockFetch.mockResolvedValueOnce(status(STORED));

    render(<DiscordProfileModal />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Skip for now" }),
    );

    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(String(nav.replace.mock.calls[0][0])).not.toContain("discord_");
  });
});
