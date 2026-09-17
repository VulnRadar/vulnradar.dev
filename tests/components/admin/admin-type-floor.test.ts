import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Nothing in the admin panel is set below 11px.
 *
 * Eighty-two admin elements were 10px, and they were not captions: a host's
 * danger score, the "flagged" badge the engine-feedback tab exists to surface,
 * an audit entry's exact time and IP, which audience a live banner reaches.
 * 11px is what StatusPill, the panel's own status vocabulary, already uses.
 */
describe("admin type floor", () => {
  it("uses no text size below 11px", () => {
    const files = execFileSync(
      "git",
      ["ls-files", "components/admin", "app/admin"],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f));
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        const m = /text-\[(\d+(?:\.\d+)?)px\]/.exec(line);
        if (m && Number(m[1]) < 11) offenders.push(`${file}:${i + 1} ${m[0]}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
