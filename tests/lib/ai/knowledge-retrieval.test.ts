import { describe, it, expect, beforeEach } from "vitest";

import {
  retrieveKnowledge,
  buildRetrievedContextBlock,
  __resetKnowledgeIndexForTests,
  DEFAULT_MAX_CHARS,
} from "@/lib/ai/knowledge-retrieval";

/**
 * The bug this whole mechanism exists for: the owner asked the assistant "can
 * we do GitHub repo scanning?" and it said no, about /repos, which had shipped
 * releases earlier. Knowledge was only reachable when the user happened to
 * type the right slash command first, so a bare question was answered from
 * nothing.
 *
 * These cases are the proof that a bare question now finds the material. They
 * run against the committed index (lib/ai/knowledge-index.json), not a
 * fixture, because a retriever that scores well on a hand-built corpus and
 * badly on the real one has proven nothing.
 */

beforeEach(() => {
  __resetKnowledgeIndexForTests();
});

/** All retrieved text, lowercased, for a message a user would actually send. */
function retrievedText(question: string): string {
  return retrieveKnowledge(question)
    .map((s) => `${s.heading}\n${s.text}`)
    .join("\n")
    .toLowerCase();
}

describe("retrieval answers bare product questions", () => {
  // Each case is a question with no slash command and a string that can only
  // come from the right source section. Route paths are used as the marker
  // wherever there is one: a route is unambiguous in a way a feature noun is
  // not.
  const CASES: [question: string, mustContain: string][] = [
    ["can we do GitHub repo scanning?", "/repos"],
    ["does it scan my github repository source code", "/repos"],
    ["what is the attack surface page", "/attack-surface"],
    ["how do I put a security badge in my readme", "/badge"],
    ["can I share a team with my coworkers", "/teams"],
    ["do you support scheduled scans", "scheduled"],
    ["is there a CLI", "cli"],
    ["is there a browser extension", "extension"],
    ["how do I compare two scans", "/compare"],
    ["where do I see my shared report links", "/shares"],
  ];

  for (const [question, mustContain] of CASES) {
    it(`finds "${mustContain}" for: ${question}`, () => {
      const text = retrievedText(question);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain(mustContain.toLowerCase());
    });
  }

  /**
   * The original failure, asserted end to end rather than by marker: the block
   * that actually reaches the model has to carry the repos material.
   */
  it("puts the repo-scanning material in the injected block", () => {
    const block = buildRetrievedContextBlock("can we do GitHub repo scanning?");
    expect(block).not.toBeNull();
    expect(block!).toContain('<context cmd="auto">');
    expect(block!).toContain("</context>");
    expect(block!.toLowerCase()).toContain("/repos");
  });
});

describe("retrieval stays quiet when it has nothing", () => {
  it("returns nothing for a greeting", () => {
    expect(retrieveKnowledge("hi")).toEqual([]);
    expect(buildRetrievedContextBlock("hey there")).toBeNull();
  });

  it("returns nothing for an empty message", () => {
    expect(retrieveKnowledge("")).toEqual([]);
    expect(retrieveKnowledge("   ")).toEqual([]);
  });

  it("returns nothing for a question about something the product has no material on", () => {
    expect(
      retrieveKnowledge("qwertyuiop zxcvbnm asdfghjkl plugh xyzzy"),
    ).toEqual([]);
  });
});

describe("the budget degrades by dropping sections, never by cutting one", () => {
  const QUESTION = "github repo scanning teams badge schedule compare share";

  it("never exceeds the character budget", () => {
    for (const maxChars of [500, 2_000, 8_000, DEFAULT_MAX_CHARS]) {
      const total = retrieveKnowledge(QUESTION, { maxChars })
        .map((s) => s.text.length)
        .reduce((a, b) => a + b, 0);
      expect(total, `budget ${maxChars}`).toBeLessThanOrEqual(maxChars);
    }
  });

  it("returns whole sections, never a truncated one", () => {
    // Reference set: no budget pressure at all, so it contains every section
    // a tighter run can reach further down the ranking for.
    const full = new Map(
      retrieveKnowledge(QUESTION, {
        maxChars: 1_000_000,
        maxSections: 100,
      }).map((s) => [s.heading, s.text]),
    );
    // Every section that survives a tight budget has to be byte-identical to
    // the same section retrieved with room to spare. A retriever that trimmed
    // to fit would fail exactly here, which is the regression that made the
    // assistant "forget" the changelog once before.
    for (const section of retrieveKnowledge(QUESTION, { maxChars: 3_000 })) {
      expect(full.get(section.heading)).toBe(section.text);
    }
  });

  it("drops the lowest-scoring sections first", () => {
    const generous = retrieveKnowledge(QUESTION, {
      maxChars: DEFAULT_MAX_CHARS,
    });
    const tight = retrieveKnowledge(QUESTION, { maxChars: 3_000 });
    expect(tight.length).toBeLessThan(generous.length);
    // The best match survives every budget that can hold it at all.
    expect(tight[0]?.heading).toBe(generous[0]?.heading);
    // And nothing kept scores below something that was dropped.
    const keptScores = tight.map((s) => s.score);
    expect(keptScores).toEqual([...keptScores].sort((a, b) => b - a));
  });

  it("honours the section cap", () => {
    expect(
      retrieveKnowledge(QUESTION, { maxSections: 2 }).length,
    ).toBeLessThanOrEqual(2);
    expect(retrieveKnowledge(QUESTION, { maxSections: 0 })).toEqual([]);
  });

  it("scores results in descending order", () => {
    const scores = retrieveKnowledge(QUESTION).map((s) => s.score);
    expect(scores.length).toBeGreaterThan(1);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

describe("retrieved sections carry their source", () => {
  it("names the slash command that loads the whole file", () => {
    const sections = retrieveKnowledge("can we do GitHub repo scanning?");
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.cmd).toMatch(/^[a-z-]+$/);
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.heading.length).toBeGreaterThan(0);
    }
  });
});
