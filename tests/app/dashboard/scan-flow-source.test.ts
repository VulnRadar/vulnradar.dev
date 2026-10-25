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

const PAGE = fs.readFileSync(
  path.resolve(__dirname, "../../../app/dashboard/page.tsx"),
  "utf8",
);

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
