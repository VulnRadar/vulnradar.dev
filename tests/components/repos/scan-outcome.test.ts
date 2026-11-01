import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  aiReviewNotice,
  aiReviewStatValue,
  parseGithubScanResponse,
} from "@/components/repos/scan-outcome";

/**
 * A repo too large for the account's AI allowance, or for the server's
 * per-run limit, is partly AI-reviewed instead of refused. The result has to
 * say so every time, above the findings, and never read as a complete AI
 * review; and it has to say the pattern scan covered every file, because it
 * did.
 */

const BASE = {
  summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
  findings: [],
  url: "octocat/hello-world",
  scannedAt: "2026-11-01T00:00:00.000Z",
  duration: 10,
  scanHistoryId: 7,
  ref: "main",
  filesScanned: 40,
  filesSkippedByCaps: 0,
  aiTokensUsed: 51_000,
  aiReviewSkipped: false,
  aiReviewStoppedAtBudget: false,
  aiReviewStoppedAtRunCap: false,
  aiReviewCoverage: {
    filesReviewed: 40,
    filesTotal: 40,
    batchesReviewed: 4,
    batchesTotal: 4,
  },
  aiReviewAllowanceMessage: null,
};

function outcome(overrides: Record<string, unknown> = {}) {
  return parseGithubScanResponse({ ...BASE, ...overrides });
}

function coverage(filesReviewed: number, batchesReviewed = 1) {
  return {
    aiReviewCoverage: {
      filesReviewed,
      filesTotal: 40,
      batchesReviewed,
      batchesTotal: 4,
    },
  };
}

function text(n: ReturnType<typeof aiReviewNotice>): string {
  return n ? [n.title, ...n.paragraphs].join(" ") : "";
}

describe("parseGithubScanResponse", () => {
  it("keeps the ScanResult apart from the GitHub extras", () => {
    const o = outcome();
    expect(o.result.url).toBe("octocat/hello-world");
    expect(o.result).not.toHaveProperty("aiReviewCoverage");
    expect(o.scanHistoryId).toBe(7);
    expect(o.aiReviewCoverage?.filesReviewed).toBe(40);
  });

  it("reads a response from a server that predates the coverage fields", () => {
    const {
      aiReviewStoppedAtRunCap: _a,
      aiReviewCoverage: _b,
      aiReviewAllowanceMessage: _c,
      ...old
    } = BASE;
    const o = parseGithubScanResponse(old);
    expect(o.aiReviewCoverage).toBeNull();
    expect(o.aiReviewStoppedAtRunCap).toBe(false);
    expect(o.aiReviewAllowanceMessage).toBeNull();
    expect(aiReviewNotice(o)).toBeNull();
  });
});

describe("aiReviewNotice", () => {
  it("says nothing when the AI review covered every file", () => {
    const o = outcome();
    expect(aiReviewNotice(o)).toBeNull();
    expect(aiReviewStatValue(o, null)).toBe("51,000 tokens");
  });

  it("partial fit: says how many files the AI review covered and that the pattern scan covered all", () => {
    const o = outcome({ aiReviewStoppedAtBudget: true, ...coverage(12) });
    const n = aiReviewNotice(o);

    expect(n?.kind).toBe("partial");
    expect(n?.title).toBe("AI review covered 12 of 40 files");
    expect(text(n)).toMatch(/allowance ran out/);
    expect(text(n)).toMatch(/28 files got no AI review/);
    expect(text(n)).toMatch(/partial review/);
    expect(text(n)).toMatch(/pattern-based secret scan still checked all 40/);
    expect(aiReviewStatValue(o, n)).toBe("12 of 40 files");
  });

  it("no fit: says the AI review did not run, why, and what the account can do", () => {
    const o = outcome({
      aiReviewStoppedAtBudget: true,
      ...coverage(0, 0),
      aiTokensUsed: 0,
      aiReviewAllowanceMessage:
        "The AI review needs at least 56,000 GitHub review tokens to start on this repo and your credit balance is 1.",
    });
    const n = aiReviewNotice(o);

    expect(n?.kind).toBe("not_run");
    expect(n?.title).toBe("AI review did not run");
    expect(text(n)).toMatch(/allowance did not cover the first batch/);
    expect(text(n)).toMatch(/checked all 40 files/);
    expect(text(n)).toMatch(/needs at least 56,000/);
    expect(aiReviewStatValue(o, n)).toBe("Not run");
  });

  it("names the server's per-run limit when that is what stopped it", () => {
    const partial = aiReviewNotice(
      outcome({ aiReviewStoppedAtRunCap: true, ...coverage(30, 3) }),
    );
    expect(partial?.title).toBe("AI review covered 30 of 40 files");
    expect(text(partial)).toMatch(/per-run AI review limit/);
    expect(text(partial)).not.toMatch(/allowance/);

    const none = aiReviewNotice(
      outcome({ aiReviewStoppedAtRunCap: true, ...coverage(0, 0) }),
    );
    expect(none?.kind).toBe("not_run");
    expect(text(none)).toMatch(/first batch of files is over/);
  });

  it("does not present a review the provider failed on part of as complete", () => {
    const o = outcome(coverage(30, 3));
    const n = aiReviewNotice(o);
    expect(n?.title).toBe("AI review covered 30 of 40 files");
    expect(text(n)).toMatch(/error or timed out/);

    const all = aiReviewNotice(outcome(coverage(0, 0)));
    expect(all?.kind).toBe("failed");
    expect(aiReviewStatValue(outcome(coverage(0, 0)), all)).toBe("Failed");
  });

  it("covers the no-endpoint case the old footnote did", () => {
    const o = outcome({ aiReviewSkipped: true, ...coverage(0, 0) });
    const n = aiReviewNotice(o);
    expect(n?.kind).toBe("skipped");
    expect(text(n)).toMatch(/No AI provider is configured/);
    expect(aiReviewStatValue(o, n)).toBe("Skipped");
  });

  it("still warns when an older server only says it stopped at the budget", () => {
    const o = outcome({
      aiReviewStoppedAtBudget: true,
      aiReviewCoverage: null,
    });
    const n = aiReviewNotice(o);
    expect(n?.title).toBe("AI review stopped early");
    expect(aiReviewStatValue(o, n)).toBe("Partial");
  });

  it("writes one file in the singular", () => {
    const n = aiReviewNotice(
      outcome({
        filesScanned: 1,
        aiReviewStoppedAtBudget: true,
        aiReviewCoverage: {
          filesReviewed: 0,
          filesTotal: 1,
          batchesReviewed: 0,
          batchesTotal: 1,
        },
      }),
    );
    expect(text(n)).toMatch(/still checked the one file/);
  });

  it("never uses an em dash, en dash or middle dot in its copy", () => {
    const cases = [
      outcome({ aiReviewStoppedAtBudget: true, ...coverage(12) }),
      outcome({ aiReviewStoppedAtBudget: true, ...coverage(0, 0) }),
      outcome({ aiReviewStoppedAtRunCap: true, ...coverage(12) }),
      outcome({ aiReviewStoppedAtRunCap: true, ...coverage(0, 0) }),
      outcome(coverage(12)),
      outcome(coverage(0, 0)),
      outcome({ aiReviewSkipped: true }),
    ];
    for (const o of cases) expect(text(aiReviewNotice(o))).not.toMatch(/[—–·]/);
  });
});

describe("the result modal", () => {
  const src = fs
    .readFileSync(
      path.resolve(
        __dirname,
        "../../../components/repos/github-scan-result-modal.tsx",
      ),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("renders the notice with InlineAlert, above the findings summary", () => {
    const alert = src.indexOf("<InlineAlert");
    const distribution = src.indexOf("<SeverityDistribution");
    const stats = src.indexOf('label="Files scanned"');
    expect(alert).toBeGreaterThan(-1);
    expect(alert).toBeLessThan(distribution);
    expect(alert).toBeLessThan(stats);
    expect(src).toMatch(/notice && \(/);
  });

  it("the repo page shows the same notice above the fresh scan's findings once the modal is closed", () => {
    const detail = fs
      .readFileSync(
        path.resolve(__dirname, "../../../components/repos/repo-detail.tsx"),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const alert = detail.indexOf("<InlineAlert");
    expect(alert).toBeGreaterThan(-1);
    expect(alert).toBeLessThan(detail.indexOf("<ScanSummary"));
    expect(alert).toBeLessThan(detail.indexOf("<ResultsList"));
    expect(detail).toMatch(/aiReviewNotice\(outcome\)/);
    expect(detail).toMatch(/freshNotice\.scanId === selectedScanId/);
  });

  it("does not claim the AI review ran clean when it did not cover every file", () => {
    expect(src).toMatch(
      /let detail = notice\s*\?\s*"Pattern-based secret detection found nothing, and the AI review did not cover every file\."/,
    );
  });
});
