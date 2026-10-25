/**
 * sendTeamsRequest is what makes a failed team action say why. useConfirm
 * closes its dialog when the action resolves and stays open with `err.message`
 * when it throws, and the rename editor shows the same message, so the whole
 * contract is: resolve on success, otherwise throw an Error whose message is
 * the sentence a person should read.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  sendTeamsRequest,
  TEAMS_UNREACHABLE,
} from "@/components/teams/team-requests";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    return (err as Error).message;
  }
  throw new Error("expected the request to reject");
}

describe("sendTeamsRequest", () => {
  it("sends the method and a JSON body to the url it was given", async () => {
    mockFetch.mockResolvedValue(json(200, { success: true }));

    await sendTeamsRequest(
      "/api/v3/teams/members",
      "DELETE",
      { teamId: 5, userId: 9 },
      "fallback",
    );

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v3/teams/members");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ teamId: 5, userId: 9 });
  });

  it("resolves on success without reading the body", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      sendTeamsRequest("/x", "PATCH", {}, "fallback"),
    ).resolves.toBeUndefined();
  });

  it("rejects with the server's own reason, not the fallback", async () => {
    // The role ceiling is the case the dialog used to hide: the 403 came back,
    // the dialog closed, and the sentence landed in a banner above the header.
    mockFetch.mockResolvedValue(
      json(403, {
        error:
          "You can't remove a member whose role has more permissions than your own.",
      }),
    );

    expect(
      await messageOf(
        sendTeamsRequest(
          "/x",
          "DELETE",
          {},
          "We could not remove that member.",
        ),
      ),
    ).toBe(
      "You can't remove a member whose role has more permissions than your own.",
    );
  });

  it("rejects with the rename validation message", async () => {
    mockFetch.mockResolvedValue(
      json(400, { error: "Team name must be 2-50 characters." }),
    );

    expect(
      await messageOf(
        sendTeamsRequest("/x", "PATCH", {}, "We could not rename that team."),
      ),
    ).toBe("Team name must be 2-50 characters.");
  });

  it.each([
    ["a body that is not JSON", () => new Response("<html>", { status: 502 })],
    ["a JSON body with no error", () => json(500, { status: 500 })],
    ["an empty error string", () => json(500, { error: "" })],
    ["an error that is not a string", () => json(500, { error: { a: 1 } })],
    ["a JSON null", () => json(500, null)],
  ])("falls back to the caller's sentence for %s", async (_label, make) => {
    mockFetch.mockResolvedValue(make());

    expect(
      await messageOf(sendTeamsRequest("/x", "POST", {}, "Try again later.")),
    ).toBe("Try again later.");
  });

  it("says the server could not be reached instead of 'Failed to fetch'", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(
      await messageOf(sendTeamsRequest("/x", "POST", {}, "Try again later.")),
    ).toBe(TEAMS_UNREACHABLE);
  });
});
