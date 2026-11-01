import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseRunArgs,
  removeScratchRoot,
} from "../../../scripts/spike/lib/options.mjs";

/**
 * The spike harness copies the fixture app into a scratch directory, builds it
 * and serves it. It used to default that directory to the fixed name
 * `<os temp>/vulnradar-spike`. On a machine with more than one account the OS
 * temp directory can be shared, so anybody could create that path first (or
 * make it a symlink) and have the harness copy, build and run their files, or
 * write the build into a tree they chose. A directory from mkdtemp has a name
 * nobody can predict and is created 0700, which closes both.
 */

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function parsed(args: string[]) {
  const opts = parseRunArgs(args);
  if (opts.ownsWorkdir) created.push(opts.workdir);
  return opts;
}

describe("spike scratch directory", () => {
  it("creates a fresh, unpredictable directory under the OS temp dir", () => {
    const a = parsed([]);
    const b = parsed([]);

    expect(a.ownsWorkdir).toBe(true);
    expect(a.workdir).not.toBe(b.workdir);
    expect(path.dirname(a.workdir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(a.workdir)).toMatch(/^vulnradar-spike-.{6,}$/);
    expect(a.workdir).not.toBe(path.join(os.tmpdir(), "vulnradar-spike"));
    expect(statSync(a.workdir).isDirectory()).toBe(true);
    expect(readdirSync(a.workdir)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "is readable and writable by its owner only",
    () => {
      const { workdir } = parsed([]);
      expect(statSync(workdir).mode & 0o777).toBe(0o700);
    },
  );

  it("uses the directory it is given and does not claim it", () => {
    const own = path.join(os.tmpdir(), "spike-explicit-workdir");
    const opts = parsed(["--workdir", own]);
    expect(opts.workdir).toBe(path.resolve(own));
    expect(opts.ownsWorkdir).toBe(false);
    expect(existsSync(own)).toBe(false);
  });

  it("keeps the other options as they were", () => {
    const opts = parsed(["--target", "start", "--port", "3109"]);
    expect(opts.target).toBe("start");
    expect(opts.port).toBe(3109);
    expect(opts.out).toBe(path.resolve("spike-results"));
    expect(opts.install).toBe(false);
    expect(opts.requireDocker).toBe(false);
  });

  it("removes the scratch root without following a node_modules link", () => {
    const { workdir } = parsed([]);
    const outside = parsed([]).workdir;
    writeFileSync(path.join(outside, "keep.txt"), "still here");

    const target = path.join(workdir, "start");
    mkdirSync(target);
    symlinkSync(
      outside,
      path.join(target, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    writeFileSync(path.join(target, "page.js"), "x");

    removeScratchRoot(workdir);

    expect(existsSync(workdir)).toBe(false);
    expect(readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe(
      "still here",
    );
  });
});

describe("spike scripts", () => {
  function scripts(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return scripts(full);
      return entry.name.endsWith(".mjs") ? [full] : [];
    });
  }

  it("never name a path in the OS temp directory themselves", () => {
    const offenders = scripts("scripts/spike").flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        .filter(({ line }) => /tmpdir\(\)/.test(line) && !/mkdtemp/.test(line))
        .map(({ at }) => at),
    );
    expect(
      offenders,
      "A fixed name under os.tmpdir() can be created first by another " +
        "account. Use mkdtempSync(path.join(os.tmpdir(), prefix)).",
    ).toEqual([]);
  });

  it("run.mjs takes its options from parseRunArgs", () => {
    const src = readFileSync("scripts/spike/run.mjs", "utf8");
    expect(src).toMatch(/parseRunArgs\(\)/);
    expect(src).not.toMatch(/function parse\(/);
  });
});
