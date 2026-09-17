import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The stacking order is a cross-cutting fact: eleven fixed elements coordinate
 * around each other, and the ordering lived only in comments in ten files
 * quoting each other's numbers. app/globals.css declares it once; this fails
 * on any layer value the table does not mention, so a new one has to be placed
 * in that order deliberately rather than guessed.
 */
const LAYER_TABLE = readFileSync("app/globals.css", "utf8").slice(
  0,
  readFileSync("app/globals.css", "utf8").indexOf("@config"),
);

describe("stacking order", () => {
  it("every layer used in app/ or components/ is in the table in globals.css", () => {
    const files = execFileSync("git", ["ls-files", "app", "components"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("components/ui/"));

    const declared = new Set(
      [...LAYER_TABLE.matchAll(/z-(\d+)/g)].map((m) => m[1]),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        // Only the layers this table governs: below 20 is in-flow stacking
        // inside one component, which no other file has to coordinate with.
        for (const m of line.matchAll(/\bz-\[?(\d+)\]?\b/g)) {
          const value = Number(m[1]);
          if (value >= 20 && !declared.has(m[1])) {
            offenders.push(`${file}:${i + 1} ${m[0]}`);
          }
        }
      });
    }
    expect(
      offenders,
      `Add these layers to the stacking-order table at the top of app/globals.css:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
