import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { replaceOutput } from "../../../scripts/knowledge/replace-output.mjs";

/**
 * The docs and checks compilers report how stale the previous knowledge file
 * was, so they need its mtime before they overwrite it. They used to get it
 * with existsSync + statSync on the path and then writeFileSync to the same
 * path: two lookups of one name, with the file free to change between them.
 * replaceOutput opens the file once and reads the mtime from, truncates and
 * writes through that one handle.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "replace-output-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("replaceOutput", () => {
  it("returns the mtime the file had before it was replaced", () => {
    const file = path.join(dir, "knowledge.md");
    writeFileSync(file, "a much longer previous body than the new one\n");
    const old = new Date("2024-01-02T03:04:05Z");
    utimesSync(file, old, old);

    const previous = replaceOutput(file, "new");

    expect(previous).toBe(old.getTime());
    expect(readFileSync(file, "utf8")).toBe("new");
  });

  it("creates a missing file and reports a time no source can be newer than", () => {
    const file = path.join(dir, "fresh.md");
    const before = Date.now();

    const previous = replaceOutput(file, "first ✓ run\n");

    expect(readFileSync(file, "utf8")).toBe("first ✓ run\n");
    expect(previous).toBeGreaterThanOrEqual(before - 2000);
  });

  it("writes the bytes exactly, with nothing of the old file left behind", () => {
    const file = path.join(dir, "exact.md");
    writeFileSync(file, "x".repeat(4096));
    const body = "line one\nline two\n\n| a | ✓ |\n";

    replaceOutput(file, body);

    expect(readFileSync(file)).toEqual(Buffer.from(body, "utf8"));
  });

  it("does not leave a file behind when the directory is missing", () => {
    const file = path.join(dir, "no-such-dir", "out.md");
    expect(() => replaceOutput(file, "x")).toThrow(/ENOENT/);
    expect(existsSync(file)).toBe(false);
  });
});

describe("the knowledge compilers", () => {
  for (const script of [
    "scripts/knowledge/compile-docs-knowledge.mjs",
    "scripts/knowledge/compile-checks-knowledge.mjs",
  ]) {
    it(`${script} reads the previous mtime and writes through one handle`, () => {
      const src = readFileSync(script, "utf8");
      expect(src).not.toMatch(/(?:existsSync|statSync)\(\s*OUTPUT\s*\)/);
      expect(src).not.toMatch(/writeFileSync\(\s*OUTPUT\s*,/);
      expect(src).toMatch(/replaceOutput\(\s*OUTPUT\s*,/);
    });
  }
});
