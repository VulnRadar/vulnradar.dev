import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Guards the check that decides whether a script does its job at all.
 *
 * `scripts/backup-db.mjs` and `scripts/restore-db.mjs` both ended with
 *
 *     if (import.meta.url === `file://${process.argv[1]}`) { run(); }
 *
 * On Linux that happens to be true: `process.argv[1]` is `/app/scripts/x.mjs`,
 * so the template yields `file:///app/scripts/x.mjs`, which is exactly what
 * `import.meta.url` holds. On Windows `process.argv[1]` is
 * `C:\repo\scripts\x.mjs`, the template yields `file://C:\repo\scripts\x.mjs`,
 * and `import.meta.url` is `file:///C:/repo/scripts/x.mjs`. Those can never be
 * equal, so the body never ran.
 *
 * The failure is silent in the worst possible way. `npm run db:backup` printed
 * nothing, exited 0, and lib/backup/run-backup.ts reads exit 0 as success, so
 * the admin panel recorded a completed backup that does not exist. You would
 * find out when you tried to restore.
 *
 * `pathToFileURL` normalises the drive letter and the separators, so it is
 * correct on every platform. This test fails on any script that goes back to
 * hand-building the URL.
 */

function scriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...scriptFiles(full));
    else if (/\.(mjs|js)$/.test(full)) out.push(full);
  }
  return out;
}

const SCRIPTS = scriptFiles("scripts");

describe("script main-module guards", () => {
  it("finds the scripts", () => {
    expect(SCRIPTS.length).toBeGreaterThan(5);
  });

  it.each(SCRIPTS)("%s does not hand-build a file:// URL", (file) => {
    const src = readFileSync(file, "utf8");
    expect(
      src,
      `${file} compares import.meta.url against a "file://" template built ` +
        `from process.argv[1]. That is false on Windows for every path, so ` +
        `the script silently does nothing and still exits 0. Use ` +
        `pathToFileURL(process.argv[1]).href instead.`,
    ).not.toMatch(/["'`]file:\/\/\$\{\s*process\.argv\[1\]\s*\}/);
  });

  it("the executable scripts still have a working guard", () => {
    // The two that regressed, plus proof the replacement is actually correct
    // rather than merely different: this is the comparison they now make, run
    // here on this platform.
    for (const file of ["scripts/backup-db.mjs", "scripts/restore-db.mjs"]) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} lost its main-module guard`).toMatch(
        /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/,
      );
      expect(src, `${file} must import pathToFileURL to use it`).toMatch(
        /import \{[^}]*pathToFileURL[^}]*\} from "node:url"/,
      );
    }

    const self = "scripts/backup-db.mjs";
    expect(
      pathToFileURL(self).href.startsWith("file:///"),
      "pathToFileURL must produce a three-slash file URL on this platform, " +
        "which is what import.meta.url holds",
    ).toBe(true);
  });
});
