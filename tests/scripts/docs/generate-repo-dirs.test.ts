import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * This generator runs in build:knowledge, which prebuild runs, for a list that
 * only feeds a docs table. It stood down when there was no .git, but a .git
 * that git cannot use threw and failed `npm run build` on a source install: no
 * git binary in the build environment, or "dubious ownership" when building as
 * a different user from the clone's owner.
 */
const COMMITTED = "// the committed list\n";
const OUTPUT = "app/docs/architecture/repo-dirs.generated.ts";

type Env = Record<string, string | undefined>;

describe("generate-repo-dirs when git is unavailable", () => {
  let root: string;

  function checkout() {
    root = mkdtempSync(path.join(os.tmpdir(), "vulnradar-repo-dirs-"));
    mkdirSync(path.join(root, "scripts/docs"), { recursive: true });
    cpSync(
      "scripts/docs/generate-repo-dirs.mjs",
      path.join(root, "scripts/docs/generate-repo-dirs.mjs"),
    );
    mkdirSync(path.join(root, ".git"));
    mkdirSync(path.join(root, path.dirname(OUTPUT)), { recursive: true });
    writeFileSync(path.join(root, OUTPUT), COMMITTED);
  }

  function generate(env: Env) {
    return spawnSync(
      process.execPath,
      [path.join(root, "scripts/docs/generate-repo-dirs.mjs")],
      { encoding: "utf8", env: env as NodeJS.ProcessEnv },
    );
  }

  const baseEnv = (): Env => ({
    SystemRoot: process.env.SystemRoot,
  });
  const output = () => readFileSync(path.join(root, OUTPUT), "utf8");

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("exits 0 and keeps the committed list when there is no git binary", () => {
    checkout();

    const run = generate({
      ...baseEnv(),
      PATH: path.join(root, "no-git-here"),
    });

    expect(run.status, run.stderr).toBe(0);
    expect(output()).toBe(COMMITTED);
    expect(run.stderr.trim().split(/\r?\n/)).toHaveLength(1);
    expect(run.stderr).toMatch(/git/i);
  });

  it("exits 0 and keeps the committed list when git refuses the repository", () => {
    checkout();

    // An empty .git is not a repository, the same exit 128 that a "dubious
    // ownership" refusal gives. GIT_DIR keeps it from finding one further up.
    const run = generate({
      ...baseEnv(),
      PATH: process.env.PATH,
      GIT_DIR: path.join(root, "not-a-repository"),
    });

    expect(run.status, run.stderr).toBe(0);
    expect(output()).toBe(COMMITTED);
    expect(run.stderr.trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("still rewrites the list when git works", () => {
    checkout();
    rmSync(path.join(root, ".git"), { recursive: true });
    for (const dir of ["lib/widgets", "components/forms"]) {
      mkdirSync(path.join(root, dir), { recursive: true });
      writeFileSync(path.join(root, dir, "a.ts"), "");
    }
    const git = (...args: string[]) =>
      spawnSync("git", args, { cwd: root, encoding: "utf8" });
    expect(git("init", "-q").status).toBe(0);
    expect(git("add", ".").status).toBe(0);

    const run = generate({ ...baseEnv(), PATH: process.env.PATH });

    expect(run.status, run.stderr).toBe(0);
    expect(output()).toContain('"widgets"');
  });
});
