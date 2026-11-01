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
const mockPlanGithubReview = vi.fn();
vi.mock("@/lib/ai/review-source", () => ({
  runGithubAiReview: (...args: unknown[]) => mockRunGithubAiReview(...args),
  planGithubReview: (...args: unknown[]) => mockPlanGithubReview(...args),
}));

/** What runGithubAiReview hands back; a whole review of one file by default. */
function aiRun(overrides: Record<string, unknown> = {}) {
  return {
    findings: [],
    totalTokensUsed: 0,
    noEndpoint: false,
    rejectedOverCap: false,
    stoppedAtBudget: false,
    stoppedAtRunCap: false,
    filesReviewed: 1,
    filesTotal: 1,
    batchesReviewed: 1,
    batchesTotal: 1,
    ...overrides,
  };
}

/** What planGithubReview hands back for the tree. */
function reviewPlan(overrides: Record<string, unknown> = {}) {
  return {
    estimate: 40_000,
    firstBatch: 40_000,
    inputWithinCap: 30_000,
    batchesWithinCap: 1,
    batchesTotal: 1,
    ...overrides,
  };
}

const mockCheckGithubReviewQuota = vi.fn();
const mockReserveGithubReviewTokens = vi.fn();
const mockSettleGithubReviewTokens = vi.fn();
const mockReleaseFreeGithubReviewTrial = vi.fn();
vi.mock("@/lib/billing/github-review-usage", () => ({
  checkGithubReviewQuota: (...args: unknown[]) =>
    mockCheckGithubReviewQuota(...args),
  reserveGithubReviewTokens: (...args: unknown[]) =>
    mockReserveGithubReviewTokens(...args),
  settleGithubReviewTokens: (...args: unknown[]) =>
    mockSettleGithubReviewTokens(...args),
  releaseFreeGithubReviewTrial: (...args: unknown[]) =>
    mockReleaseFreeGithubReviewTrial(...args),
}));

/** What reserveGithubReviewTokens hands back for a review it let in. */
function reservation(overrides: Record<string, unknown> = {}) {
  return {
    userId: 5,
    usingOwnAi: false,
    windowStart: new Date(0),
    budget: 40_000,
    windowPortion: 40_000,
    creditPortion: 0,
    slotKey: "github-review:5",
    settled: false,
    isFreeTrial: false,
    creditCovered: false,
    ...overrides,
  };
}

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

// A repo scan used to fire no notification at all. It now calls the shared
// tail (lib/webhooks/scan-notifications.ts), mocked at that module boundary
// here so its own two lookups do not consume the mockQuery call sequence the
// scan_history assertions below depend on. What the tail then delivers is
// covered by tests/lib/webhooks/scan-notifications.test.ts.
const mockNotifyScanComplete = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/webhooks/scan-notifications", () => ({
  notifyScanComplete: (...args: unknown[]) => mockNotifyScanComplete(...args),
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
  mockRunGithubAiReview.mockResolvedValue(aiRun());
  mockPlanGithubReview.mockReset();
  mockPlanGithubReview.mockResolvedValue(reviewPlan());
  mockReserveGithubReviewTokens.mockReset();
  mockReserveGithubReviewTokens.mockResolvedValue({
    allowed: true,
    reservation: reservation(),
  });
  mockSettleGithubReviewTokens.mockReset();
  mockSettleGithubReviewTokens.mockResolvedValue(undefined);
  mockReleaseFreeGithubReviewTrial.mockReset();
  mockReleaseFreeGithubReviewTrial.mockResolvedValue(undefined);
  mockCheckGithubReviewQuota.mockReset();
  mockCheckGithubReviewQuota.mockResolvedValue({
    allowed: true,
    usingOwnAi: false,
    usedTokens: 0,
    limitTokens: 200_000,
  });
  mockCheckGlobalRateLimit.mockReset();
  mockCheckGlobalRateLimit.mockResolvedValue({ allowed: true });
  mockNotifyScanComplete.mockClear();
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
      usedTokens: 0,
      limitTokens: 0,
      message: "You've used today's free GitHub AI review.",
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

  it("a repo over the per-run token ceiling is partly reviewed and pattern scanned whole, instead of a 413", async () => {
    // Six files under the per-file cap whose sum is over the 300k ceiling.
    // This used to answer 413 and scan nothing; the AI review now stops at
    // the ceiling and the pattern scan still covers every file.
    const entries = Array.from({ length: 6 }, (_, i) =>
      treeEntry(`file${i}.ts`, 250_000),
    );
    mockListRepoTree.mockResolvedValue({ entries, truncated: false });
    const fetched = entries.map((e) => ({ path: e.path, content: "x" }));
    mockFetchSelectedFiles.mockResolvedValue(fetched);
    mockPlanGithubReview.mockResolvedValue(
      reviewPlan({ batchesWithinCap: 1, batchesTotal: 6 }),
    );
    mockRunGithubAiReview.mockResolvedValue(
      aiRun({
        stoppedAtRunCap: true,
        filesReviewed: 1,
        filesTotal: 6,
        batchesTotal: 6,
      }),
    );

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect(res.status).toBe(200);
    expect(mockRunPatternSecretsScan).toHaveBeenCalledWith(fetched);
    const json = await res.json();
    expect(json.filesScanned).toBe(6);
    expect(json.aiReviewStoppedAtRunCap).toBe(true);
    expect(json.aiReviewStoppedAtBudget).toBe(false);
    expect(json.aiReviewCoverage).toEqual({
      filesReviewed: 1,
      filesTotal: 6,
      batchesReviewed: 1,
      batchesTotal: 6,
    });
  });

  it("when not even the first batch fits under the per-run ceiling, reserves nothing and still runs the pattern scan", async () => {
    mockPlanGithubReview.mockResolvedValue(
      reviewPlan({
        estimate: 0,
        firstBatch: 0,
        inputWithinCap: 0,
        batchesWithinCap: 0,
      }),
    );
    // The plan works from tree sizes; content that turns out smaller can
    // fit the ceiling after all, and then the zero budget is what stops it.
    mockRunGithubAiReview.mockResolvedValue(
      aiRun({ stoppedAtBudget: true, filesReviewed: 0, batchesReviewed: 0 }),
    );

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect(res.status).toBe(200);
    expect(mockReserveGithubReviewTokens).not.toHaveBeenCalled();
    expect(mockRunGithubAiReview).toHaveBeenCalledWith(
      expect.anything(),
      5,
      true,
      0,
    );
    expect(mockSettleGithubReviewTokens).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.aiReviewStoppedAtRunCap).toBe(true);
    expect(json.aiReviewStoppedAtBudget).toBe(false);
  });

  it("refuses the whole trigger on a plan with no GitHub review once its free trial is used", async () => {
    mockCheckGithubReviewQuota.mockResolvedValue({
      allowed: false,
      usingOwnAi: false,
      usedTokens: 0,
      limitTokens: 0,
      message: "You've used today's free GitHub AI review.",
    });
    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/used today's free GitHub AI review/);
    expect(mockFetchSelectedFiles).not.toHaveBeenCalled();
  });

  it("still pattern-scans every file when the plan's window is used up, and says why the AI review did not run", async () => {
    // D13: the pattern scan runs whatever the AI allowance. This answered 403
    // with no scan at all, while the same account with one token left got the
    // full pattern scan.
    mockCheckGithubReviewQuota.mockResolvedValue({
      allowed: false,
      usingOwnAi: false,
      usedTokens: 200_000,
      limitTokens: 200_000,
      message: "You've used all your GitHub review AI tokens for this month.",
    });
    mockRunGithubAiReview.mockResolvedValue(
      aiRun({ stoppedAtBudget: true, filesReviewed: 0, batchesReviewed: 0 }),
    );

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect(res.status).toBe(200);
    expect(mockRunPatternSecretsScan).toHaveBeenCalledTimes(1);
    expect(mockReserveGithubReviewTokens).not.toHaveBeenCalled();
    expect(mockRunGithubAiReview).toHaveBeenCalledWith(
      expect.anything(),
      5,
      true,
      0,
    );
    expect(mockSettleGithubReviewTokens).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.aiReviewStoppedAtBudget).toBe(true);
    expect(json.aiReviewAllowanceMessage).toMatch(
      /used all your GitHub review AI tokens/,
    );
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
    mockRunGithubAiReview.mockResolvedValue(aiRun({ totalTokensUsed: 1200 }));

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

  it("passes repo visibility and the reservation's budget through to the AI review", async () => {
    mockGetRepoInfo.mockResolvedValue({
      defaultBranch: "main",
      private: false,
    });
    await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(mockRunGithubAiReview).toHaveBeenCalledWith(
      expect.anything(),
      5,
      false,
      40_000,
    );
  });
});

describe("POST /api/v3/scan/github - credit reservation", () => {
  it("reserves the tree's estimate before fetching any content, needing only the first batch's ceiling", async () => {
    mockListRepoTree.mockResolvedValue({
      entries: [treeEntry("src/a.ts", 1200), treeEntry("src/b.ts", 800)],
      truncated: false,
    });
    mockPlanGithubReview.mockResolvedValue(
      reviewPlan({ estimate: 90_000, firstBatch: 45_000, batchesWithinCap: 2 }),
    );

    await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect(mockPlanGithubReview).toHaveBeenCalledWith([1200, 800]);
    expect(mockReserveGithubReviewTokens).toHaveBeenCalledWith(
      5,
      90_000,
      45_000,
    );
    expect(
      mockReserveGithubReviewTokens.mock.invocationCallOrder[0],
    ).toBeLessThan(mockFetchSelectedFiles.mock.invocationCallOrder[0]);
  });

  it("partial fit: runs the AI review on what was reserved and says where it stopped", async () => {
    mockReserveGithubReviewTokens.mockResolvedValue({
      allowed: true,
      reservation: reservation({ budget: 50_000 }),
    });
    mockRunGithubAiReview.mockResolvedValue(
      aiRun({
        totalTokensUsed: 44_000,
        stoppedAtBudget: true,
        filesReviewed: 12,
        filesTotal: 40,
        batchesReviewed: 1,
        batchesTotal: 4,
      }),
    );

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect(res.status).toBe(200);
    expect(mockRunGithubAiReview).toHaveBeenCalledWith(
      expect.anything(),
      5,
      true,
      50_000,
    );
    const json = await res.json();
    expect(json.aiReviewStoppedAtBudget).toBe(true);
    expect(json.aiReviewCoverage).toEqual({
      filesReviewed: 12,
      filesTotal: 40,
      batchesReviewed: 1,
      batchesTotal: 4,
    });
    expect(json.aiReviewAllowanceMessage).toBeNull();
    expect(mockSettleGithubReviewTokens).toHaveBeenCalledWith(
      expect.objectContaining({ budget: 50_000 }),
      44_000,
    );
  });

  it("no fit: when the account cannot cover the first batch, the pattern scan still runs and the response says why the AI review did not", async () => {
    // Wave 1c's whole-estimate reservation answered 403 here, pattern scan
    // included, for repos 3.9.1 reviewed.
    mockReserveGithubReviewTokens.mockResolvedValue({
      allowed: false,
      busy: false,
      message:
        "The AI review needs at least 40,000 GitHub review tokens to start and your account has 1 left.",
    });
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
    mockRunGithubAiReview.mockResolvedValue(
      aiRun({ stoppedAtBudget: true, filesReviewed: 0, batchesReviewed: 0 }),
    );

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect(res.status).toBe(200);
    expect(mockRunPatternSecretsScan).toHaveBeenCalledTimes(1);
    // Handed nothing, so it cannot send a single batch.
    expect(mockRunGithubAiReview).toHaveBeenCalledWith(
      expect.anything(),
      5,
      true,
      0,
    );
    expect(mockSettleGithubReviewTokens).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.summary.critical).toBe(1);
    expect(json.aiReviewStoppedAtBudget).toBe(true);
    expect(json.aiReviewCoverage.filesReviewed).toBe(0);
    expect(json.aiReviewAllowanceMessage).toMatch(/needs at least 40,000/);
  });

  it("answers 429 while another review of the same account is running", async () => {
    mockReserveGithubReviewTokens.mockResolvedValue({
      allowed: false,
      busy: true,
      message: "Another GitHub repo review is still running on your account.",
    });

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect(res.status).toBe(429);
    expect(mockRunGithubAiReview).not.toHaveBeenCalled();
  });

  it("settles the reservation with the review's real token count", async () => {
    const held = reservation();
    mockReserveGithubReviewTokens.mockResolvedValue({
      allowed: true,
      reservation: held,
    });
    mockRunGithubAiReview.mockResolvedValue(aiRun({ totalTokensUsed: 12_345 }));

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect(res.status).toBe(200);
    expect(mockSettleGithubReviewTokens).toHaveBeenCalledTimes(1);
    expect(mockSettleGithubReviewTokens).toHaveBeenCalledWith(held, 12_345);
  });

  it("settles zero, giving the whole reservation back, and returns the free trial when the run throws", async () => {
    const held = reservation({ budget: null, isFreeTrial: true });
    mockReserveGithubReviewTokens.mockResolvedValue({
      allowed: true,
      reservation: held,
    });
    mockFetchSelectedFiles.mockRejectedValue(new Error("GitHub 502"));

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect(res.status).toBe(500);
    expect(mockSettleGithubReviewTokens).toHaveBeenCalledWith(held, 0);
    expect(mockReleaseFreeGithubReviewTrial).toHaveBeenCalledWith(5);
  });

  it("still answers when settling fails: the review already ran", async () => {
    mockSettleGithubReviewTokens.mockRejectedValue(new Error("pool exhausted"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect(res.status).toBe(200);
    errors.mockRestore();
  });

  it("says when the budget stopped the review before every file", async () => {
    mockRunGithubAiReview.mockResolvedValue(
      aiRun({ totalTokensUsed: 39_000, stoppedAtBudget: true }),
    );

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect((await res.json()).aiReviewStoppedAtBudget).toBe(true);
  });
});

describe("POST /api/v3/scan/github - notifications", () => {
  it("runs the shared notification tail, reporting a repository target rather than a URL one", async () => {
    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));
    expect(res.status).toBe(200);

    expect(mockNotifyScanComplete).toHaveBeenCalledTimes(1);
    expect(mockNotifyScanComplete.mock.calls[0][0]).toMatchObject({
      userId: 5,
      scanId: 99,
      target: { kind: "repository", value: "octocat/hello-world" },
    });
  });

  it("does not notify when the scan_history row could not be written", async () => {
    mockQuery.mockRejectedValue(new Error("pool exhausted"));

    const res = await POST(postReq({ repoFullName: "octocat/hello-world" }));

    expect(res.status).toBe(200);
    expect(mockNotifyScanComplete).not.toHaveBeenCalled();
  });
});
