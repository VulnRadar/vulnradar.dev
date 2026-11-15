import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readWorkflow } from "./_workflow-steps";

/**
 * stale.yml's header says Dependabot pull requests are exempt, and it was not
 * true: exempt-pr-labels listed pinned, security and dependabot-merge-ignore,
 * and Dependabot applies none of those, so a bump left waiting on a human for
 * 30 days would be marked stale and closed a week later.
 * The exemption works through labels, so this holds the labels the two files
 * name against each other.
 */

const ROOT = path.resolve(__dirname, "../..");
const dependabot = readFileSync(
  path.join(ROOT, ".github", "dependabot.yml"),
  "utf8",
).replace(/\r\n/g, "\n");
const stale = readWorkflow("stale.yml");

/**
 * Labels that need no entry of their own in exempt-pr-labels, because
 * Dependabot only ever applies them together with `dependabot`, which is
 * exempt. Each says which blocks apply it.
 */
const COVERED_BY_DEPENDABOT: Record<string, string> = {
  dependencies: "the root and extension npm blocks",
  extension: "the extension npm block",
  docker: "the docker and docker-compose blocks",
  "github-actions": "the github-actions block",
};

/** Each update block's `labels:` list, in file order. */
function labelLists(): string[][] {
  const blocks = dependabot.split(/^ {2}- package-ecosystem:/m).slice(1);
  return blocks.map((block) => {
    const at = block.search(/^ {4}labels:\s*$/m);
    if (at === -1) return [];
    const items: string[] = [];
    for (const line of block.slice(at).split("\n").slice(1)) {
      const item = /^ {6}- "?([^"]+?)"?\s*$/.exec(line);
      if (!item) break;
      items.push(item[1]);
    }
    return items;
  });
}

function exemptPrLabels(): string[] {
  const m = /^\s+exempt-pr-labels:\s*"([^"]*)"\s*$/m.exec(stale);
  expect(m, "stale.yml sets exempt-pr-labels").not.toBeNull();
  return m![1].split(",").map((l) => l.trim());
}

describe("stale.yml exempts every Dependabot pull request", () => {
  const lists = labelLists();

  it("reads a labels list from every Dependabot block", () => {
    const blocks = (dependabot.match(/^ {2}- package-ecosystem:/gm) ?? [])
      .length;
    expect(blocks).toBeGreaterThan(0);
    expect(lists).toHaveLength(blocks);
    for (const list of lists) expect(list.length).toBeGreaterThan(0);
  });

  it("has every Dependabot block apply the dependabot label", () => {
    for (const list of lists) expect(list).toContain("dependabot");
  });

  it("exempts the dependabot label", () => {
    expect(exemptPrLabels()).toContain("dependabot");
  });

  it("exempts every other label Dependabot applies, or names why it need not", () => {
    const exempt = exemptPrLabels();
    for (const label of new Set(lists.flat())) {
      expect(
        exempt.includes(label) || label in COVERED_BY_DEPENDABOT,
        `${label} is neither exempt nor covered by the dependabot label`,
      ).toBe(true);
    }
  });

  it("lists nothing in COVERED_BY_DEPENDABOT that Dependabot no longer applies", () => {
    const applied = new Set(lists.flat());
    for (const label of Object.keys(COVERED_BY_DEPENDABOT)) {
      expect(applied.has(label), label).toBe(true);
    }
  });
});
