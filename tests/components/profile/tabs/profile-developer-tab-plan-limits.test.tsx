/**
 * Plan limits on the profile tabs come from the server's live resolve, never
 * from the plan catalog. The catalog's numbers are the shipped defaults: an
 * admin can change every one of them from Settings, a gift or a staff role
 * changes which plan applies, and the server enforces the live numbers. The
 * Developer tab read its key limit from the catalog and so showed "1/1 active"
 * with Create disabled to accounts the server would have let through, and the
 * reverse.
 *
 * Source-text, as the other profile wiring tests are: the shell needs a whole
 * session to mount, and what matters is where the number is read from.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROFILE_DIR = path.resolve(__dirname, "../../../../components/profile");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Comments name the catalog's limits when they explain this rule. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Every `.limits` read and what it is read from. `billingInfo.limits` is
 * GET /billing's live per-plan daily scans and is the one allowed receiver;
 * anything else (a catalog Plan, `getPlanById(...)?.limits`) is the catalog.
 */
function limitsReads(text: string): string[] {
  const reads: string[] = [];
  for (const match of withoutComments(text).matchAll(
    /([\w$\])]+)\s*\??\.\s*limits\b/g,
  )) {
    if (match[1] !== "billingInfo") reads.push(match[0]);
  }
  return reads;
}

describe("profile tabs read plan limits from the server", () => {
  const files = sourceFiles(PROFILE_DIR);

  it("is looking at the real tree", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.endsWith("profile-developer-tab.tsx"))).toBe(
      true,
    );
  });

  it("has no catalog `.limits` read anywhere under components/profile", () => {
    const offenders = files.flatMap((file) =>
      limitsReads(fs.readFileSync(file, "utf8")).map(
        (read) => `${path.relative(PROFILE_DIR, file)}: ${read}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("would catch the reads it replaced", () => {
    expect(
      limitsReads("const n = getPlanById(effectivePlan)?.limits.apiKeys ?? 1;"),
    ).toHaveLength(1);
    expect(limitsReads("{paidPlan.limits.dailyScans} scans/day")).toHaveLength(
      1,
    );
    expect(limitsReads("{billingInfo.limits[paidPlan.id]}")).toEqual([]);
    expect(limitsReads("// the catalog's plan.limits are defaults")).toEqual(
      [],
    );
  });

  it("takes the Developer tab's key limit from /auth/me's apiKeys", () => {
    const shell = fs.readFileSync(
      path.join(PROFILE_DIR, "tabs/profile-developer-tab.tsx"),
      "utf8",
    );
    expect(shell).toMatch(/const apiKeyLimit = me\?\.apiKeys\b/);
    expect(shell).not.toContain("@/lib/billing/catalog");
  });

  it("prices the billing tab's plan cards from the catalog but counts their scans from /billing", () => {
    const billing = fs.readFileSync(
      path.join(PROFILE_DIR, "tabs/profile-billing-tab.tsx"),
      "utf8",
    );
    expect(billing).toContain("`${billingInfo.limits[paidPlan.id]} scans/day`");
    // A live limit can be -1 (the registry's "unlimited"), which the catalog's
    // numbers never were, so the card must not print "-1 scans/day".
    expect(billing).toMatch(
      /billingInfo\.limits\[paidPlan\.id\] === -1\s*\?\s*"Unlimited scans"/,
    );
  });

  it("does not print -1 scans/day on the current plan line", () => {
    const billing = fs.readFileSync(
      path.join(PROFILE_DIR, "tabs/profile-billing-tab.tsx"),
      "utf8",
    );
    expect(billing).toMatch(/currentPlanScans === -1\s*\?\s*"Unlimited scans"/);
  });
});
