import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  aiReviewNotice,
  aiReviewStatValue,
  historyAiReviewNotice,
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

describe("aiReviewNotice: files skipped for the per-run cap, and failures before a stop (owner decision D20, 2026-11-07)", () => {
  function cov(extra: Record<string, unknown>) {
    return {
      aiReviewCoverage: {
        filesReviewed: 38,
        filesTotal: 40,
        batchesReviewed: 3,
        batchesFailed: 0,
        batchesTotal: 5,
        filesSkippedOverRunCap: [],
        ...extra,
      },
    };
  }

  it("lists a file skipped for being over the per-run limit on its own, and does not call the rest stopped", () => {
    const n = aiReviewNotice(
      outcome(
        cov({ filesReviewed: 39, filesSkippedOverRunCap: ["data/huge.json"] }),
      ),
    );
    expect(n?.kind).toBe("partial");
    expect(n?.title).toBe("AI review covered 39 of 40 files");
    expect(text(n)).toMatch(
      /data\/huge\.json is larger than this server's per-run AI review limit on its own and was skipped/,
    );
    expect(text(n)).toMatch(/1 file got no AI review/);
    expect(text(n)).not.toMatch(/error or timed out/);
    expect(text(n)).not.toMatch(/rest of the repo/);
  });

  it("names several skipped files and counts the ones it does not name", () => {
    const n = aiReviewNotice(
      outcome(
        cov({
          filesReviewed: 35,
          filesSkippedOverRunCap: [
            "a.json",
            "b.json",
            "c.json",
            "d.json",
            "e.json",
          ],
        }),
      ),
    );
    expect(text(n)).toMatch(
      /5 files are each larger than this server's per-run AI review limit on their own and were skipped \(a\.json, b\.json, c\.json and 2 more\)/,
    );
  });

  it("first batch failed, then the allowance stopped it: says both, and not that the first batch was over a limit", () => {
    const n = aiReviewNotice(
      outcome({
        aiReviewStoppedAtBudget: true,
        ...cov({ filesReviewed: 0, batchesReviewed: 0, batchesFailed: 1 }),
      }),
    );
    expect(n?.kind).toBe("failed");
    expect(text(n)).toMatch(
      /The AI provider returned an error or timed out on 1 batch, and your GitHub review allowance ran out before the rest of the repo, so no file got an AI review/,
    );
    expect(text(n)).not.toMatch(/did not cover the first batch/);
  });

  it("first batch failed, then the per-run limit stopped it: says both, and not that the first batch was over the limit", () => {
    const n = aiReviewNotice(
      outcome({
        aiReviewStoppedAtRunCap: true,
        ...cov({ filesReviewed: 0, batchesReviewed: 0, batchesFailed: 1 }),
      }),
    );
    expect(n?.kind).toBe("failed");
    expect(text(n)).toMatch(
      /error or timed out on 1 batch, and the rest of the repo is over this server's per-run AI review limit/,
    );
    expect(text(n)).not.toMatch(/first batch of files is over/);
  });

  it("a skipped file, a failed batch and a stop together", () => {
    const n = aiReviewNotice(
      outcome({
        aiReviewStoppedAtRunCap: true,
        ...cov({
          filesReviewed: 20,
          batchesReviewed: 2,
          batchesFailed: 2,
          filesSkippedOverRunCap: ["data/huge.json"],
        }),
      }),
    );
    expect(n?.title).toBe("AI review covered 20 of 40 files");
    const t = text(n);
    expect(t).toMatch(/data\/huge\.json is larger/);
    expect(t).toMatch(/error or timed out on 2 batches/);
    expect(t).toMatch(/rest of the repo is over this server's per-run/);
    expect(t).toMatch(/20 files got no AI review/);
    expect(t).not.toMatch(/[—–·]/);
  });
});

describe("a repo scan reopened from history (owner decision D20, 2026-11-07)", () => {
  it("shows the same notice as the live result, from what the route stored", () => {
    const live = {
      ...BASE,
      aiReviewStoppedAtBudget: true,
      aiReviewCoverage: {
        filesReviewed: 12,
        filesTotal: 40,
        batchesReviewed: 1,
        batchesFailed: 1,
        batchesTotal: 4,
        filesSkippedOverRunCap: ["data/huge.json"],
      },
    };
    // GET /api/v3/history/[id] spreads scan_history.result_meta over the row,
    // and the route stores these keys there.
    const reopened = {
      id: 7,
      url: live.url,
      scannedAt: live.scannedAt,
      duration: live.duration,
      summary: live.summary,
      findings: live.findings,
      notes: "",
      tags: [],
      filesScanned: live.filesScanned,
      filesSkippedByCaps: live.filesSkippedByCaps,
      aiReviewSkipped: live.aiReviewSkipped,
      aiReviewStoppedAtBudget: live.aiReviewStoppedAtBudget,
      aiReviewStoppedAtRunCap: live.aiReviewStoppedAtRunCap,
      aiReviewCoverage: live.aiReviewCoverage,
    };

    const fromLive = aiReviewNotice(parseGithubScanResponse(live));
    const fromHistory = historyAiReviewNotice(reopened);

    expect(fromLive).not.toBeNull();
    expect(fromHistory).toEqual(fromLive);
  });

  it("a scan stored before coverage was kept shows no notice rather than a wrong one", () => {
    expect(
      historyAiReviewNotice({
        url: "octocat/hello-world",
        summary: BASE.summary,
        findings: [],
      }),
    ).toBeNull();
  });

  it("the repo page loads that notice when it opens a past scan", () => {
    const detail = fs
      .readFileSync(
        path.resolve(__dirname, "../../../components/repos/repo-detail.tsx"),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const load = detail.slice(detail.indexOf("const loadScanDetail"));
    expect(load).toMatch(/historyAiReviewNotice\(data\)/);
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
    expect(detail).toMatch(/scanNotice\.scanId === selectedScanId/);
  });

  it("does not claim the AI review ran clean when it did not cover every file", () => {
    expect(src).toMatch(
      /let detail = notice\s*\?\s*"Pattern-based secret detection found nothing, and the AI review did not cover every file\."/,
    );
  });
});
