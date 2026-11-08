/**
 * The landing and comparison pages make claims a reader can check against the
 * product. Each of these was false as written, or true for less of the product
 * than the sentence said.
 *
 * Source-text assertions for the .tsx files: vitest runs `node` and tsconfig
 * keeps `jsx: preserve`, so a component cannot be imported here.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AGENTIC_PENTEST_FAQ,
  getAllAlternatives,
} from "@/lib/seo/alternatives";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Copy only: comment lines are where the old wording is deliberately quoted. */
function copyOnly(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n")
    .replace(/\s+/g, " ");
}

const faqSource = copyOnly(read("app/landing/page.tsx"));

describe("the landing FAQ on the REST API", () => {
  it("no longer promises the whole interface over REST", () => {
    // Schedules and webhooks are managed with a session, so a pipeline built
    // on that sentence could not create one.
    expect(faqSource).not.toContain("Everything the interface can do");
  });

  it("says what a key can reach and what is set up in the app", () => {
    for (const reachable of ["bulk and crawl scans", "report exports"]) {
      expect(faqSource).toContain(reachable);
    }
    expect(faqSource).toMatch(
      /[Ww]ebhooks and scheduled scans are set up in the app/,
    );
  });
});

describe("the fix snippet claim", () => {
  // Four checks ship all four of those stacks. Every check has a snippet, in
  // whatever language its fix is written in.
  it.each([
    "components/landing/landing-features.tsx",
    "components/landing/landing-hero.tsx",
  ])("%s does not promise four named stacks", (file) => {
    const copy = copyOnly(read(file));
    expect(copy).not.toMatch(/Nginx, Caddy,? (and |or )?Express/);
    expect(copy).toContain("in the language the fix needs");
  });

  it("the comparison pages do not promise framework-specific code", () => {
    expect(JSON.stringify(getAllAlternatives())).not.toContain(
      "framework-specific code",
    );
  });

  it("the sample finding keeps its real Nginx and Express snippet", () => {
    const sample = read("components/landing/landing-sample-finding.tsx");
    expect(sample).toContain("# Nginx");
    expect(sample).toContain("# Express");
  });
});

describe("the comparison pages", () => {
  const prose = getAllAlternatives().flatMap((alt) => [
    ...alt.differentiators,
    ...alt.faq.map((item) => item.answer),
  ]);

  it("scope the determinism claim to URL scans and name the exception", () => {
    const { answer } = AGENTIC_PENTEST_FAQ;
    expect(answer).toMatch(/URL scans?/);
    expect(answer).toContain("GitHub repo scans");
    expect(answer).toContain("AI code review");
    expect(answer).not.toContain(
      "A model is used to triage and explain findings, never to decide whether one exists.",
    );
  });

  it("do not claim a page for every check or finding", () => {
    // 55 checks report under their own ids without a page of their own.
    for (const line of prose) {
      expect(line).not.toMatch(/^Every (check|finding)\b/);
      expect(line).not.toMatch(/each with fix steps/);
    }
  });

  it("name more than scans per day as what a plan meters", () => {
    // Schedules and bulk size are capped per plan too (lib/billing/catalog.ts).
    const metered = prose.filter((line) => /scans (per|a) day/i.test(line));
    expect(metered.length).toBeGreaterThan(0);
    for (const line of metered) expect(line).toMatch(/schedules and bulk size/);
  });

  it("do not say a self-hosted instance has no limit at all", () => {
    for (const line of prose) expect(line).not.toContain("no limit at all");
  });
});
