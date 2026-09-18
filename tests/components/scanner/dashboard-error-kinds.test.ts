import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Three different refusals arrive as HTTP 429 and only one of them is about
 * the caller's plan:
 *
 *   DAILY_LIMIT           your plan's scans for the day are spent. Upgrading
 *                         raises it, so offering that is correct.
 *   TARGET_RATE_LIMIT     that ADDRESS has been scanned too often in the last
 *                         hour, counted across every account, to protect the
 *                         site being scanned. Upgrading changes nothing.
 *   CONCURRENT_SCAN_LIMIT your own scans are all busy. Waiting a minute fixes
 *                         it; paying does not make it finish sooner.
 *
 * The failure screen collapsed all three into one, and its copy said a higher
 * plan raises the cap. So a free user who hit the shared limiter, which is the
 * one they are most likely to hit, was told in the headline to buy something
 * that could not help. That is the failure mode worth a test: not a crash, a
 * sentence that costs somebody money.
 *
 * This reads the source rather than rendering, because the classifier and its
 * copy table are module-private by design; what has to hold is that the three
 * codes are distinguished and that only the plan one mentions upgrading.
 */
const SRC = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "components/scanner/dashboard-error-state.tsx",
  ),
  "utf8",
);

describe("scan failure screen: 429s are not one thing", () => {
  it("classifies the shared per-target limiter separately", () => {
    expect(SRC).toContain("TARGET_RATE_LIMIT");
    expect(SRC).toContain("target_busy");
  });

  it("classifies the concurrency cap separately", () => {
    expect(SRC).toContain("CONCURRENT_SCAN_LIMIT");
    expect(SRC).toContain("too_many_running");
  });

  it("never offers an upgrade for a limit an upgrade cannot raise", () => {
    // The copy for each kind, as written in ERROR_META.
    const entry = (kind: string) => {
      const at = SRC.indexOf(`  ${kind}: {`);
      expect(at, `${kind} missing from ERROR_META`).toBeGreaterThan(-1);
      return SRC.slice(at, SRC.indexOf("\n  },", at));
    };

    // An OFFER, not a mention: the target copy is allowed to say a higher plan
    // does not change this one, which is the useful thing to tell someone.
    const offersUpgrade =
      /raises the (?:cap|limit)|upgrade (?:to|for)|a higher plan (?:raises|gets|gives)/i;
    expect(offersUpgrade.test(entry("target_busy"))).toBe(false);
    expect(offersUpgrade.test(entry("too_many_running"))).toBe(false);
    // And the one that genuinely has an upgrade path still offers it.
    expect(offersUpgrade.test(entry("rate_limit"))).toBe(true);
  });

  it("tells the reader the shared limiter is not theirs", () => {
    const copy = SRC.slice(
      SRC.indexOf("  target_busy: {"),
      SRC.indexOf("\n  },", SRC.indexOf("  target_busy: {")),
    );
    expect(copy).toMatch(/not your limit/i);
  });
});
