import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GITHUB_FETCH_TIMEOUT_MS } from "@/lib/github/github-api";
import { exchangeGithubCode, fetchGithubUser } from "@/lib/github/github-oauth";

/**
 * Neither OAuth call had a limit, so GitHub accepting the connection and then
 * saying nothing held the callback for as long as undici's own timeouts
 * allowed. Both now carry the same deadline as every other GitHub call, and a
 * miss reads as a timeout in the log rather than as a bare AbortError.
 */

const CODE = "the-oauth-code";
const SECRET = "the-client-secret";
const TOKEN = "gho_the_token";

const exchange = () =>
  exchangeGithubCode({
    clientId: "id",
    clientSecret: SECRET,
    code: CODE,
    redirectUri: "https://example.test/cb",
  });

const fetchMock = vi.fn();

function timesOut() {
  fetchMock.mockRejectedValue(
    new DOMException("The operation timed out.", "TimeoutError"),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("exchangeGithubCode", () => {
  it("passes a deadline to fetch and returns the token", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(
      Response.json({ access_token: TOKEN, scope: "repo" }),
    );

    await expect(exchange()).resolves.toEqual({
      accessToken: TOKEN,
      scopes: "repo",
    });
    expect(timeout).toHaveBeenCalledWith(GITHUB_FETCH_TIMEOUT_MS);
    expect(fetchMock.mock.calls[0][1].signal).toBe(
      timeout.mock.results[0].value,
    );
  });

  it("names the step on a timeout and never the code or the secret", async () => {
    timesOut();
    const err = (await exchange().catch((e) => e)) as Error;
    expect(err.message).toMatch(/token exchange timed out/i);
    expect(err.message).not.toContain(CODE);
    expect(err.message).not.toContain(SECRET);
  });

  it("leaves any other failure as it was", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    await expect(exchange()).rejects.toThrow("GitHub token exchange HTTP 503");
  });

  it("treats a body that stalls after the headers as a timeout too", async () => {
    const response = new Response("{}");
    vi.spyOn(response, "json").mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    fetchMock.mockResolvedValue(response);
    await expect(exchange()).rejects.toThrow(/timed out/i);
  });
});

describe("fetchGithubUser", () => {
  it("passes a deadline to fetch and returns the identity", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(Response.json({ id: 1, login: "octocat" }));

    await expect(fetchGithubUser(TOKEN)).resolves.toEqual({
      id: 1,
      login: "octocat",
    });
    expect(timeout).toHaveBeenCalledWith(GITHUB_FETCH_TIMEOUT_MS);
  });

  it("names the step on a timeout and never the token", async () => {
    timesOut();
    const err = (await fetchGithubUser(TOKEN).catch((e) => e)) as Error;
    expect(err.message).toMatch(/user lookup timed out/i);
    expect(err.message).not.toContain(TOKEN);
  });
});
