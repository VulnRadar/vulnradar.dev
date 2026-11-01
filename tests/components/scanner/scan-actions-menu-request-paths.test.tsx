import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The scan actions menu is handed a scan id by every page that shows a report,
 * and /history hands it the one it read from ?scan=. Each owner action
 * (share, public listing, share expiry, teams, visibility, AI summary, delete)
 * put that id straight into `${API.HISTORY}/${scanId}...`, so a crafted id with
 * dot segments pointed the click at a different API route with the user's
 * cookie. The menu now validates the prop once and builds every per-scan path
 * through historyItemPath, which encodes it.
 *
 * Source-text assertions, like the rest of tests/components: tsconfig keeps
 * `jsx: preserve`, so a .tsx component cannot be imported into a test.
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MENU = "components/scanner/scan-actions-menu.tsx";

describe("the scan actions menu's request paths", () => {
  const src = code(MENU);

  it("validates the scanId prop before anything uses it", () => {
    expect(src).toMatch(/scanId:\s*scanIdProp,/);
    expect(src).toMatch(/const scanId = parseScanId\(scanIdProp\);/);
    expect(src.match(/\bscanIdProp\b/g)?.length).toBe(2);
  });

  it("never interpolates an id into a history path by hand", () => {
    expect(src).not.toMatch(/\$\{API\.HISTORY\}\//);
  });

  it.each([
    ["the team picker's read", /fetch\(historyItemPath\(scanId\)\)/],
    ["create share", /historyItemPath\(scanId, "\/share"\)/],
    ["public listing", /historyItemPath\(scanId, "\/share\/publicly-listed"\)/],
    ["AI summary", /historyItemPath\(scanId, "\/summary"\)/],
    ["delete", /apiDelete\(historyItemPath\(scanId, "\/delete"\)\)/],
  ])("builds %s through historyItemPath", (_label, pattern) => {
    expect(src).toMatch(pattern);
  });

  it("builds the two PATCHes (teams, visibility) through historyItemPath", () => {
    const patches = src.match(
      /fetch\(historyItemPath\(scanId\), \{\s*method: "PATCH"/g,
    );
    expect(patches?.length).toBe(2);
  });
});
