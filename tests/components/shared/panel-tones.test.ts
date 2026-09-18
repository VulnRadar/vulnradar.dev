import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * A panel is one of two things, and the difference means something.
 *
 *   rounded-xl border border-border bg-card            the panel itself
 *   rounded-xl border border-border/50 bg-card/50      a panel inside a panel
 *
 * The second is quieter on purpose: it is what a section uses when it sits
 * inside something that is already a card, so the nesting reads as nesting
 * rather than as two competing boxes.
 *
 * There were seven combinations across 119 call sites: border-border/60 with a
 * solid card, /50 with a solid card, /60 with bg-card/40, /60 with bg-card/50,
 * /50 with bg-card/30. Nobody chose those; they are what happens when the
 * nearest file is copied and the opacity is typed from memory, and the result
 * is cards on /pricing, /repos, /teams and the support inbox each a shade
 * different from the same card elsewhere.
 *
 * This is the guard that keeps it at two. If a third tone is genuinely needed,
 * it belongs here and in CLAUDE.md's radius ladder first, so it is a decision
 * rather than a typo.
 */
const ROOT = path.resolve(__dirname, "..", "..", "..");
const ALLOWED = new Set([
  "rounded-xl border border-border bg-card",
  "rounded-xl border border-border/50 bg-card/50",
]);
const PANEL = /rounded-xl border border-border(?:\/\d+)? bg-card(?:\/\d+)?/g;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("panel tones", () => {
  const files = ["app", "components"].flatMap((d) =>
    tsxFiles(path.join(ROOT, d)),
  );

  it("has panels to check", () => {
    const total = files.reduce(
      (n, f) => n + (readFileSync(f, "utf8").match(PANEL)?.length ?? 0),
      0,
    );
    expect(total).toBeGreaterThan(50);
  });

  it("uses only the two documented tones", () => {
    const strays: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").match(PANEL) ?? []) {
        if (!ALLOWED.has(match)) {
          strays.push(`${path.relative(ROOT, file)}: ${match}`);
        }
      }
    }
    expect(strays).toEqual([]);
  });
});
