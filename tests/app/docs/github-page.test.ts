import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The GitHub docs page told readers to run a curl that could not work: a
 * placeholder host, a cookie named "session" where the real one is
 * vulnradar_session, and no Origin header on a CSRF-gated POST. It also
 * promised a report link in every filed issue. Source-text assertions, since
 * what is being pinned is the sentence a reader gets.
 */

const ROOT = path.resolve(__dirname, "../../..");
const page = readFileSync(path.join(ROOT, "app/docs/github/page.tsx"), "utf8");
const flat = page.replace(/\s+/g, " ");

describe("docs: GitHub scanning", () => {
  it("has no curl left to copy", () => {
    expect(page).not.toContain("curl -X POST");
    expect(page).not.toContain('--cookie "session=');
    expect(page).not.toContain("your-instance");
  });

  it("walks through the controls the app really has", () => {
    for (const label of [
      "Go to Social settings",
      "Grant repo access",
      "Select repositories",
      "File as GitHub issue",
      "Create issue",
    ]) {
      expect(flat, label).toContain(label);
    }
  });

  it("does not offer a branch field the Scan button does not have", () => {
    const repos = readFileSync(path.join(ROOT, "app/repos/page.tsx"), "utf8");
    // If /repos starts sending a ref, the sentence below has to change with it.
    expect(repos).toContain("body: JSON.stringify({ repoFullName })");
    expect(flat).toContain("always reads the default branch");
  });

  it("says which issues carry a report link", () => {
    expect(flat).toContain("for public URL scans, a link to the host report");
    expect(flat).toContain("Repo scans and private scans carry no report link");
  });

  it("documents the selected-repos read and both timeouts", () => {
    expect(flat).toContain("/account/github?include=selected-repos");
    expect(flat).toContain("workingSetError");
    expect(flat).toMatch(/code: 504/);
    expect(flat).toContain("may have been created");
  });
});
