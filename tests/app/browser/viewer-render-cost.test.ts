import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What re-renders the live browser viewer, and how often.
 *
 * The page held `now` as state and ticked it every second. That one number
 * drove the clock in the top bar and two effects that compared it against the
 * session's deadlines, so the whole viewer (header, the iframe's wrapper and
 * every row of the network dock, a few hundred of them on a busy page)
 * rendered sixty times a minute to move a clock. The clock now ticks inside
 * its own component, the deadlines run off one timeout, and the rows are
 * memoised on what they draw.
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

const PAGE = "app/browser/[id]/page.tsx";

describe("the viewer page", () => {
  const src = code(PAGE);

  it("holds no clock state and runs no interval of its own for the countdown", () => {
    expect(src).not.toMatch(/\[now,\s*setNow\]/);
    expect(src).not.toContain("setNow(");
    // The network dock's poll is the one interval left on this page.
    expect(src.match(/setInterval\(/g)).toHaveLength(1);
    expect(src).toContain("setInterval(fetchLogs, LOGS_POLL_MS)");
  });

  it("ends the session off one timeout for the earlier of the two deadlines", () => {
    expect(src).toContain(
      "earliestDeadline([virtualExpiresAt, providerExpiresMs])",
    );
    expect(src).toContain("onDeadline(deadline, () => void endSession())");
    // Neither of the old per-second comparisons survives.
    expect(src).not.toMatch(/now\s*>=\s*virtualExpiresAt/);
    expect(src).not.toMatch(/now\s*>=\s*expiresMs/);
  });

  it("hands the countdown to SessionCountdown", () => {
    expect(src).toContain("<SessionCountdown");
    expect(src).toContain("expiresAt={virtualExpiresAt}");
    expect(src).not.toContain("expiresCritical");
    expect(src).not.toContain("expiresSoon");
    expect(src).not.toContain("formatMmSs");
  });

  it("draws the network rows through the memoised row", () => {
    expect(src).toContain(
      "<NetworkRequestRow key={req.requestId} req={req} />",
    );
    expect(src).not.toContain("resourceType(");
    expect(src).not.toContain("methodColor(");
    expect(src).not.toContain("statusColor(");
  });

  it("keeps the dismiss button's enlarged hit area", () => {
    // tests/components/shared/mobile-layout-invariants.test.ts pins this too.
    expect(src).toMatch(/after:absolute after:-inset-[\d.]+/);
  });
});

describe("SessionCountdown", () => {
  const src = code("components/browser/session-countdown.tsx");

  it("owns the once-a-second tick", () => {
    expect(src).toContain("setInterval(() => setNow(Date.now()), 1000)");
    expect(src).toContain("clearInterval(id)");
  });

  it("is display only: it never ends the session", () => {
    expect(src).not.toContain("endSession");
    expect(src).not.toContain("fetch(");
  });

  it("keeps the extend button's accessible name and limits", () => {
    expect(src).toContain('aria-label="Extend session by 1 minute"');
    expect(src).toContain("disabled={!canExtend}");
    expect(src).toContain('aria-live="polite"');
  });

  it("keeps the 60 and 20 second warning thresholds", () => {
    expect(src).toContain("remaining <= 60");
    expect(src).toContain("remaining <= 20");
  });
});

describe("NetworkRequestRow", () => {
  const src = code("components/browser/network-request-row.tsx");

  it("is memoised on what the row draws, not on object identity", () => {
    expect(src).toContain("memo(NetworkRequestRowImpl");
    expect(src).toContain("sameRequest(prev.req, next.req)");
  });

  it("keeps its class helpers where Tailwind scans for classes", () => {
    // tailwind.config.mjs does not scan lib/, and a class that appears nowhere
    // it does generates no CSS.
    expect(src).toContain('"text-[hsl(var(--success))]"');
    expect(src).toContain('"text-muted-foreground/40"');
    expect(code("lib/browserbase/viewer-session.ts")).not.toMatch(
      /text-\[hsl|text-muted-foreground|text-destructive/,
    );
  });
});
