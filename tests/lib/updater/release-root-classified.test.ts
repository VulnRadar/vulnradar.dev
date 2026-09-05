import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  PROTECTED_PREFIXES,
  STRIP_PREFIXES,
} from "@/lib/updater/release-paths";

/**
 * Every root-level path in the release tarball has to be a decision.
 *
 * The updater copies the release tree over a live install and then prunes
 * everything the release no longer ships plus everything in STRIP_PREFIXES.
 * A new root-level file therefore lands in every self-hosted install by
 * default, and the failure mode is silent: nobody notices that the CLI, the
 * browser extension source, the test suite and the CI workflows have been
 * sitting in production installs for eight releases, because nothing breaks.
 *
 * So the list of things we deliberately keep is written down here, and this
 * fails when the repository root grows something that is in neither list.
 * The fix when it fails is to decide, not to add the name here by reflex:
 * add it to STRIP_PREFIXES if a running install has no use for it, and to
 * KEPT_AT_ROOT with the reason if it does.
 */
const KEPT_AT_ROOT: Record<string, string> = {
  // The application itself.
  app: "the app",
  components: "the app",
  hooks: "the app",
  lib: "the app",
  public: "static assets served at runtime",
  middleware: "middleware.ts, loaded by next start",
  "middleware.ts": "loaded by next start",
  "instrumentation.ts": "the boot path: schema creation runs from here",
  scripts: "operator tooling, and npm run build compiles knowledge with it",

  // Needed to build. The update runs npm ci and npm run build in place.
  "package.json": "npm ci and npm start read it",
  "package-lock.json": "npm ci reads it",
  "next.config.mjs": "next build reads it",
  "tsconfig.json": "next build typechecks with it",
  "postcss.config.mjs": "the CSS pipeline reads it",
  "tailwind.config.mjs": "the CSS pipeline reads it",
  "globals.d.ts": "in tsconfig's include; next build typechecks it",
  "next-env.d.ts": "next regenerates it, and typechecking wants it present",
  ".npmrc": "npm ci behaviour during the update",
  ".node-version": "hosts that pick a Node version from it",
  ".nvmrc": "hosts that pick a Node version from it",

  // Documents an operator is sent to by name, in their own install.
  "README.md": "the first thing someone opens in the install directory",
  "SECURITY.md": "the self-hosting docs name it at the repo root",
  ".env.example": "the template the docs tell you to copy to .env",

  // A documented way to run the database, and the app image alongside it.
  "docker-compose.yml": "documented way to run Postgres and the app",
  "docker-compose.dev.yml": "documented development database",

  // Git plumbing. Kept deliberately: an install that was `git clone`d and
  // then stripped of .gitignore turns .env into an untracked file someone
  // can commit, which is the exact accident these rules exist to stop.
  ".gitignore": "removing it from a cloned install makes .env committable",
  ".gitattributes": "pairs with .gitignore in a cloned install",
};

/**
 * The distinct first path segment of every tracked file.
 *
 * `git ls-files` and not `git ls-tree HEAD`, because the index is what the
 * next commit ships and HEAD is what the last one did. A path staged for
 * removal should stop failing this immediately and a path just added should
 * start failing it immediately, which is the only timing that makes the guard
 * useful while a change is being made rather than after it landed.
 */
function trackedRootEntries(): string[] {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const out = execFileSync("git", ["ls-files"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const roots = new Set<string>();
  for (const line of out.split("\n")) {
    const rel = line.trim();
    if (rel) roots.add(rel.split("/")[0]);
  }
  return [...roots].sort();
}

describe("the release tarball's root is fully classified", () => {
  const entries = trackedRootEntries();

  it("finds a repository to read", () => {
    // Guards the whole file: an empty listing would make every assertion
    // below pass while checking nothing.
    expect(entries.length).toBeGreaterThan(20);
    expect(entries).toContain("package.json");
  });

  it("has a decision recorded for every root-level path", () => {
    const undecided = entries.filter(
      (e) =>
        !(e in KEPT_AT_ROOT) &&
        !STRIP_PREFIXES.includes(e) &&
        !PROTECTED_PREFIXES.includes(e),
    );
    expect(
      undecided,
      `${undecided.join(", ")} ship to every self-hosted install and are in ` +
        "neither STRIP_PREFIXES nor KEPT_AT_ROOT. Decide which, in " +
        "lib/updater/apply.ts and here.",
    ).toEqual([]);
  });

  it("never both keeps and strips the same path", () => {
    const both = Object.keys(KEPT_AT_ROOT).filter((k) =>
      STRIP_PREFIXES.includes(k),
    );
    expect(both).toEqual([]);
  });

  it("does not strip anything the app needs to build or boot", () => {
    // The prune DELETES these from a live install, so a mistake here is not
    // a tidiness bug, it is an install that cannot rebuild itself.
    for (const essential of [
      "package.json",
      "package-lock.json",
      "next.config.mjs",
      "tsconfig.json",
      "instrumentation.ts",
      "middleware.ts",
      "app",
      "lib",
      "scripts",
      "public",
    ]) {
      expect(STRIP_PREFIXES).not.toContain(essential);
    }
  });

  it("keeps no database dump in the tree", () => {
    // An encrypted production dump was committed to backups/ and shipped
    // inside the v3.8.1 tarball. The ignore rules now cover it; this is the
    // assertion that says so out loud.
    const dumps = entries.filter(
      (e) => e === "backups" || /\.sql(\.gz)?(\.enc)?$/.test(e),
    );
    expect(dumps).toEqual([]);
  });
});
