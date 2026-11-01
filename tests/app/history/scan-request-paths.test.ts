import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getQueryParam } from "@/lib/ui/url-state";
import { API } from "@/lib/config/client-constants";
import { parseScanId } from "@/lib/history/scan-id";

/**
 * /history?scan=<id> opens a scan, and the page builds its requests for that
 * scan from the id. It took the raw query value, so
 * /history?scan=..%2Fkeys%2F5%2Frevoke%3F made the load-time GET, and the
 * notes PATCH after it, go to /api/v3/keys/5/revoke with the reader's cookie.
 * The id is now validated where it leaves the URL and every per-scan path is
 * built by historyItemPath, which encodes it.
 *
 * Source-text assertions for the page, like the rest of tests/app: tsconfig
 * keeps `jsx: preserve`, so a .tsx page cannot be imported into a test.
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PAGE = "app/history/page.tsx";
const ATTACK = "?scan=..%2Fkeys%2F5%2Frevoke%3F";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/history?scan=", () => {
  it("is what the attack link hands the page", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/history", search: ATTACK, hash: "" },
    });
    const raw = getQueryParam("scan");
    expect(raw).toBe("../keys/5/revoke?");
    expect(new URL(`${API.HISTORY}/${raw}`, "https://x.test").pathname).toMatch(
      /^\/api\/v\d+\/keys\/5\/revoke$/,
    );
    expect(parseScanId(raw)).toBeNull();
  });

  it("is read through parseScanId and never used raw", () => {
    const src = code(PAGE);
    expect(src).toMatch(/parseScanId\(\s*getQueryParam\(\s*"scan"\s*\)\s*\)/);
    expect(src).not.toMatch(/=\s*getQueryParam\(\s*"scan"\s*\)\s*;/);
  });

  it("keeps selectedScanId typed as a validated id", () => {
    expect(code(PAGE)).toMatch(
      /useState<ScanId \| null>\(null\);\s*\n?\s*const \[scanNumericId/,
    );
  });

  it("builds every per-scan request path through historyItemPath", () => {
    const src = code(PAGE);
    expect(src).not.toMatch(/\$\{API\.HISTORY\}\//);
    // loadScanDetail, handleVerdictChanged and handleSaveNotes.
    expect(src.match(/historyItemPath\(/g)?.length ?? 0).toBeGreaterThanOrEqual(
      3,
    );
  });
});
