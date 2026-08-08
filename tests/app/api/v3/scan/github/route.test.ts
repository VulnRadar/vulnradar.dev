import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for POST /api/v3/scan/github. Mocked at each
 * network/database boundary this route talks to: session, the pg pool
 * (github_connections lookup + scan_history insert happen inside mocked
 * modules or the mocked pool directly), the GitHub API client, the repo
 * scan engine, the AI review pass, the monthly quota check, and the
 * runtime settings resolver. Nothing here hits a real network endpoint.
 */

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetDecryptedGithubToken = vi.fn();
vi.mock("@/lib/github/github-connections", () => ({
  getDecryptedGithubToken: (...args: unknown[]) =>
    mockGetDecryptedGithubToken(...args),
}));

const mockGetRepoDefaultBranch = vi.fn();
const mockListRepoTree = vi.fn();
vi.mock("@/lib/github/github-api", () => ({
  getRepoDefaultBranch: (...args: unknown[]) => mockGetRepoDefaultBranch(...args),
  listRepoTree: (...args: unknown[]) => mockListRepoTree(...args),
}));

const mockFetchSelectedFiles = vi.fn();
const mockRunPatternSecretsScan = vi.fn();
vi.mock("@/lib/scanner/github-repo-scan", () => ({
  estimateTokens: (chars: number) => Math.ceil(chars / 4),
  fetchSelectedFiles: (...args: unknown[]) => mockFetchSelectedFiles(...args),
  runPatternSecretsScan: (...args: unknown[]) => mockRunPatternSecretsScan(...args),
}));

const mockRunGithubAiReview = vi.fn();
vi.mock("@/lib/ai/review-source", () => ({
  runGithubAiReview: (...args: unknown[]) => mockRunGithubAiReview(...args),
}));

const mockCheckGithubReviewQuota = vi.fn();
vi.mock("@/lib/billing/github-review-usage", () => ({
  checkGithubReviewQuota: (...args: unknown[]) => mockCheckGithubReviewQuota(...args),
}));

const SETTINGS: Record<string, number> = {
  GITHUB_REVIEW_MAX_FILES: 300,
  GITHUB_REVIEW_MAX_TOTAL_BYTES: 5_000_000,
  GITHUB_REVIEW_MAX_FILE_BYTES: 300_000,
  GITHUB_REVIEW_MAX_TOKENS_PER_RUN: 300_000,
};
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (key: string) => Promise.resolve(SETTINGS[key]),
}));

const { POST } = await import("@/app/api/v3/scan/github/route");

function postReq(body: unknown) {
  return new Request("http://localhost/api/v3/scan/github", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function treeEntry(path: string, size = 100) {
  return { path, type: "blob" as const, sha: `sha-${path}`, size };
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 5 });
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ id: 99 }] });
  mockGetDecryptedGithubToken.mockReset();
  mockGetDecryptedGithubToken.mockResolvedValue("gho_token");
  mockGetRepoDefaultBranch.mockReset();
  mockGetRepoDefaultBranch.mockResolvedValue("main");
  mockListRepoTree.mockReset();
  mockListRepoTree.mockResolvedValue({
    entries: [treeEntry("src/index.ts")],
    truncated: false,
  });
  mockFetchSelectedFiles.mockReset();
  mockFetchSelectedFiles.mockResolvedValue([
    { path: "src/index.ts", content: "export const x = 1;" },
  ]);
  mockRunPatternSecretsScan.mockReset();
  mockRunPatternSecretsScan.mockReturnValue([]);
  mockRunGithubAiReview.mockReset();
  mockRunGithubAiReview.mockResolvedValue({
    findings: [],
    totalTokensUsed: 0,
    noEndpoint: false,
    rejectedOverCap: false,
  });
  mockCheckGithubReviewQuota.mockReset();
  mockCheckGithubReviewQuota.mockResolvedValue({
    allowed: true,
    usingOwnAi: false,
    usedTokens: 0,
    limitTokens: 200_000,
  });
});

describe("POST /api/v3/scan/github", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed repoFullName", async () => {
    const res = await POST(postReq({ repoFullName: "not-a-valid-name" }));
    expect(res.status).toBe(400);
  });

  it("requires a GitHub connection", async () => {
    mockGetDecryptedGithubToken.mockResolvedValue(null);
    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(400);
    expect(mockListRepoTree).not.toHaveBeenCalled();
  });

  it("rejects when no scannable files remain after filtering", async () => {
    mockListRepoTree.mockResolvedValue({
      entries: [{ path: "node_modules/x.js", type: "blob", sha: "s", size: 10 }],
      truncated: false,
    });
    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(400);
  });

  it("rejects upfront when the estimated content exceeds the per-run token ceiling, regardless of quota", async () => {
    // Many files, each safely under the per-file byte cap (300_000) and
    // the total still under the total-byte cap (5_000_000), but whose sum
    // (1.5MB -> ~375k estimated tokens) exceeds the 300k token ceiling. A
    // single oversized file would instead be dropped by the per-file cap
    // before ever reaching the token estimate — this exercises the
    // token-ceiling rejection specifically.
    mockListRepoTree.mockResolvedValue({
      entries: Array.from({ length: 6 }, (_, i) => treeEntry(`file${i}.ts`, 250_000)),
      truncated: false,
    });
    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(413);
    expect(mockCheckGithubReviewQuota).not.toHaveBeenCalled();
    expect(mockFetchSelectedFiles).not.toHaveBeenCalled();
  });

  it("blocks the whole trigger with the quota's message when over the monthly cap", async () => {
    mockCheckGithubReviewQuota.mockResolvedValue({
      allowed: false,
      usingOwnAi: false,
      usedTokens: 200_000,
      limitTokens: 200_000,
      message: "You've used all your GitHub review AI tokens for this month.",
    });
    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/used all your GitHub review AI tokens/);
    expect(mockFetchSelectedFiles).not.toHaveBeenCalled();
  });

  it("runs the pattern scan and AI review, saves scan_history with scan_type='github', and returns the result", async () => {
    mockRunPatternSecretsScan.mockReturnValue([
      {
        id: "secret-x--1",
        title: "Hardcoded secret",
        severity: "critical",
        category: "secrets-extended",
        description: "d",
        evidence: "e",
        riskImpact: "r",
        explanation: "x",
        fixSteps: [],
        codeExamples: [],
        location: { file: "src/index.ts" },
      },
    ]);
    mockRunGithubAiReview.mockResolvedValue({
      findings: [],
      totalTokensUsed: 1200,
      noEndpoint: false,
      rejectedOverCap: false,
    });

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary.total).toBe(1);
    expect(json.summary.critical).toBe(1);
    expect(json.scanHistoryId).toBe(99);
    expect(json.aiTokensUsed).toBe(1200);

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall!;
    expect(sql).toContain("'github'");
    expect(params[0]).toBe(5); // userId
    expect(params[1]).toBe("octocat/hello-world");
  });

  it("uses the caller-supplied ref instead of resolving the default branch", async () => {
    await POST(postReq({ repoFullName: "octocat/hello-world", ref: "feature-branch" }));
    expect(mockGetRepoDefaultBranch).not.toHaveBeenCalled();
    expect(mockListRepoTree).toHaveBeenCalledWith(
      "gho_token",
      "octocat",
      "hello-world",
      "feature-branch",
    );
  });

  it("passes usingOwnAi through so AI review knows not to count against the cap", async () => {
    mockCheckGithubReviewQuota.mockResolvedValue({
      allowed: true,
      usingOwnAi: true,
      usedTokens: 0,
      limitTokens: -1,
    });
    await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(mockRunGithubAiReview).toHaveBeenCalledWith(
      expect.anything(),
      5,
      true,
    );
  });
});
