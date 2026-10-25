/**
 * The dashboard page's scan flow, pinned from its source.
 *
 * app/dashboard/page.tsx is one client component that owns the whole console,
 * and vitest here runs `node` with no DOM, so it cannot be mounted. What can go
 * wrong in it without any test noticing is a contract between lines: a wait
 * that stopped reading the config, a give-up that went back to drawing the
 * failure screen. Each assertion below is the shape of a bug that shipped, and
 * the logic they lean on (maxWaitMs, the poll errors, the grant) has its own
 * behavioural suite beside this one.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const PAGE = read("app/dashboard/page.tsx");

describe("how long the dashboard waits for a scan", () => {
  it("derives the wait from the live server budgets, not a literal", () => {
    // Two literals (6 and 16 minutes) sat next to a comment about 300s and
    // 900s watchdogs. SCAN_TIMEOUT_SECONDS and CRAWL_SCAN_TIMEOUT_SECONDS are
    // admin-editable, so raising either made this page call a scan that was
    // still inside its budget failed.
    expect(PAGE).not.toMatch(/SCAN_MAX_WAIT_MS|CRAWL_MAX_WAIT_MS/);
    expect(PAGE).toMatch(
      /maxWaitMs\(\s*isCrawl \? crawlScanTimeoutSeconds : scanTimeoutSeconds\s*\)/,
    );
  });

  it("reads both budgets from the client config", () => {
    expect(PAGE).toMatch(/scanTimeoutSeconds,\s*crawlScanTimeoutSeconds/);
    expect(PAGE).toContain("useClientConfig()");
  });

  it("answers a client that stopped waiting with the still-running state", () => {
    // PollGaveUpError means this page stopped watching, not that the scan
    // failed. Drawing "The scan did not finish" over a crawl that then
    // completes in History reads as a scan that was wrongly marked failed.
    const branch = PAGE.slice(PAGE.indexOf("instanceof PollGaveUpError"));
    expect(branch.slice(0, 400)).toContain(
      'setErrorForcedKind("still_running")',
    );
  });
});

describe("what the dashboard writes after a scan", () => {
  it("does not PATCH the default note back onto a row that already has it", () => {
    // Every insert path writes DEFAULT_SCAN_NOTE itself (the single scan, the
    // crawl tracker row, bulk, GitHub, the scheduled worker). The PATCH cost
    // an authenticated request, about four queries and a fresh tuple on
    // scan_history right after the completion write, and on the reload path it
    // could overwrite a note the user had edited in History in the meantime.
    expect(PAGE).not.toMatch(/notes:\s*DEFAULT_SCAN_NOTE/);
  });

  it("still seeds the notes editor locally", () => {
    expect(PAGE).toContain("setScanNotes(DEFAULT_SCAN_NOTE)");
  });
});

describe("a /dashboard?scan=<url> link", () => {
  it("starts a scan only through the grant", () => {
    // 21482aef widened the old effect to any state but running, and it called
    // handleScan on any URL-looking param with no click. The only call the
    // effect may make now is the one scanParamToStart returns.
    expect(PAGE).toMatch(
      /scanParamToStart\(\s*searchParams\.get\("scan"\),\s*status === "scanning",\s*consumeScanAgain,?\s*\)/,
    );
    const effectAt = PAGE.indexOf("scanParamToStart(");
    const effect = PAGE.slice(
      effectAt,
      PAGE.indexOf("[searchParams]", effectAt),
    );
    expect(effect.match(/handleScan\(/g)).toHaveLength(1);
    expect(effect).toMatch(
      /if \(scanUrl\) \{[^}]*handleScan\(\{ url: scanUrl/s,
    );
  });

  it("hands the form the target to show", () => {
    expect(PAGE).toContain(
      'initialUrl={scanParamPrefill(searchParams.get("scan"))}',
    );
    const form = read("components/scanner/scan-form.tsx");
    expect(form).toContain("initialUrl?: string;");
    expect(form).toContain('useState(initialUrl ?? "")');
  });

  it("is armed by the controls that ask for a scan on purpose", () => {
    // Each of these navigates to /dashboard?scan= after the person clicked it.
    // Dropping the arm call would turn them into links that only prefill.
    const menu = read("components/scanner/scan-actions-menu.tsx");
    const again = menu.slice(menu.indexOf('key: "scan-again"'));
    expect(again.indexOf("armScanAgain(result.url)")).toBeGreaterThan(-1);
    expect(again.indexOf("armScanAgain(result.url)")).toBeLessThan(
      again.indexOf("router.push("),
    );

    const subdomains = read("components/scanner/subdomain-discovery.tsx");
    const row = subdomains.slice(
      subdomains.indexOf("function handleScanClick"),
    );
    expect(row.indexOf("armScanAgain(sub.url)")).toBeGreaterThan(-1);
    expect(row.indexOf("armScanAgain(sub.url)")).toBeLessThan(
      row.indexOf("router.push("),
    );
  });

  it("is the only caller of the arm function", () => {
    // A third caller is a third way for a link to become a click.
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), {
        withFileTypes: true,
      })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (
          /\.tsx?$/.test(entry.name) &&
          read(rel).includes("armScanAgain(")
        ) {
          callers.push(rel);
        }
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(dir);
    expect(callers.sort()).toEqual([
      "components/scanner/scan-actions-menu.tsx",
      "components/scanner/subdomain-discovery.tsx",
      "lib/ui/scan-again.ts",
    ]);
  });
});
