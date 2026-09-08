/**
 * The domain management controls used to live in a disclosure inside a row of
 * a list, inside a tab, inside the profile page. DomainControlPanel is around
 * 400 lines: every published scan of the domain, per-scan unpublish and
 * share-revoke actions, a block switch and two confirmations. Expanding it
 * pushed every row beneath it down by the height of a page.
 *
 * Source-text assertions, because this Vitest config runs plain node with no
 * jsdom and a `.tsx` cannot be rendered. What is worth pinning is the wiring
 * that would break silently: that the page reuses the one panel rather than
 * forking it, that it is not reachable without signing in, and that it answers
 * the same way for a domain that does not exist and one belonging to someone
 * else.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const PAGE = read("app/domains/[id]/page.tsx");
const PUBLIC_PATHS = read("lib/config/public-paths.ts");

describe("the domain management page", () => {
  it("reuses the control panel instead of forking it", () => {
    // Two copies of unpublish-and-block would drift, and one of them would be
    // the copy an owner actually reaches.
    expect(PAGE).toContain('from "@/components/domains/domain-control-panel"');
    expect(PAGE).toContain("<DomainControlPanel");
    // The panel owns its own fetching; the page must not re-implement it.
    expect(PAGE).not.toContain("DOMAIN_SCANS");
    expect(PAGE).not.toContain("DOMAIN_BLOCK");
  });

  it("is not reachable without signing in", () => {
    // Not in PUBLIC_PATHS means middleware redirects an anonymous visitor to
    // /login. These controls change what other people's scans can show.
    expect(PUBLIC_PATHS).not.toMatch(/["'`]\/domains/);
  });

  it("gives the same answer for a missing domain and someone else's", () => {
    // The page reads the list endpoint, which is already scoped to domains the
    // caller owns or shares a team with, so an id that is absent from it is
    // one they may not see. Both land on the same "could not find" state,
    // which does not tell a stranger whether the id exists.
    expect(PAGE).toContain("API.DOMAINS");
    expect(PAGE).toContain("setMissing(true)");
    // Both an unusable id and an id the caller cannot see collapse into one
    // rendered state, so the page cannot answer them differently.
    expect(PAGE).toContain("const notFound = !validId || missing;");
    expect(PAGE).toMatch(/could not find that domain/i);
  });

  it("shows nothing to act on until the domain is verified", () => {
    // Every control in the panel rests on proven ownership.
    expect(PAGE).toContain('domain?.status !== "verified"');
    expect(PAGE).toMatch(/not verified yet/i);
  });

  it("offers the way back before the content, not after it", () => {
    // The scan list can be long; a back link under it is a link nobody finds.
    const beforeHeader = PAGE.slice(0, PAGE.indexOf("<header"));
    expect(beforeHeader).toContain("ArrowLeft");
    // /attack-surface, not the Developer tab: the domains list moved there
    // and the tab keeps only a pointer for old ?dtab=domains links.
    expect(PAGE).toContain("ROUTES.ATTACK_SURFACE");
  });

  it("titles itself with the sub-page heading tier", () => {
    // CLAUDE.md: Tier B, for a surface reached from inside the app, and it
    // carries text-foreground explicitly because the shell sets a muted colour.
    expect(PAGE).toContain(
      'className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground"',
    );
  });

  it("keeps em dashes out of the copy", () => {
    const prose = PAGE.split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    expect(prose).not.toContain("—");
  });
});
