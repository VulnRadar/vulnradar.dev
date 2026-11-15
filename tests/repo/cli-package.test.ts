import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { jobsOf, readWorkflow } from "./_workflow-steps";

/**
 * What npm publishes as `vulnradar` is the files cli/package.json lists, and
 * nothing else. The CLI's own suite runs against the source tree, where every
 * module is present, so a new module that nobody added to `files` would pass
 * every test and ship a package that dies with ERR_MODULE_NOT_FOUND on the
 * first run. These checks read the package the way `npm pack` does.
 *
 * The CLI job in ci.yml installs the packed tarball on three operating
 * systems and runs it; this is the part of that proof that needs no runner.
 */

const ROOT = path.resolve(__dirname, "../..");
const CLI = path.join(ROOT, "cli");

const pkg = JSON.parse(
  readFileSync(path.join(CLI, "package.json"), "utf8"),
) as {
  bin: Record<string, string>;
  files: string[];
  engines: { node: string };
  dependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
};

/** Relative specifiers of every static import and re-export in a module. */
function relativeImports(source: string): string[] {
  const found: string[] = [];
  const from =
    /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g;
  const bare = /(?:^|\n)\s*import\s*["'](\.{1,2}\/[^"']+)["']/g;
  for (const re of [from, bare]) {
    for (const m of source.matchAll(re)) found.push(m[1]);
  }
  return found;
}

describe("cli/package.json files", () => {
  it("lists only files that exist", () => {
    for (const file of pkg.files) {
      expect(existsSync(path.join(CLI, file)), file).toBe(true);
    }
  });

  it("includes every module a published file imports", () => {
    // package.json is always in the tarball, whatever `files` says.
    const published = new Set([...pkg.files, "package.json"]);
    const modules = pkg.files.filter((f) => /[.]m?js$/.test(f));
    expect(modules.length).toBeGreaterThan(0);
    for (const file of modules) {
      const source = readFileSync(path.join(CLI, file), "utf8");
      for (const spec of relativeImports(source)) {
        const target = path.posix.normalize(
          path.posix.join(path.posix.dirname(file), spec),
        );
        expect(
          published.has(target),
          `${file} imports ${spec}, which is not in "files"`,
        ).toBe(true);
      }
    }
  });

  it("includes the file bin points at", () => {
    expect(Object.keys(pkg.bin)).toEqual(["vulnradar"]);
    expect(pkg.files).toContain(pkg.bin.vulnradar);
  });

  it("finds the imports it is meant to check", () => {
    // A reader that matched nothing would pass the test above for any file.
    const entry = readFileSync(path.join(CLI, pkg.bin.vulnradar), "utf8");
    expect(relativeImports(entry)).toContain("./lib.mjs");
  });
});

describe("cli/package.json dependencies", () => {
  it("has none, which is what lets the tarball run on any Node", () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });
});

describe("the CLI job in ci.yml", () => {
  const job = jobsOf(readWorkflow("ci.yml")).find((j) => j.id === "cli-matrix");

  it("exists", () => {
    expect(job).toBeDefined();
  });

  it("tests the engines floor", () => {
    const floor = /^>=(\d+[.]\d+[.]\d+)$/.exec(pkg.engines.node)?.[1];
    expect(floor, "engines.node is >=<exact patch>").toEqual(
      expect.any(String),
    );
    expect(job!.strategy).toContain(`version: "${floor}"`);
  });

  it("runs on Linux, Windows and macOS", () => {
    for (const os of ["ubuntu-latest", "windows-latest", "macos-latest"]) {
      expect(job!.strategy).toContain(os);
    }
  });

  it("has one aggregate job named CLI that waits for every leg", () => {
    const jobs = jobsOf(readWorkflow("ci.yml"));
    const aggregate = jobs.find((j) => j.name === "CLI");
    expect(aggregate?.id).toBe("cli");
    expect(aggregate?.needs).toBe("[cli-matrix]");
    expect(aggregate?.condition).toBe("always()");
    expect(aggregate?.code).toContain("needs.cli-matrix.result");
  });
});
