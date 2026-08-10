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
    const aws = findings.find(
      (f) =>
        f.id.startsWith("hardcoded-secrets--") ||
        f.id.startsWith("secret-aws-access-key-id--"),
    );
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

  it("does not flag a .env.example whose values are all placeholders", () => {
    const files = [
      {
        path: ".env.example",
        content: [
          "AWS_ACCESS_KEY_ID=your_key_here",
          "DATABASE_URL=postgres://user:password@localhost:5432/dbname",
          "STRIPE_SECRET_KEY=changeme",
        ].join("\n"),
      },
    ];
    expect(runPatternSecretsScan(files)).toEqual([]);
  });

  it("redacts a real-looking secret when its value carries an obvious placeholder marker in a .env file", () => {
    // "fake_" isn't part of hardcoded-secrets' own built-in filter list
    // (your_/example/xxxx/0000/placeholder/test_/dummy/localhost), so
    // without the new .env-aware redaction this AKIA-shaped value would
    // still be flagged -- this isolates the new behavior from filtering
    // secrets-extended.ts already did on its own.
    const files = [
      {
        path: ".env.example",
        content: "AWS_ACCESS_KEY_ID=fake_AKIAABCDEFGHIJKLMNOP",
      },
    ];
    expect(runPatternSecretsScan(files)).toEqual([]);
  });

  it("still flags a real-looking credential inside a .env file", () => {
    const files = [
      { path: ".env", content: "AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP" },
    ];
    const findings = runPatternSecretsScan(files);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.location?.file === ".env")).toBe(true);
  });

  it("only applies placeholder redaction to .env-family filenames, not other files", () => {
    // Same "fake_"-prefixed AKIA value as the redaction test above, but in
    // a non-.env file -- proves the redaction is scoped to dotenv-style
    // filenames, not applied to every file's KEY=VALUE-shaped lines.
    const files = [
      { path: "config.ts", content: "const k = 'fake_AKIAABCDEFGHIJKLMNOP';" },
    ];
    expect(runPatternSecretsScan(files).length).toBeGreaterThan(0);
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
    const entries: GithubTreeEntry[] = [
      { path: "bin.dat", type: "blob", sha: "sha-x" },
    ];
    const files = await fetchSelectedFiles("tok", "owner", "repo", entries);
    expect(files).toEqual([]);
  });
});
