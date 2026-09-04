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

const mockGetRepoInfo = vi.fn();
const mockListRepoTree = vi.fn();
vi.mock("@/lib/github/github-api", () => ({
  getRepoInfo: (...args: unknown[]) => mockGetRepoInfo(...args),
  listRepoTree: (...args: unknown[]) => mockListRepoTree(...args),
}));

const mockFetchSelectedFiles = vi.fn();
const mockRunPatternSecretsScan = vi.fn();
vi.mock("@/lib/scanner/github-repo-scan", () => ({
  estimateTokens: (chars: number) => Math.ceil(chars / 4),
  fetchSelectedFiles: (...args: unknown[]) => mockFetchSelectedFiles(...args),
  runPatternSecretsScan: (...args: unknown[]) =>
    mockRunPatternSecretsScan(...args),
}));

const mockRunGithubAiReview = vi.fn();
vi.mock("@/lib/ai/review-source", () => ({
  runGithubAiReview: (...args: unknown[]) => mockRunGithubAiReview(...args),
}));

const mockCheckGithubReviewQuota = vi.fn();
vi.mock("@/lib/billing/github-review-usage", () => ({
  checkGithubReviewQuota: (...args: unknown[]) =>
    mockCheckGithubReviewQuota(...args),
}));

const mockCheckGlobalRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckGlobalRateLimit(...args),
  RATE_LIMITS: { scan: { limit: "scan" } },
}));

const SETTINGS: Record<string, number> = {
  GITHUB_REVIEW_MAX_FILES: 300,
  GITHUB_REVIEW_MAX_TOTAL_BYTES: 5_000_000,
  GITHUB_REVIEW_MAX_FILE_BYTES: 300_000,
  GITHUB_REVIEW_MAX_TOKENS_PER_RUN: 300_000,
};
vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  const resolve = (key: string) =>
    key in SETTINGS
      ? SETTINGS[key]
      : (SETTINGS_REGISTRY as Record<string, { default: unknown }>)[key]
          ?.default;
  return {
    getSetting: (key: string) => Promise.resolve(resolve(key)),
    // getSettings, and the registry-default fallback above, are for the
    // PAUSE_SCANNING gate this route now runs first
    // (lib/admin/service-state.ts), which resolves the four operational
    // switches in one go. Falling back to the shipped defaults keeps them
    // all off, which is what every case in this file assumes.
    getSettings: (keys: readonly string[]) =>
      Promise.resolve(Object.fromEntries(keys.map((k) => [k, resolve(k)]))),
  };
});

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
  mockGetRepoInfo.mockReset();
  mockGetRepoInfo.mockResolvedValue({ defaultBranch: "main", private: true });
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
  mockCheckGlobalRateLimit.mockReset();
  mockCheckGlobalRateLimit.mockResolvedValue({ allowed: true });
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

  it("429s when the per-user request rate limit is exceeded, before touching GitHub's API (AUDIT-010, production-readiness #5)", async () => {
    mockCheckGlobalRateLimit.mockResolvedValue({ allowed: false });
    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(429);
    expect(mockGetDecryptedGithubToken).not.toHaveBeenCalled();
    expect(mockGetRepoInfo).not.toHaveBeenCalled();
    expect(mockListRepoTree).not.toHaveBeenCalled();
    const [config] = mockCheckGlobalRateLimit.mock.calls[0];
    expect(config.key).toBe("scan-github:5");
  });

  it("checks quota before calling GitHub's API, not after (AUDIT-010, production-readiness #5)", async () => {
    mockCheckGithubReviewQuota.mockResolvedValue({
      allowed: false,
      usingOwnAi: false,
      usedTokens: 200_000,
      limitTokens: 200_000,
      message: "You've used all your GitHub review AI tokens for this month.",
    });
    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(403);
    expect(mockGetRepoInfo).not.toHaveBeenCalled();
    expect(mockListRepoTree).not.toHaveBeenCalled();
  });

  it("rejects when no scannable files remain after filtering", async () => {
    mockListRepoTree.mockResolvedValue({
      entries: [
        { path: "node_modules/x.js", type: "blob", sha: "s", size: 10 },
      ],
      truncated: false,
    });
    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(400);
  });

  it("rejects when the estimated content exceeds the per-run token ceiling, even with quota available", async () => {
    // Many files, each safely under the per-file byte cap (300_000) and
    // the total still under the total-byte cap (5_000_000), but whose sum
    // (1.5MB -> ~375k estimated tokens) exceeds the 300k token ceiling. A
    // single oversized file would instead be dropped by the per-file cap
    // before ever reaching the token estimate — this exercises the
    // token-ceiling rejection specifically.
    mockListRepoTree.mockResolvedValue({
      entries: Array.from({ length: 6 }, (_, i) =>
        treeEntry(`file${i}.ts`, 250_000),
      ),
      truncated: false,
    });
    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(413);
    // The upfront quota pre-check (before any GitHub API call) already
    // passed -- the token ceiling is what blocks this, not quota. The
    // second, atomic quota check right before claimFreeGithubReviewTrial
    // is never reached because the 413 short-circuits first.
    expect(mockCheckGithubReviewQuota).toHaveBeenCalledTimes(1);
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
    expect(sql).toContain("is_public");
    expect(sql).toContain("FALSE");
    expect(params[0]).toBe(5); // userId
    expect(params[1]).toBe("octocat/hello-world");
  });

  it("uses the caller-supplied ref instead of the repo's default branch", async () => {
    await POST(
      postReq({ repoFullName: "octocat/hello-world", ref: "feature-branch" }),
    );
    // getRepoInfo is still called (it's also where repo visibility comes
    // from), but its defaultBranch is ignored in favor of the caller's ref.
    expect(mockListRepoTree).toHaveBeenCalledWith(
      "gho_token",
      "octocat",
      "hello-world",
      "feature-branch",
    );
  });

  it("passes usingOwnAi and repo visibility through to the AI review", async () => {
    mockCheckGithubReviewQuota.mockResolvedValue({
      allowed: true,
      usingOwnAi: true,
      usedTokens: 0,
      limitTokens: -1,
    });
    mockGetRepoInfo.mockResolvedValue({
      defaultBranch: "main",
      private: false,
    });
    await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(mockRunGithubAiReview).toHaveBeenCalledWith(
      expect.anything(),
      5,
      true,
      false,
      false, // creditCovered
    );
  });
});
