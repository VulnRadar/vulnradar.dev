import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The two timers a staff tab runs for as long as it is open.
 *
 * Neither hook can be rendered here (this config runs in node and the repo has
 * no DOM testing library), so this pins the property that matters in the
 * source: they go through useVisibleInterval. lib/hooks/use-visible-interval.ts
 * says every recurring timer in the app used to fire in background tabs and
 * documents the migration; these two were left out, so a forgotten /admin tab
 * cost about eight queries and a directory scan every 45 seconds, and a hidden
 * staff tab kept reporting its owner as active.
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

describe.each([
  ["the admin health poll", "app/admin/page.tsx"],
  ["the staff heartbeat", "lib/hooks/use-admin-heartbeat.ts"],
])("%s", (_name, file) => {
  const source = read(file);

  it("runs through useVisibleInterval", () => {
    expect(source).toContain("useVisibleInterval");
    expect(source).toContain("@/lib/hooks/use-visible-interval");
  });

  it("does not start a raw timer", () => {
    // Comments may name it; code may not call it.
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/\bsetInterval\s*\(/);
  });
});

describe("the admin page's startup requests", () => {
  const page = read("app/admin/page.tsx");

  it("asks the updater for the summary, not the full probe", () => {
    expect(page).toContain("/updater/status?summary=1");
    expect(page).not.toMatch(/updater\/status`/);
  });

  it("does not poll while the forbidden screen is up", () => {
    expect(page).toMatch(/forbidden \? null : HEALTH_POLL_INTERVAL_MS/);
  });
});

describe("the staff heartbeat's request", () => {
  it("goes through the API map, not a literal /api/v3 path", () => {
    const source = read("lib/hooks/use-admin-heartbeat.ts");
    expect(source).toContain("${API.ADMIN}/activity");
    expect(source).not.toMatch(/["'`]\/api\/v3\//);
  });
});

describe("the audit deep link", () => {
  // handleQueryChange re-runs whenever fetchAudit changes identity (a page-size
  // change does it), and it reads ?targetUserId= back. If the param does not
  // follow the chip, clearing the chip and then changing the page size puts it
  // back on.
  it("keeps ?targetUserId= in step with the target chip", () => {
    const page = read("app/admin/page.tsx");
    expect(page).toMatch(/setQueryParam\("targetUserId", wanted/);
  });
});
