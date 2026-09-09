/**
 * The AI chat route splits its input allowance in two: a tight budget for
 * conversation turns and a much larger one for the <context> blocks the slash
 * commands inject (app/api/v3/ai/chat/route.ts). Anything over the context
 * budget is skipped, silently, and the symptom is the assistant not knowing
 * what the user just handed it.
 *
 * That budget is a constant, and what it has to hold is a set of generated
 * files that grow with every release. It went stale exactly that way once: the
 * comment beside it still described a 250k changelog while the file on disk had
 * reached 506k, so the loaders no longer fit together and a block was being
 * dropped from requests that had just asked for it.
 *
 * So measure the real files against the real constant. These are build
 * artifacts, so a failure here means one of them outgrew the budget, and the
 * answer is to serve that command from an index (as /checks and /changelog do)
 * rather than to raise the number.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const CHAT_ROUTE = read("app/api/v3/ai/chat/route.ts");
const CONTEXT_ROUTE = read("app/api/v3/ai/context/route.ts");

function constantFromRoute(name: string): number {
  const m = new RegExp(`const ${name} = ([0-9_]+)`).exec(CHAT_ROUTE);
  if (!m) throw new Error(`${name} not found in the chat route`);
  return Number(m[1].replace(/_/g, ""));
}

/**
 * What each file-backed slash command actually sends. The two commands with an
 * index send the index; the full file behind them is the retrieval corpus and
 * never travels whole.
 */
const COMMAND_PAYLOADS: Record<string, string> = {
  features: "lib/ai/features-knowledge.md",
  docs: "lib/ai/docs-knowledge.md",
  changelog: "lib/ai/changelog-index.md",
  checks: "lib/ai/checks-index.md",
  legal: "lib/ai/legal-knowledge.md",
};

/**
 * /me, /history, /finding and /stats build their blocks from the database, so
 * there is no file to weigh. They are small (an account summary, a page of
 * scans) but not nothing, and they can be loaded alongside the file-backed
 * ones, so the budget has to have room left over for them.
 */
const DYNAMIC_COMMAND_HEADROOM = 100_000;

/**
 * No single command should be able to fill the window on its own, whatever the
 * total says. 200k is about 50k tokens: large for one message, still leaving
 * most of a small model's window for the conversation and the answer.
 */
const PER_COMMAND_CAP = 200_000;

describe("AI context budget", () => {
  const budget = constantFromRoute("MAX_CONTEXT_CHARS");

  it("has every file it names on disk", () => {
    // A missing file is served as "" by readKnowledgeFile, so the command
    // would look like it worked and hand the model nothing.
    for (const [cmd, rel] of Object.entries(COMMAND_PAYLOADS)) {
      expect(
        fs.existsSync(path.join(ROOT, rel)),
        `/${cmd} serves ${rel}, which is missing. Run npm run build:knowledge.`,
      ).toBe(true);
    }
  });

  it("fits every file-backed command loaded at once, with room for the rest", () => {
    const sizes = Object.entries(COMMAND_PAYLOADS).map(
      ([cmd, rel]) =>
        [cmd, fs.statSync(path.join(ROOT, rel)).size] as [string, number],
    );
    const total = sizes.reduce((n, [, size]) => n + size, 0);
    const detail = sizes
      .sort((a, b) => b[1] - a[1])
      .map(([cmd, size]) => `/${cmd} ${Math.round(size / 1024)}KB`)
      .join(", ");

    expect(
      total + DYNAMIC_COMMAND_HEADROOM,
      `The slash commands now total ${Math.round(total / 1024)}KB (${detail}), ` +
        `over the ${Math.round(budget / 1024)}KB context budget in the chat ` +
        `route once ${Math.round(DYNAMIC_COMMAND_HEADROOM / 1024)}KB is left ` +
        `for the database-backed commands. The chat route drops whatever does ` +
        `not fit, so a user who loads two of these loses one without being ` +
        `told. Serve the biggest one from an index instead of raising the ` +
        `budget.`,
    ).toBeLessThanOrEqual(budget);
  });

  it("keeps any single command well under the budget", () => {
    for (const [cmd, rel] of Object.entries(COMMAND_PAYLOADS)) {
      const size = fs.statSync(path.join(ROOT, rel)).size;
      expect(
        size,
        `/${cmd} sends ${Math.round(size / 1024)}KB in one message. Serve it ` +
          `from a compact index, the way /checks and /changelog do.`,
      ).toBeLessThanOrEqual(PER_COMMAND_CAP);
    }
  });

  it("serves the two big commands from an index, not the full corpus", () => {
    // Both fall back to the full file when the index is absent, which is
    // correct for a deployment that never ran the compiler, but the index has
    // to be the first choice or the fallback is the whole point undone.
    for (const [index, full] of [
      ["changelog-index.md", "changelog-knowledge.md"],
      ["checks-index.md", "checks-knowledge.md"],
    ]) {
      const at = CONTEXT_ROUTE.indexOf(index);
      const fullAt = CONTEXT_ROUTE.indexOf(full);
      expect(at, `${index} is not read by the context route`).toBeGreaterThan(
        -1,
      );
      expect(
        at,
        `${full} is read before ${index}, so the index never applies`,
      ).toBeLessThan(fullAt);
    }
  });

  it("still counts context blocks separately from conversation turns", () => {
    // The two budgets exist because counting a loaded command against the turn
    // budget is what dropped the context the first time this broke.
    expect(CHAT_ROUTE).toContain("const MAX_CONVERSATION_CHARS");
    expect(CHAT_ROUTE).toContain("let contextBudget = MAX_CONTEXT_CHARS");
    // Skip, not stop: an older-but-large block must not be cut off because the
    // turns in front of it already spent the turn budget.
    expect(CHAT_ROUTE).toMatch(/contextBudget < 0 &&[\s\S]{0,60}continue;/);
  });
});
