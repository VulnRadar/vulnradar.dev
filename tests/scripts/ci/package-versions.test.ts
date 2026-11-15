import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkPackage,
  compareNpm,
  compareVersions,
  PACKAGES,
  previousRelease,
  run,
} from "../../../scripts/ci/package-versions.mjs";

/**
 * scripts/ci/package-versions.mjs decides whether a release may ship, so it is
 * run here against a real git repository built in a temp directory: a
 * v1.0.0 release, and one commit on top of it per case.
 */

const SCRIPT = path.resolve(
  __dirname,
  "../../../scripts/ci/package-versions.mjs",
);
const ROOT = mkdtempSync(path.join(tmpdir(), "vr-package-versions-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

// An empty global config: no signing, no hooks and no identity from the
// machine running the test reach the throwaway repositories.
writeFileSync(path.join(ROOT, "gitconfig"), "");
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: path.join(ROOT, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

let repos = 0;

type Files = Record<string, string | null>;

const cliManifest = (version: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify(
    { name: "vulnradar", version, files: ["vr.mjs", "README.md"], ...extra },
    null,
    2,
  );
const extManifest = (version: string) =>
  JSON.stringify({ name: "vulnradar-extension", version }, null, 2);

const BASE: Files = {
  "cli/package.json": cliManifest("1.0.0"),
  "cli/vr.mjs": "export const v = 1;\n",
  "cli/README.md": "# vr\n",
  "cli/vr.test.mjs": "// not shipped\n",
  "extension/package.json": extManifest("0.1.0"),
  "extension/package-lock.json": "{}\n",
  "extension/src/a.ts": "export const a = 1;\n",
  "extension/tests/a.test.ts": "// not shipped\n",
  "app/page.tsx": "export {};\n",
};

const REPO = path.join(ROOT, "repo");
const git = (...args: string[]) => {
  const r = spawnSync("git", args, {
    cwd: REPO,
    env: GIT_ENV,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
let initialised = false;

/**
 * The one throwaway repository, checked out at v1.0.0 for the next case. Each
 * case commits on top of that, so no case sees another's commits; git is slow
 * enough on some machines that a repository per case would not fit a timeout.
 */
function makeRepo() {
  const dir = REPO;
  const commit = (files: Files, message: string) => {
    for (const [file, content] of Object.entries(files)) {
      const full = path.join(dir, file);
      if (content === null) {
        rmSync(full, { force: true });
        continue;
      }
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  if (!initialised) {
    mkdirSync(REPO);
    git("init", "-q");
    commit(BASE, "v1.0.0");
    git("tag", "-a", "v1.0.0", "-m", "v1.0.0");
    initialised = true;
  } else {
    git("checkout", "-q", "--detach", "v1.0.0");
  }
  return { dir, git, commit };
}

/** A repository with v1.0.0 and one more commit applying `change`. */
function released(change: Files) {
  const repo = makeRepo();
  const head = repo.commit(change, "change");
  return { ...repo, head };
}

const cli = PACKAGES.find((p) => p.name === "cli")!;
const ext = PACKAGES.find((p) => p.name === "extension")!;

describe("compareVersions", () => {
  it("orders by major, minor and patch, and a prerelease below its release", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
  });
});

describe("the previous release", { timeout: 120_000 }, () => {
  it("is the newest stable tag before the ref, never a prerelease", () => {
    const repo = makeRepo();
    repo.commit({ "app/page.tsx": "export const x = 1;\n" }, "rc");
    repo.git("tag", "-a", "v1.1.0-rc.1", "-m", "rc");
    const head = repo.commit(
      { "app/page.tsx": "export const x = 2;\n" },
      "next",
    );
    expect(previousRelease(repo.dir, head)).toBe("v1.0.0");
  });

  it("is not the ref itself when the ref is the release being cut", () => {
    const repo = makeRepo();
    repo.commit(
      {
        "cli/vr.mjs": "export const v = 2;\n",
        "cli/package.json": cliManifest("1.1.0"),
      },
      "bump",
    );
    repo.git("tag", "-a", "v1.1.0", "-m", "v1.1.0");
    expect(previousRelease(repo.dir, "v1.1.0")).toBe("v1.0.0");
  });
});

describe("each outcome", { timeout: 120_000 }, () => {
  it("unchanged: nothing it ships changed", () => {
    const { dir, head } = released({
      "app/page.tsx": "export const y = 1;\n",
      "cli/vr.test.mjs": "// still not shipped\n",
    });
    expect(checkPackage(dir, cli, "v1.0.0", head).outcome).toBe("unchanged");
    expect(checkPackage(dir, ext, "v1.0.0", head).outcome).toBe("unchanged");
  });

  it("bumped: the version moved up", () => {
    const { dir, head } = released({
      "cli/vr.mjs": "export const v = 2;\n",
      "cli/package.json": cliManifest("1.0.1"),
    });
    const r = checkPackage(dir, cli, "v1.0.0", head);
    expect(r.outcome).toBe("bumped");
    expect([r.from, r.to]).toEqual(["1.0.0", "1.0.1"]);
  });

  it("changed-same-version: a shipped file changed and the version did not", () => {
    const { dir, head } = released({
      "extension/src/a.ts": "export const a = 2;\n",
    });
    const r = checkPackage(dir, ext, "v1.0.0", head);
    expect(r.outcome).toBe("changed-same-version");
    expect(r.changed).toEqual(["extension/src/a.ts"]);
  });

  it("changed-same-version: the manifest changed beyond its version", () => {
    const { dir, head } = released({
      "cli/package.json": cliManifest("1.0.0", { engines: { node: ">=24" } }),
    });
    expect(checkPackage(dir, cli, "v1.0.0", head).changed).toEqual([
      "cli/package.json",
    ]);
  });

  it("changed-same-version: a file joined the files list", () => {
    const { dir, head } = released({
      "cli/extra.mjs": "export {};\n",
      "cli/package.json": JSON.stringify(
        {
          name: "vulnradar",
          version: "1.0.0",
          files: ["vr.mjs", "README.md", "extra.mjs"],
        },
        null,
        2,
      ),
    });
    const r = checkPackage(dir, cli, "v1.0.0", head);
    expect(r.outcome).toBe("changed-same-version");
    expect(r.changed).toContain("cli/extra.mjs");
  });

  it("version-went-down", () => {
    const { dir, head } = released({
      "cli/package.json": cliManifest("0.9.0"),
    });
    expect(checkPackage(dir, cli, "v1.0.0", head).outcome).toBe(
      "version-went-down",
    );
  });

  it("invalid-version", () => {
    const { dir, head } = released({ "cli/package.json": cliManifest("1.0") });
    expect(checkPackage(dir, cli, "v1.0.0", head).outcome).toBe(
      "invalid-version",
    );
  });

  it("reports a lockfile-only change and never fails on it", () => {
    const { dir, head } = released({
      "extension/package-lock.json": '{"lockfileVersion": 3}\n',
    });
    const r = checkPackage(dir, ext, "v1.0.0", head);
    expect(r.outcome).toBe("unchanged");
    expect(r.lockfileChanged).toBe(true);
    const out = run({ cwd: dir, mode: "release", ref: head });
    expect(out.code).toBe(0);
    expect(out.lines.join("\n")).toMatch(
      /::notice::extension's lockfile changed/,
    );
  });
});

describe("release mode", { timeout: 120_000 }, () => {
  it("fails on a package that changed without a bump, naming it and both versions", () => {
    const { dir, head } = released({ "cli/vr.mjs": "export const v = 2;\n" });
    const out = run({ cwd: dir, mode: "release", ref: head });
    expect(out.code).toBe(1);
    expect(out.lines.join("\n")).toMatch(
      /::error::cli 1[.]0[.]0 at v1[.]0[.]0, 1[.]0[.]0 at /,
    );
  });

  it("passes a release whose changed packages were all bumped", () => {
    const { dir, head } = released({
      "cli/vr.mjs": "export const v = 2;\n",
      "cli/package.json": cliManifest("1.1.0"),
      "extension/src/a.ts": "export const a = 2;\n",
      "extension/package.json": extManifest("0.2.0"),
    });
    expect(run({ cwd: dir, mode: "release", ref: head }).code).toBe(0);
  });

  it("exits 1 as a process, with the message on stdout", () => {
    const { dir, head } = released({ "cli/vr.mjs": "export const v = 2;\n" });
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "--mode", "release", "--ref", head],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Bump cli/package.json");
  });

  it("refuses to run without a mode and a ref", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--mode", "release"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });
});

describe("pr mode", { timeout: 120_000 }, () => {
  // main already carries a CLI change with no bump; each pull request is
  // judged only on the packages its own diff touches.
  function withUnbumpedMain() {
    const repo = makeRepo();
    const base = repo.commit(
      { "cli/vr.mjs": "export const v = 2;\n" },
      "unbumped cli on main",
    );
    return { ...repo, base };
  }

  it("says nothing about a package the pull request does not touch", () => {
    const { dir, base, commit } = withUnbumpedMain();
    const head = commit(
      {
        "app/page.tsx": "export const z = 1;\n",
        "extension/tests/a.test.ts": "// x\n",
      },
      "pr",
    );
    const out = run({ cwd: dir, mode: "pr", ref: head, base });
    expect(out.code).toBe(0);
    expect(out.results).toEqual([]);
    expect(out.lines.join("\n")).not.toContain("::warning::");
  });

  it("warns, and still exits 0, when the pull request touches a package without a bump", () => {
    const { dir, base, commit } = withUnbumpedMain();
    const head = commit({ "cli/README.md": "# vr, again\n" }, "pr");
    const out = run({ cwd: dir, mode: "pr", ref: head, base });
    expect(out.code).toBe(0);
    expect(out.results.map((r) => r.name)).toEqual(["cli"]);
    expect(out.lines.join("\n")).toMatch(/::warning::cli /);
    expect(out.summary.join("\n")).toContain(
      "| cli | 1.0.0 | 1.0.0 | changed-same-version |",
    );
  });

  it("is quiet about a pull request that bumps what it touches", () => {
    const { dir, base, commit } = withUnbumpedMain();
    const head = commit(
      {
        "cli/README.md": "# vr, again\n",
        "cli/package.json": cliManifest("1.0.1"),
      },
      "pr",
    );
    const out = run({ cwd: dir, mode: "pr", ref: head, base });
    expect(out.lines.join("\n")).not.toContain("::warning::");
  });
});

describe("the npm content check", () => {
  function dirs(npm: Files, tag: Files) {
    const at = path.join(ROOT, `npm-${++repos}`);
    for (const [side, files] of [
      ["npm", npm],
      ["tag", tag],
    ] as const) {
      for (const [file, content] of Object.entries(files)) {
        if (content === null) continue;
        const full = path.join(at, side, file);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
    }
    return [path.join(at, "npm"), path.join(at, "tag")] as const;
  }
  const tag: Files = {
    "package.json": cliManifest("1.0.0"),
    "vr.mjs": "export const v = 1;\n",
    "README.md": "# vr\n",
    "vr.test.mjs": "// not shipped\n",
  };
  const npm: Files = { ...tag, "vr.test.mjs": null };

  it("passes when npm serves exactly the tag's shipped files", () => {
    expect(compareNpm(...dirs(npm, tag))).toEqual([]);
  });

  it("tolerates a reformatted manifest with the same content", () => {
    const reformatted = {
      ...npm,
      "package.json": JSON.stringify(JSON.parse(cliManifest("1.0.0"))),
    };
    expect(compareNpm(...dirs(reformatted, tag))).toEqual([]);
  });

  it("fails on a byte that differs, a file missing and a file extra", () => {
    expect(
      compareNpm(...dirs({ ...npm, "vr.mjs": "export const v = 2;\n" }, tag)),
    ).toEqual(["vr.mjs differs"]);
    expect(compareNpm(...dirs({ ...npm, "README.md": null }, tag))).toEqual([
      "README.md is shipped by the tag but not on npm",
    ]);
    expect(compareNpm(...dirs({ ...npm, "evil.mjs": "x\n" }, tag))).toEqual([
      "evil.mjs is on npm but not shipped by the tag",
    ]);
  });

  it("exits 1 as a process with the message the release job shows", () => {
    const [n, t] = dirs({ ...npm, "vr.mjs": "export const v = 2;\n" }, tag);
    const r = spawnSync(process.execPath, [SCRIPT, "--compare-npm", n, t], {
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      "vulnradar@1.0.0 on npm differs from the tag's cli/; bump cli/package.json.",
    );
  });
});
