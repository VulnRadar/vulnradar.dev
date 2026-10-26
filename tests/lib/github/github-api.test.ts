import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  GITHUB_FETCH_TIMEOUT_MS,
  createRepoIssue,
  getBlobContent,
  getRepoInfo,
  getReposByFullName,
  getSelectedRepos,
  isGithubTimeout,
  listRepoTree,
  listUserRepos,
} from "@/lib/github/github-api";

/**
 * Outbound fetch is stubbed; these pin what the module sends to GitHub and how
 * it reads the answers. Two contracts matter most: no request goes out without
 * a timeout (there was none, so a GitHub that stopped answering held the page
 * or the scan behind it indefinitely), and a selected repo that has gone away
 * is told apart from GitHub being unwell.
 */

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function json(body: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function repoBody(fullName: string, extra: Record<string, unknown> = {}) {
  return {
    full_name: fullName,
    private: false,
    default_branch: "main",
    updated_at: "2026-02-03T00:00:00Z",
    description: null,
    ...extra,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("request timeouts", () => {
  it("is ten seconds", () => {
    expect(GITHUB_FETCH_TIMEOUT_MS).toBe(10_000);
  });

  // One case per exported call that talks to GitHub. A new call that reaches
  // for fetch directly instead of the shared wrapper fails the count below.
  const CALLS: [string, () => Promise<unknown>, unknown][] = [
    ["listUserRepos", () => listUserRepos("tok"), []],
    [
      "getRepoInfo",
      () => getRepoInfo("tok", "octocat", "hello"),
      { default_branch: "main", private: false },
    ],
    [
      "createRepoIssue",
      () =>
        createRepoIssue("tok", "octocat", "hello", { title: "t", body: "b" }),
      { number: 1, html_url: "https://github.com/octocat/hello/issues/1" },
    ],
    [
      "listRepoTree",
      () => listRepoTree("tok", "octocat", "hello", "main"),
      { tree: [], truncated: false },
    ],
    [
      "getBlobContent",
      () => getBlobContent("tok", "octocat", "hello", "abc123"),
      { content: Buffer.from("x").toString("base64"), encoding: "base64" },
    ],
    [
      "getReposByFullName",
      () => getReposByFullName("tok", ["octocat/hello"]),
      repoBody("octocat/hello"),
    ],
  ];

  it.each(CALLS)(
    "%s sends an AbortSignal.timeout(10_000)",
    async (_n, call, body) => {
      const timeout = vi.spyOn(AbortSignal, "timeout");
      mockFetch.mockResolvedValue(json(body));

      await call();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledWith(10_000);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.signal).toBeInstanceOf(AbortSignal);
    },
  );

  it.each(CALLS)(
    "%s rejects with a timeout error GitHub cannot outlast",
    async (_n, call) => {
      // An already-expired signal, and a fetch that honours it the way undici
      // does: rejecting with the signal's reason.
      vi.spyOn(AbortSignal, "timeout").mockImplementation(() =>
        AbortSignal.abort(new DOMException("timed out", "TimeoutError")),
      );
      mockFetch.mockImplementation(
        async (_url: string, init: { signal: AbortSignal }) => {
          if (init.signal.aborted) throw init.signal.reason;
          return json({});
        },
      );

      const err = await call().then(
        () => null,
        (e: unknown) => e,
      );

      expect(isGithubTimeout(err)).toBe(true);
    },
  );

  it("isGithubTimeout recognises only a TimeoutError", () => {
    expect(isGithubTimeout(new DOMException("t", "TimeoutError"))).toBe(true);
    expect(isGithubTimeout(new DOMException("a", "AbortError"))).toBe(false);
    expect(isGithubTimeout(new Error("GitHub repo list HTTP 500"))).toBe(false);
    expect(isGithubTimeout("TimeoutError")).toBe(false);
    expect(isGithubTimeout(null)).toBe(false);
  });
});

describe("getReposByFullName", () => {
  it("returns the repos in the order asked for, whatever order GitHub answers in", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      // The first name is the slow one.
      if (url.endsWith("/repos/a/first")) {
        await new Promise((r) => setTimeout(r, 15));
      }
      return json(repoBody(url.replace("https://api.github.com/repos/", "")));
    });

    const repos = await getReposByFullName("tok", [
      "a/first",
      "b/second",
      "c/third",
    ]);

    expect(repos.map((r) => r.fullName)).toEqual([
      "a/first",
      "b/second",
      "c/third",
    ]);
  });

  it("maps GitHub's field names onto the summary", async () => {
    mockFetch.mockResolvedValue(
      json(
        repoBody("acme/api", {
          private: true,
          default_branch: "trunk",
          description: "the api",
        }),
      ),
    );
    expect(await getReposByFullName("tok", ["acme/api"])).toEqual([
      {
        fullName: "acme/api",
        private: true,
        defaultBranch: "trunk",
        updatedAt: "2026-02-03T00:00:00Z",
        description: "the api",
      },
    ]);
  });

  it("sends the token and GitHub's API version headers", async () => {
    mockFetch.mockResolvedValue(json(repoBody("acme/api")));
    await getReposByFullName("gho_realtoken", ["acme/api"]);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/api");
    expect(options.headers.Authorization).toBe("Bearer gho_realtoken");
    expect(options.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("makes no request for nothing", async () => {
    expect(await getReposByFullName("tok", [])).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([404, 410, 451])(
    "treats a %s as a repo that is no longer there",
    async (status) => {
      mockFetch.mockImplementation(async (url: string) =>
        url.endsWith("/gone/repo")
          ? new Response("{}", { status })
          : json(repoBody("kept/repo")),
      );
      const repos = await getReposByFullName("tok", ["gone/repo", "kept/repo"]);
      expect(repos.map((r) => r.fullName)).toEqual(["kept/repo"]);
    },
  );

  it("treats a plain 403 as no access (an org's SSO or policy), not as a failure", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith("/sso/blocked")
        ? new Response("{}", { status: 403 })
        : json(repoBody("kept/repo")),
    );
    const repos = await getReposByFullName("tok", ["sso/blocked", "kept/repo"]);
    expect(repos.map((r) => r.fullName)).toEqual(["kept/repo"]);
  });

  it.each([
    ["a 403 with no quota left", 403, { "x-ratelimit-remaining": "0" }],
    ["a 403 with Retry-After", 403, { "retry-after": "30" }],
    ["a 429", 429, {}],
  ])("fails on %s instead of dropping repos", async (_n, status, headers) => {
    mockFetch.mockResolvedValue(new Response("{}", { status, headers }));
    await expect(getReposByFullName("tok", ["acme/api"])).rejects.toThrow(
      `GitHub repo lookup HTTP ${status}`,
    );
  });

  it.each([401, 500, 502])("fails on a %s", async (status) => {
    mockFetch.mockResolvedValue(new Response("{}", { status }));
    await expect(getReposByFullName("tok", ["acme/api"])).rejects.toThrow(
      `GitHub repo lookup HTTP ${status}`,
    );
  });

  it("drops a repo GitHub answers with a different name (renamed or transferred)", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith("/old/name")
        ? json(repoBody("new/name"))
        : json(repoBody("kept/repo")),
    );
    const repos = await getReposByFullName("tok", ["old/name", "kept/repo"]);
    expect(repos.map((r) => r.fullName)).toEqual(["kept/repo"]);
  });

  it("matches names case-insensitively and reports GitHub's own spelling", async () => {
    mockFetch.mockResolvedValue(json(repoBody("OctoCat/Hello-World")));
    const repos = await getReposByFullName("tok", ["octocat/hello-world"]);
    expect(repos.map((r) => r.fullName)).toEqual(["OctoCat/Hello-World"]);
  });

  it.each([
    "../user",
    "./repo",
    "owner/..",
    "owner/.",
    "owner",
    "a/b/c",
    "owner/re po",
    "owner/repo?x=1",
    "owner/repo#frag",
    "own%2fer/repo",
    "/repo",
    "owner/",
  ])("never sends %j to GitHub", async (name) => {
    expect(await getReposByFullName("tok", [name])).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps at most eight lookups in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    mockFetch.mockImplementation(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return json(repoBody(url.replace("https://api.github.com/repos/", "")));
    });

    const names = Array.from({ length: 40 }, (_, i) => `acme/repo-${i}`);
    const repos = await getReposByFullName("tok", names);

    expect(repos).toHaveLength(40);
    expect(mockFetch).toHaveBeenCalledTimes(40);
    expect(peak).toBe(8);
  });

  it("stops starting lookups once one has failed", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      await new Promise((r) => setTimeout(r, 2));
      return url.endsWith("/repo-3")
        ? new Response("{}", { status: 500 })
        : json(repoBody(url.replace("https://api.github.com/repos/", "")));
    });

    const names = Array.from({ length: 200 }, (_, i) => `acme/repo-${i}`);
    await expect(getReposByFullName("tok", names)).rejects.toThrow("HTTP 500");

    // Nowhere near the 200 asked for: only what was already under way.
    expect(mockFetch.mock.calls.length).toBeLessThan(40);
  });
});

describe("getSelectedRepos", () => {
  const names = (n: number) =>
    Array.from({ length: n }, (_, i) => `acme/repo-${i}`);

  it("looks a short selection up by name and never lists the account", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      json(repoBody(url.replace("https://api.github.com/repos/", ""))),
    );

    const repos = await getSelectedRepos("tok", names(30));

    expect(repos).toHaveLength(30);
    const urls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(urls).toHaveLength(30);
    expect(urls.every((u) => u.includes("/repos/acme/repo-"))).toBe(true);
    expect(urls.some((u) => u.includes("/user/repos"))).toBe(false);
  });

  it("resolves a long selection from the listing instead of hundreds of lookups", async () => {
    const all = names(250);
    mockFetch.mockImplementation(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page"));
      const slice = all.slice((page - 1) * 100, page * 100);
      return json(slice.map((n) => repoBody(n)));
    });

    // Asked for in a different order from the account's, with one repo that
    // is not on the account any more.
    const wanted = [...names(100).reverse(), "gone/repo"];
    const repos = await getSelectedRepos("tok", wanted);

    expect(repos.map((r) => r.fullName)).toEqual(names(100).reverse());
    const urls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(urls.every((u) => u.includes("/user/repos"))).toBe(true);
    expect(urls.length).toBeLessThanOrEqual(3);
  });

  it("matches the listing case-insensitively", async () => {
    mockFetch.mockResolvedValue(
      json(names(40).map((n) => repoBody(n.replace("acme", "Acme")))),
    );
    const repos = await getSelectedRepos("tok", names(40));
    expect(repos).toHaveLength(40);
    expect(repos[0].fullName).toBe("Acme/repo-0");
  });

  it("makes no request for nothing", async () => {
    expect(await getSelectedRepos("tok", [])).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
