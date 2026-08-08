import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  estimateTokens,
  fetchSelectedFiles,
  runPatternSecretsScan,
} from "@/lib/scanner/github-repo-scan";
import type { GithubTreeEntry } from "@/lib/github/github-api";

const mockGetBlobContent = vi.fn();
vi.mock("@/lib/github/github-api", () => ({
  getBlobContent: (...args: unknown[]) => mockGetBlobContent(...args),
}));

describe("estimateTokens", () => {
  it("estimates roughly 4 chars per token", () => {
    expect(estimateTokens(4000)).toBe(1000);
    expect(estimateTokens(1)).toBe(1); // rounds up, never zero for nonzero input
    expect(estimateTokens(0)).toBe(0);
  });
});

describe("runPatternSecretsScan", () => {
  it("reuses the real secrets-extended detectors against file content", () => {
    const files = [
      { path: "src/config.ts", content: "const key = 'AKIAABCDEFGHIJKLMNOP';" },
    ];
    const findings = runPatternSecretsScan(files);
    expect(findings.length).toBeGreaterThan(0);
    const aws = findings.find((f) => f.id.startsWith("hardcoded-secrets--") || f.id.startsWith("secret-aws-access-key-id--"));
    expect(aws).toBeDefined();
    expect(aws?.location).toEqual({ file: "src/config.ts" });
    expect(aws?.category).toBe("secrets-extended");
  });

  it("returns no findings for clean content", () => {
    const files = [{ path: "src/clean.ts", content: "export const x = 1;" }];
    expect(runPatternSecretsScan(files)).toEqual([]);
  });

  it("scans multiple files independently, tagging each finding with its own file", () => {
    const files = [
      { path: "a.ts", content: "const k = 'AKIAABCDEFGHIJKLMNOP';" },
      { path: "b.ts", content: "export const x = 1;" },
    ];
    const findings = runPatternSecretsScan(files);
    expect(findings.every((f) => f.location?.file === "a.ts")).toBe(true);
  });
});

describe("fetchSelectedFiles", () => {
  beforeEach(() => {
    mockGetBlobContent.mockReset();
  });

  it("fetches content for every selected entry", async () => {
    mockGetBlobContent.mockResolvedValueOnce("file one content");
    mockGetBlobContent.mockResolvedValueOnce("file two content");
    const entries: GithubTreeEntry[] = [
      { path: "a.ts", type: "blob", sha: "sha-a" },
      { path: "b.ts", type: "blob", sha: "sha-b" },
    ];
    const files = await fetchSelectedFiles("tok", "owner", "repo", entries);
    expect(files).toEqual([
      { path: "a.ts", content: "file one content" },
      { path: "b.ts", content: "file two content" },
    ]);
  });

  it("skips a file that fails to fetch rather than failing the whole batch", async () => {
    mockGetBlobContent.mockResolvedValueOnce("ok content");
    mockGetBlobContent.mockRejectedValueOnce(new Error("HTTP 404"));
    const entries: GithubTreeEntry[] = [
      { path: "a.ts", type: "blob", sha: "sha-a" },
      { path: "b.ts", type: "blob", sha: "sha-b" },
    ];
    const files = await fetchSelectedFiles("tok", "owner", "repo", entries);
    expect(files).toEqual([{ path: "a.ts", content: "ok content" }]);
  });

  it("skips a file that comes back undecodable (null content)", async () => {
    mockGetBlobContent.mockResolvedValueOnce(null);
    const entries: GithubTreeEntry[] = [{ path: "bin.dat", type: "blob", sha: "sha-x" }];
    const files = await fetchSelectedFiles("tok", "owner", "repo", entries);
    expect(files).toEqual([]);
  });
});
