// @vitest-environment jsdom
/**
 * GitHub's half of the crafted-link fix (see discord-profile-modal.test.tsx).
 *
 * A linked GitHub sign-in has no timestamp to check, so "was this connected
 * just now" is answered by a marker the Link button leaves in this tab's
 * sessionStorage: a link from anywhere else cannot have set it.
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
import {
  GITHUB_LINK_MARKER_MAX_AGE_MS,
  markGithubLinkStarted,
} from "@/components/modals/github-link-marker";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => nav.params,
}));

const { GithubProfileModal } =
  await import("@/components/modals/github-profile-modal");

const mockFetch = vi.fn();

function status(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const STORED = {
  linkedProfile: {
    name: "Real Name",
    avatarUrl: "https://avatars.githubusercontent.com/u/42",
  },
};

beforeEach(() => {
  sessionStorage.clear();
  nav.params = new URLSearchParams(
    "github_connected=true&github_username=evil&github_avatar=https://evil.example/x.png",
  );
  nav.replace.mockReset();
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GithubProfileModal", () => {
  it("does nothing on a crafted link: no marker, no request, no dialog", () => {
    render(<GithubProfileModal />);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does nothing on a marker older than the window", () => {
    markGithubLinkStarted();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(
      now + GITHUB_LINK_MARKER_MAX_AGE_MS + 1,
    );

    render(<GithubProfileModal />);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows the stored name and never the one in the URL", async () => {
    markGithubLinkStarted();
    mockFetch.mockResolvedValueOnce(status(STORED));

    render(<GithubProfileModal />);

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getAllByText("Real Name").length).toBeGreaterThan(0);
    expect(screen.queryByText("evil")).toBeNull();
    expect(document.body.innerHTML).not.toContain("evil.example");
    expect(mockFetch).toHaveBeenCalledWith(
      `${API.ACCOUNT_GITHUB}?include=linked-profile`,
    );
  });

  it("saves through the sync route, sending which fields and no values", async () => {
    markGithubLinkStarted();
    mockFetch.mockResolvedValueOnce(status(STORED));
    mockFetch.mockResolvedValueOnce(status({ success: true, updated: [] }));

    render(<GithubProfileModal />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Sync selected" }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe(API.ACCOUNT_GITHUB);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      syncAvatar: true,
      syncName: true,
    });
    expect(String(init.body)).not.toContain("evil");
  });

  it("stays shut when no GitHub sign-in is stored", async () => {
    markGithubLinkStarted();
    mockFetch.mockResolvedValueOnce(status({ linkedProfile: null }));

    render(<GithubProfileModal />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("spends the marker when skipped, so reloading does not bring it back", async () => {
    markGithubLinkStarted();
    mockFetch.mockResolvedValueOnce(status(STORED));

    render(<GithubProfileModal />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Skip for now" }),
    );
    cleanup();

    mockFetch.mockClear();
    render(<GithubProfileModal />);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(String(nav.replace.mock.calls[0][0])).not.toContain("github_");
  });
});
