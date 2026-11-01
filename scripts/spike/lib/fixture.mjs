import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const FIXTURE_SRC = path.join(REPO_ROOT, "tests/spike/fixture");
export const IMAGE_DOCKERFILE = path.join(REPO_ROOT, "tests/spike/Dockerfile");

/**
 * The versions the fixture runs on are read from the root package.json, not
 * restated, so the spike cannot drift from the app it is a model of.
 */
export function pinnedVersions() {
  const pkg = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  const pick = (name) => {
    const range = pkg.dependencies?.[name];
    if (!range || !/^\d+\.\d+\.\d+$/.test(range)) {
      throw new Error(
        `package.json must pin ${name} to an exact version, found ${range}`,
      );
    }
    return range;
  };
  return {
    next: pick("next"),
    react: pick("react"),
    reactDom: pick("react-dom"),
  };
}

export function fixturePackageJson() {
  const v = pinnedVersions();
  return {
    name: "vulnradar-spike-fixture",
    private: true,
    scripts: { dev: "next dev", build: "next build", start: "next start" },
    dependencies: { next: v.next, react: v.react, "react-dom": v.reactDom },
  };
}

/**
 * Remove a node_modules link from an earlier run before the directory is
 * deleted, so cleaning up can never reach through it into the tree it points
 * at (the repository's real node_modules, on a local run).
 */
export function unlinkIfLink(file) {
  try {
    if (lstatSync(file).isSymbolicLink()) unlinkSync(file);
  } catch {
    // Nothing there, which is the normal first run.
  }
}

/**
 * npm install the three pinned packages once into `dir`, the way the image
 * build does (no lifecycle scripts, no lockfile), and return the node_modules
 * path. Every target links to it instead of installing again.
 */
export function installDependencies(dir) {
  const existing = path.join(dir, "node_modules");
  try {
    const have = JSON.parse(
      readFileSync(path.join(existing, "next/package.json"), "utf8"),
    ).version;
    if (have === pinnedVersions().next) return existing;
  } catch {
    // Not installed yet, or unreadable: install from scratch below.
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify(fixturePackageJson(), null, 2)}\n`,
  );
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      "--no-package-lock",
      "--loglevel=error",
    ],
    { cwd: dir, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (result.status !== 0) throw new Error(`npm install failed in ${dir}`);
  return path.join(dir, "node_modules");
}

/** The repository's own node_modules, for quick local runs. */
export function repositoryNodeModules() {
  const target = path.join(REPO_ROOT, "node_modules");
  if (!existsSync(path.join(target, "next/package.json"))) {
    throw new Error(`no node_modules at ${target}; run with --install`);
  }
  return target;
}

/**
 * Copy the fixture into a scratch directory outside the repository, so build
 * output never lands in the working tree (ESLint and Prettier would otherwise
 * walk into .next) and a stale build cannot leak between runs.
 *
 * `nodeModulesFrom` is linked in as node_modules. The image target passes
 * null, because its Dockerfile installs the packages itself.
 */
export function prepareWorkdir({ workdir, nodeModulesFrom }) {
  unlinkIfLink(path.join(workdir, "node_modules"));
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
  cpSync(FIXTURE_SRC, workdir, { recursive: true });
  writeFileSync(
    path.join(workdir, "package.json"),
    `${JSON.stringify(fixturePackageJson(), null, 2)}\n`,
  );
  if (nodeModulesFrom) {
    symlinkSync(
      nodeModulesFrom,
      path.join(workdir, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}

export function nextBin(workdir) {
  const require = createRequire(path.join(workdir, "package.json"));
  return require.resolve("next/dist/bin/next");
}

export function installedNextVersion(workdir) {
  const require = createRequire(path.join(workdir, "package.json"));
  return require("next/package.json").version;
}

/** The files the Docker build needs beside the fixture sources. */
export function prepareImageContext({ workdir }) {
  cpSync(IMAGE_DOCKERFILE, path.join(workdir, "Dockerfile"));
  writeFileSync(path.join(workdir, ".dockerignore"), "node_modules\n.next\n");
}
