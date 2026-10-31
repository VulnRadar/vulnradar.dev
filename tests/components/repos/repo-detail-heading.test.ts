import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A finding's title is the h1 of the view that shows it (IssueDetail), and
 * the other result pages drop their own header when one is open. The repo
 * detail view keeps its header on screen, because that row holds the back
 * button and the rescan action, so /repos showed two h1s while a finding was
 * open. The repo name is demoted to a paragraph for exactly that long.
 *
 * Source-text assertions: the suite runs under `node` with no DOM.
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("repo detail headings", () => {
  const src = code("components/repos/repo-detail.tsx");
  const issueDetail = code("components/scanner/issue-detail.tsx");

  it("the finding view really does carry its own h1", () => {
    expect(issueDetail.match(/<h1\b/g)).toHaveLength(1);
  });

  it("renders the repo name as an h1 only when no finding is open", () => {
    expect(src.match(/<h1\b/g)).toHaveLength(1);
    const branch = src.match(
      /\{selectedIssue \? \(\s*<p\b[\s\S]*?<\/p>\s*\) : \(\s*<h1\b[\s\S]*?<\/h1>\s*\)\}/,
    );
    expect(
      branch,
      "the h1 must sit in the selectedIssue ternary",
    ).not.toBeNull();
    expect(branch![0]).toContain("{repo.fullName}");
  });

  it("keeps the demoted name looking like the title", () => {
    const [paragraph, heading] = [
      src.match(/<p\s+title=\{repo\.fullName\}\s+className="([^"]+)"/),
      src.match(/<h1\s+title=\{repo\.fullName\}\s+className="([^"]+)"/),
    ];
    expect(paragraph).not.toBeNull();
    expect(heading).not.toBeNull();
    expect(paragraph![1]).toBe(heading![1]);
  });
});
