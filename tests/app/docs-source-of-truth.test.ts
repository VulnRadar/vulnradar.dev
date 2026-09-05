import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { ALL_CATEGORIES } from "@/lib/scanner/types";
import { TEAM_ROLE_PERMISSIONS } from "@/lib/config/client-constants";
import { FRAMEWORKS } from "@/lib/reports/compliance-mappings";
import { WEBSOCKET_CHECK_IDS } from "@/lib/scanner/protocols/websocket";
import { FTP_CHECK_IDS } from "@/lib/scanner/protocols/ftp";
import { SETTINGS_REGISTRY } from "@/lib/config/registry";

/**
 * The docs pages are TSX, so nothing type-checks the sentences in them. What
 * caused this suite: /docs/rate-limits shipped a callout claiming staff
 * accounts have no daily limit, naming three roles, when seven roles resolve
 * to the staff tag and the tag resolves to the Pro Supporter plan's real caps.
 * Nobody noticed because a wrong sentence compiles exactly like a right one.
 *
 * Every case below is a number or a list that exists in code and was ALSO
 * typed out by hand somewhere under app/docs/. The fix in each case was to
 * render the constant; these assertions are what stop the literal coming
 * back. They read source text rather than rendering the page, because this
 * tier has no DOM and because "is this value read from the constant" is
 * exactly a source-level question.
 */

function source(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * The same source with comments stripped. A "this used to say X" note is how
 * these pages record why a literal was replaced, and it must not itself trip
 * an assertion looking for that literal in the rendered copy.
 */
function prose(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const API = "app/docs/api/page.tsx";
const ARCHITECTURE = "app/docs/architecture/page.tsx";
const DEVELOPERS = "app/docs/developers/page.tsx";
const REPORTS = "app/docs/reports/page.tsx";
const TEAMS = "app/docs/teams/page.tsx";
const WEBHOOKS = "app/docs/webhooks/page.tsx";
const EXTENSION = "app/docs/extension/page.tsx";

/** Every in-scope page, for the checks that apply to all of them. */
const DOC_PAGES = [
  API,
  "app/docs/api/playground/page.tsx",
  ARCHITECTURE,
  DEVELOPERS,
  REPORTS,
  TEAMS,
  WEBHOOKS,
  EXTENSION,
  "app/docs/ai/page.tsx",
  "app/docs/billing/page.tsx",
  "app/docs/account-security/page.tsx",
  "app/docs/scheduled-scans/page.tsx",
  "app/docs/sharing/page.tsx",
  "app/docs/triage/page.tsx",
  "app/docs/github/page.tsx",
];

describe("docs pages read their numbers from the code", () => {
  it("finds every page", () => {
    for (const page of DOC_PAGES) {
      expect(source(page).length).toBeGreaterThan(1000);
    }
  });

  /**
   * The developers page quoted `"count": 695` in its /finding-types sample and
   * "652 legacy checks" in the paragraph under it. The real figures were 797
   * and 754, and the API reference two pages over already interpolated the
   * generated constants, so the docs site disagreed with itself about the size
   * of its own catalogue.
   */
  it("quotes check counts from check-stats.generated, never as literals", () => {
    const src = source(DEVELOPERS);
    expect(src).toContain("EXACT_CHECK_COUNT");
    expect(src).toContain("EXACT_LEGACY_CHECK_COUNT");
    expect(src).toContain("EXACT_PAGE_CHECK_COUNT");
    // A hardcoded count in the JSON sample is the exact shape of the bug.
    expect(src).not.toMatch(/"count":\s*\d/);
  });

  /**
   * "which 239 of the 268 settings are". Both halves had drifted (249 of 287
   * at the time this was written), and a page that can import the registry has
   * no reason to quote a snapshot of it.
   */
  it("counts settings from SETTINGS_REGISTRY, never as literals", () => {
    const src = source(DEVELOPERS);
    expect(src).toContain("SETTINGS_REGISTRY");
    expect(prose(DEVELOPERS)).not.toMatch(/of the \d+ settings/);
    // Sanity: the registry really does have both tiers, so the computed
    // sentence says something.
    const runtime = Object.values(SETTINGS_REGISTRY).filter(
      (entry) => entry.tier === "runtime",
    ).length;
    expect(runtime).toBeGreaterThan(0);
    expect(runtime).toBeLessThan(Object.keys(SETTINGS_REGISTRY).length);
  });

  /**
   * The architecture page said "Categories (lib/scanner/types.ts, 16 total)"
   * and listed 16, having never been updated when `reputation` and
   * `active-probes` were added, while EXACT_CHECK_CATEGORY_COUNT two
   * paragraphs above already said 18. One page, two answers.
   */
  it("renders the scanner categories from ALL_CATEGORIES", () => {
    const src = source(ARCHITECTURE);
    expect(src).toContain("ALL_CATEGORIES.map");
    expect(src).not.toMatch(/lib\/scanner\/types\.ts<\/InlineCode>, \d+\s/);
    // Every default category has to be reachable from the rendered list, so a
    // new one appears without anyone editing this page.
    expect(ALL_CATEGORIES.length).toBeGreaterThan(10);
  });

  /**
   * `"probes": ["ssh:2222"]` was a real request field once. It was collapsed
   * into the single `portScan` boolean, and the extension went on serialising
   * the old array to an API that had stopped reading it. No doc should still
   * be teaching it.
   */
  it("documents portScan, not the removed per-service probes array", () => {
    for (const page of DOC_PAGES) {
      const src = prose(page);
      if (!/"probes":\s*\[/.test(src)) continue;
      // Naming the old shape is fine, but only to say it is gone. A page that
      // shows it without that qualifier is teaching a field the API ignores.
      expect(
        src,
        `${page} shows the probes array as if it still works`,
      ).toMatch(/"probes":[\s\S]{0,400}?no longer/);
    }
  });

  /**
   * The webhooks page listed four Discord embed colours keyed to severity
   * counts. The delivery code switched to the canonical safe/caution/unsafe
   * verdict and three colours; the orange it named no longer exists anywhere.
   */
  it("quotes exactly the Discord embed colours the delivery code sends", () => {
    // Follows VERDICT_COLOR to lib/webhooks/scan-notifications.ts, where the
    // shared notification tail now lives. It used to sit in execute-scan.ts,
    // which was the only path that notified at all.
    const scanSource = source("lib/webhooks/scan-notifications.ts");
    const verdictBlock = scanSource.match(
      /VERDICT_COLOR:\s*Record<SafetyRating,\s*number>\s*=\s*\{([^}]*)\}/,
    );
    expect(verdictBlock).not.toBeNull();

    const codeColours = new Set(
      [...verdictBlock![1].matchAll(/0x[0-9a-f]{6}/g)].map((m) =>
        m[0].toLowerCase(),
      ),
    );
    expect(codeColours.size).toBe(3);

    const docColours = new Set(
      [...source(WEBHOOKS).matchAll(/0x[0-9a-f]{6}/g)].map((m) =>
        m[0].toLowerCase(),
      ),
    );
    expect([...docColours].sort()).toEqual([...codeColours].sort());
  });

  /**
   * The report formats are a closed set in the route. Both pages that name
   * them have to name the same set: an SDK author reading either one and
   * sending a format the route rejects gets a 400 for a format the docs
   * promised.
   */
  it("names exactly the report formats the route accepts", () => {
    const routeSource = source("app/api/v3/history/[id]/report/route.ts");
    const formatsBlock = routeSource.match(/const FORMATS = \[([^\]]*)\]/);
    expect(formatsBlock).not.toBeNull();
    const formats = [...formatsBlock![1].matchAll(/"([a-z]+)"/g)].map(
      (m) => m[1],
    );
    expect(formats).toContain("json");
    expect(formats).toContain("compliance");

    for (const page of [API, REPORTS]) {
      const src = source(page);
      for (const format of formats) {
        expect(src).toContain(format);
      }
    }
  });

  /**
   * The compliance crosswalk's framework list was typed out beside a hardcoded
   * "6". FRAMEWORKS is what the generator loops over, so it is what the page
   * has to render: a seventh framework must not be able to ship with the docs
   * still claiming six.
   */
  it("renders the compliance frameworks from FRAMEWORKS", () => {
    const src = source(REPORTS);
    expect(src).toContain("FRAMEWORKS.map");
    expect(src).toContain("String(FRAMEWORKS.length)");
    // Every framework needs prose on this page, which the Record<FrameworkKey>
    // types already enforce at compile time; assert the array is non-trivial
    // so the check above is meaningful.
    expect(FRAMEWORKS.length).toBeGreaterThan(1);
  });

  /**
   * The team capability matrix was a hand-copied duplicate of
   * TEAM_ROLE_PERMISSIONS: six rows, five columns, thirty cells, every one of
   * them a chance to describe a permission model the routes do not enforce.
   */
  it("renders the team role matrix from TEAM_ROLE_PERMISSIONS", () => {
    const src = source(TEAMS);
    expect(src).toContain("TEAM_ROLE_PERMISSIONS");
    // The old hand-written row shape.
    expect(src).not.toContain("manageTeam:");
    expect(src).not.toMatch(/There are six team roles/);
    expect(Object.keys(TEAM_ROLE_PERMISSIONS).length).toBeGreaterThan(1);
  });

  /**
   * websocket.ts said 8 check IDs when WEBSOCKET_CHECK_IDS had 7.
   */
  it("counts protocol check IDs from the exported arrays", () => {
    const src = source(ARCHITECTURE);
    expect(src).toContain("WEBSOCKET_CHECK_IDS.length");
    expect(src).toContain("FTP_CHECK_IDS.length");
    expect(WEBSOCKET_CHECK_IDS.length).toBeGreaterThan(0);
    expect(FTP_CHECK_IDS.length).toBeGreaterThan(0);
  });

  /**
   * A leaked webhook signing secret is recoverable in place now. The security
   * section used to end "Lost the secret? Delete the webhook and create a new
   * one", which costs the reader their webhook id and their consumer's
   * configuration for what is a credential swap.
   */
  it("points a lost webhook secret at rotate-secret, not delete-and-recreate", () => {
    const src = source(WEBHOOKS);
    expect(src).toContain("rotate-secret");
    expect(src).not.toMatch(/Delete the\s*\n?\s*webhook and create a new one/);
  });

  /**
   * The schema left instrumentation.ts for lib/database/schema/. Two pages
   * still told contributors to add a CREATE TABLE to instrumentation.ts, where
   * there is no longer one to add it beside.
   */
  it("points contributors at lib/database/schema for DDL", () => {
    expect(source("instrumentation.ts")).not.toContain("CREATE TABLE");
    for (const page of [ARCHITECTURE, DEVELOPERS]) {
      expect(source(page)).toContain("lib/database/schema/");
    }
  });

  /**
   * The profile page routes its tabs with query params. `/profile#api-keys`
   * silently landed on whichever tab is the default.
   */
  it("links the profile tabs the way the profile page reads them", () => {
    for (const page of DOC_PAGES) {
      expect(source(page)).not.toContain("PROFILE}#");
    }
  });
});
