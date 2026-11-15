#!/usr/bin/env node
// Checks each separately shipped package (the CLI on npm, the browser
// extension in the stores) against the last stable release: a package whose
// shipped files changed must carry a higher version than it shipped with.
//
//   node scripts/ci/package-versions.mjs --mode release --ref v4.0.0
//   node scripts/ci/package-versions.mjs --mode pr --ref <head> --base <base>
//   node scripts/ci/package-versions.mjs --compare-npm <npm-dir> <tag-cli-dir>
//
// release: exits 1 on a package that changed without a bump, went down, or
// carries a version that is not semver. pr: reports the same as warnings, only
// for packages the pull request's own diff touches, and always exits 0.
// --compare-npm: exits 1 when the files npm serves under a version differ from
// the tag's cli/ files, so one version never names two sets of bytes.
//
// No dependencies, and every git call takes its arguments as an array: refs
// arrive from the workflow's environment.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SEMVER = /^([0-9]+)[.]([0-9]+)[.]([0-9]+)(-[0-9A-Za-z.-]+)?$/;
const STABLE_TAG = /^v[0-9]+[.][0-9]+[.][0-9]+$/;

/** Outcomes that fail a release. */
export const FAILING = [
  "changed-same-version",
  "version-went-down",
  "invalid-version",
];

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function gitMaybe(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

/** Every tracked file under `dir` at `ref`, with its blob id, in one call. */
function filesAt(cwd, ref, dir) {
  const out = git(cwd, ["ls-tree", "-r", "--full-tree", ref, "--", `${dir}/`]);
  const files = new Map();
  if (out === "") return files;
  for (const line of out.split("\n")) {
    // <mode> SP <type> SP <object> TAB <path>
    const tab = line.indexOf(String.fromCharCode(9));
    const object = line.slice(0, tab).split(" ")[2];
    files.set(line.slice(tab + 1), object);
  }
  return files;
}

function manifestAt(cwd, ref, file) {
  const text = gitMaybe(cwd, ["show", `${ref}:${file}`]);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The manifest with its version left out, so a bump alone is no change. */
function withoutVersion(manifest) {
  if (manifest === null) return null;
  const rest = { ...manifest };
  delete rest.version;
  return JSON.stringify(rest);
}

/**
 * The packages and the files each one ships. `shipped` gets a tracked path
 * and that ref's manifest; the manifest itself is compared without its
 * version, and `lockfile`, when there is one, is reported but never failed:
 * a toolchain bump can change it without changing what the package does.
 */
export const PACKAGES = [
  {
    name: "cli",
    dir: "cli",
    manifest: "cli/package.json",
    lockfile: null,
    shipped(file, manifest) {
      const entries = Array.isArray(manifest?.files) ? manifest.files : [];
      return entries.some((entry) => {
        const at = `cli/${String(entry)
          .replace(/^[.][/]/, "")
          .replace(/[/]+$/, "")}`;
        return file === at || file.startsWith(`${at}/`);
      });
    },
  },
  {
    name: "extension",
    dir: "extension",
    manifest: "extension/package.json",
    lockfile: "extension/package-lock.json",
    shipped(file) {
      return (
        ["src/", "manifest/", "public/", "scripts/"].some((p) =>
          file.startsWith(`extension/${p}`),
        ) ||
        ["extension/vite.config.ts", "extension/tsconfig.json"].includes(file)
      );
    },
  },
];

/** -1, 0 or 1. A prerelease sorts below its release. */
export function compareVersions(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`not a version: ${pa ? b : a}`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa[4] === pb[4]) return 0;
  if (!pa[4]) return 1;
  if (!pb[4]) return -1;
  return pa[4] < pb[4] ? -1 : 1;
}

/** The newest stable release tag reachable from the parent of `ref`. */
export function previousRelease(cwd, ref) {
  const tag = gitMaybe(cwd, [
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v[0-9]*",
    "--exclude",
    "*-*",
    `${ref}^`,
  ]);
  if (tag === null || !STABLE_TAG.test(tag)) return null;
  return tag;
}

/** What changed in one package between `from` and `to`, and its outcome. */
export function checkPackage(cwd, pkg, from, to) {
  const before = manifestAt(cwd, from, pkg.manifest);
  const after = manifestAt(cwd, to, pkg.manifest);
  const fromFiles = filesAt(cwd, from, pkg.dir);
  const toFiles = filesAt(cwd, to, pkg.dir);
  const paths = new Set();
  for (const [files, manifest] of [
    [fromFiles, before],
    [toFiles, after],
  ]) {
    for (const file of files.keys()) {
      if (pkg.shipped(file, manifest)) paths.add(file);
    }
  }
  const changed = [...paths]
    .filter((file) => fromFiles.get(file) !== toFiles.get(file))
    .sort();
  if (withoutVersion(before) !== withoutVersion(after))
    changed.push(pkg.manifest);
  const lockfileChanged =
    pkg.lockfile !== null &&
    fromFiles.get(pkg.lockfile) !== toFiles.get(pkg.lockfile);

  const fromVersion = before?.version ?? null;
  const toVersion = after?.version ?? null;
  let outcome;
  if (typeof toVersion !== "string" || !SEMVER.test(toVersion))
    outcome = "invalid-version";
  else if (typeof fromVersion !== "string" || !SEMVER.test(fromVersion))
    outcome = "bumped";
  else {
    const order = compareVersions(toVersion, fromVersion);
    if (order < 0) outcome = "version-went-down";
    else if (order > 0) outcome = "bumped";
    else outcome = changed.length > 0 ? "changed-same-version" : "unchanged";
  }
  return {
    name: pkg.name,
    outcome,
    from: fromVersion,
    to: toVersion,
    changed,
    lockfileChanged,
  };
}

/** The files the pull request's own diff touches. */
function diffFiles(cwd, base, ref) {
  const out = git(cwd, ["diff", "--name-only", `${base}...${ref}`]);
  return out === "" ? [] : out.split("\n");
}

function touches(pkg, files, cwd, ref) {
  const manifest = manifestAt(cwd, ref, pkg.manifest);
  return files.some(
    (file) =>
      file === pkg.manifest ||
      file === pkg.lockfile ||
      pkg.shipped(file, manifest),
  );
}

/**
 * Runs the check and returns what to print and the exit code, so the test
 * can drive it without a process.
 */
export function run({ cwd, mode, ref, base }) {
  const lines = [];
  const summary = [];
  const previous = previousRelease(cwd, ref);
  if (previous === null) {
    lines.push(
      `::error::No stable release tag (vX.Y.Z) is reachable from ${ref}^, so there is nothing to compare with.`,
    );
    return { code: mode === "release" ? 1 : 0, lines, summary, results: [] };
  }
  const prFiles = mode === "pr" ? diffFiles(cwd, base, ref) : null;
  const results = [];
  for (const pkg of PACKAGES) {
    if (prFiles !== null && !touches(pkg, prFiles, cwd, ref)) continue;
    results.push(checkPackage(cwd, pkg, previous, ref));
  }

  let code = 0;
  summary.push(
    `### Package versions against ${previous}`,
    "",
    "| Package | Shipped | Here | Outcome |",
    "|---|---|---|---|",
  );
  for (const r of results) {
    const versions = `${r.name} ${r.from ?? "(none)"} at ${previous}, ${r.to ?? "(none)"} at ${ref}`;
    summary.push(
      `| ${r.name} | ${r.from ?? ""} | ${r.to ?? ""} | ${r.outcome}${r.lockfileChanged ? ", lockfile changed" : ""} |`,
    );
    if (FAILING.includes(r.outcome)) {
      const why = {
        "changed-same-version": `its shipped files changed (${r.changed.slice(0, 5).join(", ")}${r.changed.length > 5 ? ", ..." : ""}) but its version did not`,
        "version-went-down": "its version went down",
        "invalid-version": "its version is not a plain semver",
      }[r.outcome];
      if (mode === "release") {
        lines.push(
          `::error::${versions}: ${why}. Bump ${PACKAGES.find((p) => p.name === r.name).manifest}.`,
        );
        code = 1;
      } else {
        lines.push(
          `::warning::${versions}: ${why}. Bump it before the next release, or the release build fails.`,
        );
      }
    } else {
      lines.push(`${versions}: ${r.outcome}`);
    }
    if (r.lockfileChanged) {
      lines.push(
        `::notice::${r.name}'s lockfile changed since ${previous}. That alone never fails; whether it needs a bump is the owner's call.`,
      );
    }
  }
  if (results.length === 0)
    lines.push(`No shipped package is touched (compared with ${previous}).`);
  return { code, lines, summary, results };
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      for (const inner of listFiles(full)) out.push(path.join(entry, inner));
    } else out.push(entry);
  }
  return out.map((f) => f.split(path.sep).join("/")).sort();
}

/**
 * Compares the package npm serves with the tag's cli/: the same files, the
 * same bytes, and the same manifest. Returns the differences.
 */
export function compareNpm(npmDir, cliDir) {
  const manifest = JSON.parse(
    readFileSync(path.join(cliDir, "package.json"), "utf8"),
  );
  const shippedPkg = PACKAGES.find((p) => p.name === "cli");
  const fromTag = listFiles(cliDir)
    .filter(
      (f) => f === "package.json" || shippedPkg.shipped(`cli/${f}`, manifest),
    )
    .sort();
  const fromNpm = listFiles(npmDir);
  const diffs = [];
  for (const f of fromNpm)
    if (!fromTag.includes(f))
      diffs.push(`${f} is on npm but not shipped by the tag`);
  for (const f of fromTag)
    if (!fromNpm.includes(f))
      diffs.push(`${f} is shipped by the tag but not on npm`);
  for (const f of fromTag.filter((t) => fromNpm.includes(t))) {
    const a = readFileSync(path.join(npmDir, f));
    const b = readFileSync(path.join(cliDir, f));
    if (f === "package.json") {
      if (
        JSON.stringify(JSON.parse(a.toString("utf8"))) !==
        JSON.stringify(JSON.parse(b.toString("utf8")))
      ) {
        diffs.push("package.json differs");
      }
    } else if (!a.equals(b)) diffs.push(`${f} differs`);
  }
  return diffs;
}

function argValue(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

function main(argv) {
  if (argv.includes("--compare-npm")) {
    const [npmDir, cliDir] = argv.slice(argv.indexOf("--compare-npm") + 1);
    if (!npmDir || !cliDir) {
      console.error(
        "usage: package-versions.mjs --compare-npm <npm-package-dir> <tag-cli-dir>",
      );
      return 2;
    }
    const manifest = JSON.parse(
      readFileSync(path.join(cliDir, "package.json"), "utf8"),
    );
    const diffs = compareNpm(npmDir, cliDir);
    if (diffs.length > 0) {
      for (const d of diffs) console.log(`  ${d}`);
      console.log(
        `::error::vulnradar@${manifest.version} on npm differs from the tag's cli/; bump cli/package.json.`,
      );
      return 1;
    }
    console.log(
      `vulnradar@${manifest.version} on npm carries exactly the tag's cli/ files.`,
    );
    return 0;
  }
  const mode = argValue(argv, "--mode");
  const ref = argValue(argv, "--ref");
  const base = argValue(argv, "--base");
  if (!["release", "pr"].includes(mode) || !ref || (mode === "pr" && !base)) {
    console.error(
      "usage: package-versions.mjs --mode release|pr --ref <ref> [--base <ref>]",
    );
    return 2;
  }
  const result = run({ cwd: process.cwd(), mode, ref, base });
  for (const line of result.lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${result.summary.join("\n")}\n`,
    );
  }
  return result.code;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
