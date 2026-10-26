import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * /repos used to open with a waterfall: the connection status, then (only once
 * that landed) a listing of every repo the account can see, up to three serial
 * pages with no timeout, which the page filtered down to the names the status
 * had already given it, alongside the scan history. It loads in two parallel
 * requests now, and lists every repo only when the picker opens.
 *
 * Source-text assertions: this tier has no DOM to drive the page with, but the
 * request shape is plain in the source.
 */

const ROOT = path.resolve(__dirname, "../../..");
const page = readFileSync(path.join(ROOT, "app/repos/page.tsx"), "utf8");
const picker = readFileSync(
  path.join(ROOT, "components/repos/github-repo-picker-modal.tsx"),
  "utf8",
);

describe("app/repos/page.tsx loading", () => {
  it("asks the status endpoint for the selected repos in the same request", () => {
    expect(page).toContain("${API.ACCOUNT_GITHUB}?include=selected-repos");
  });

  it("never lists every repo itself: the picker is the only reader of the full list", () => {
    // The one use left in the page is the PUT that saves a selection.
    const uses = [...page.matchAll(/API\.ACCOUNT_GITHUB_REPOS/g)];
    expect(uses).toHaveLength(1);
    const after = page.slice(uses[0].index!, uses[0].index! + 60);
    expect(after).toMatch(/method: "PUT"/);
    // And the modal, which opens on demand, still fetches the full list.
    expect(picker).toContain("fetch(API.ACCOUNT_GITHUB_REPOS)");
  });

  it("starts the scan history before waiting for the status", () => {
    const init = page.slice(page.indexOf("const init = useCallback"));
    const history = init.indexOf("fetchSummaries()");
    const status = init.indexOf("await fetch(");
    expect(history).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(-1);
    expect(history).toBeLessThan(status);
  });

  it("does not leave the removed per-repo loading path behind", () => {
    expect(page).not.toContain("loadWorkingSet");
    expect(page).not.toContain("reposLoading");
    expect(page).not.toContain("Loader2");
  });

  it("shows a working-set failure as a load error, never as an empty selection", () => {
    // `repos` stays null on failure, which is what keeps "No repos selected
    // yet" from rendering under a banner saying it is not an empty set.
    expect(page).toContain("data.workingSetError");
    expect(page).toMatch(
      /if \(data\.repos && !data\.workingSetError\) \{\s*setRepos\(data\.repos\);/,
    );
  });
});
