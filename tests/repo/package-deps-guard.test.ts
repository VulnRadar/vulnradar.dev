import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * What an install runs, and what a production install contains.
 *
 * `npm ci` executes the install script of every package that declares one, so
 * a new entry in that list is new code running on every developer machine and
 * CI runner. The scripts stay on (owner decision D8: native packages need
 * them), which makes this list the control: a dependency change that adds an
 * install script fails here and somebody has to read it.
 *
 * package-lock.json is edited by hand in this repository, because regenerating
 * it on Windows strips the Linux native bindings, so these tests also hold the
 * hand edits to what npm itself would have written.
 */

const ROOT = path.resolve(__dirname, "../..");
const readJson = (rel: string) =>
  JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

interface LockEntry {
  version?: string;
  dev?: boolean;
  optional?: boolean;
  hasInstallScript?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const pkg = readJson("package.json") as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  allowScripts?: Record<string, boolean>;
};
const lock = readJson("package-lock.json") as {
  packages: Record<string, LockEntry>;
};
const entries = lock.packages;
const root = entries[""];

const INSTALL_SCRIPTS = [
  "node_modules/@parcel/watcher",
  "node_modules/core-js",
  "node_modules/fsevents",
  "node_modules/next-intl/node_modules/@swc/core",
  "node_modules/unrs-resolver",
];

const TEST_TOOLS = ["vitest", "@vitest/coverage-v8", "vite"];

/** Node's lookup: the nearest node_modules on the way up from `from`. */
function resolve(from: string, name: string): string | null {
  let base = from;
  for (;;) {
    const candidate = `${base ? `${base}/` : ""}node_modules/${name}`;
    if (entries[candidate]) return candidate;
    if (!base) return null;
    base = base.slice(0, base.lastIndexOf("node_modules/")).replace(/\/$/, "");
  }
}

/** Everything an `npm ci --omit=dev` keeps, walked from the root. */
function productionClosure(): Set<string> {
  const seen = new Set<string>();
  const queue = [
    ...Object.keys(root.dependencies ?? {}).map((n) => resolve("", n)),
    ...Object.keys(root.optionalDependencies ?? {}).map((n) => resolve("", n)),
  ];
  while (queue.length > 0) {
    const at = queue.pop();
    if (!at || seen.has(at)) continue;
    seen.add(at);
    const entry = entries[at];
    for (const name of [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
    ]) {
      queue.push(resolve(at, name));
    }
  }
  return seen;
}

describe("the lockfile's install scripts", () => {
  it("are exactly the reviewed list", () => {
    const actual = Object.entries(entries)
      .filter(([, e]) => e.hasInstallScript)
      .map(([location]) => location)
      .sort();
    expect(actual).toEqual([...INSTALL_SCRIPTS].sort());
  });

  it("are all named in the Dockerfile's inventory", () => {
    const dockerfile = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    for (const location of INSTALL_SCRIPTS) {
      const name = location.slice(location.lastIndexOf("node_modules/") + 13);
      expect(dockerfile, name).toContain(name);
    }
  });

  it("keep the allowScripts block the owner decided to keep", () => {
    expect(pkg.allowScripts).toBeDefined();
  });
});

describe("test tooling stays out of a production install", () => {
  it("is not declared in dependencies", () => {
    for (const name of TEST_TOOLS) {
      expect(Object.keys(pkg.dependencies), name).not.toContain(name);
    }
  });

  it("declares vitest and its coverage plugin as devDependencies", () => {
    expect(Object.keys(pkg.devDependencies)).toEqual(
      expect.arrayContaining(["vitest", "@vitest/coverage-v8"]),
    );
  });

  it("is flagged dev in the lockfile", () => {
    for (const name of TEST_TOOLS) {
      expect(entries[`node_modules/${name}`]?.dev, name).toBe(true);
    }
  });

  it("is unreachable from the production dependencies", () => {
    for (const location of productionClosure()) {
      expect(location).not.toMatch(
        /(^|\/)node_modules\/(vitest|vite|rolldown|@vitest\/[^/]+)$/,
      );
    }
  });
});

describe("package-lock.json agrees with package.json", () => {
  it("lists the same dependencies at the root", () => {
    expect(root.dependencies).toEqual(pkg.dependencies);
    expect(root.devDependencies).toEqual(pkg.devDependencies);
  });

  it("flags nothing dev that a production install still needs", () => {
    for (const location of productionClosure()) {
      expect(entries[location].dev, location).toBeUndefined();
    }
  });

  it("has every root dependency resolved", () => {
    for (const name of [
      ...Object.keys(pkg.dependencies),
      ...Object.keys(pkg.devDependencies),
    ]) {
      expect(entries[`node_modules/${name}`], name).toBeDefined();
    }
  });

  it("carries no dependency nothing imports", () => {
    // Owner decision D3. components/ui has no hover-card wrapper.
    expect(Object.keys(pkg.dependencies)).not.toContain(
      "@radix-ui/react-hover-card",
    );
    expect(
      Object.keys(entries).filter((l) => l.includes("react-hover-card")),
    ).toEqual([]);
  });

  it("still carries the Linux native bindings a Windows regeneration strips", () => {
    for (const name of [
      "@next/swc-linux-x64-gnu",
      "@img/sharp-linux-x64",
      "@tailwindcss/oxide-linux-x64-gnu",
      "lightningcss-linux-x64-gnu",
    ]) {
      expect(entries[`node_modules/${name}`], name).toBeDefined();
    }
  });
});

describe("package.json scripts", () => {
  it("starts the server the image copies", () => {
    expect(pkg.scripts.start).toBe("node server.mjs");
  });

  it("drops the one-off avatar migration, which the boot backfill replaced", () => {
    expect(pkg.scripts["db:migrate-avatars"]).toBeUndefined();
  });
});
