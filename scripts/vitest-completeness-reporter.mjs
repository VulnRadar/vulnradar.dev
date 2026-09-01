import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Fails the run when vitest collected fewer test files than exist on disk.
 *
 * The forks pool intermittently fails to start a worker. When that happens
 * vitest reports only the files that did run and still **exits 0**, so a run
 * that silently skipped several files is indistinguishable from a clean one.
 * Observed repeatedly on this suite: 356 files on disk, with runs reporting
 * 356, 353, 352 and 349, every one of them "passing". A suite that quietly
 * shrinks is worse than one that fails, because the lost coverage is
 * invisible and every conclusion drawn from the run is unsound.
 *
 * This compares files-run against files-on-disk and turns a shortfall into a
 * hard error. It deliberately does not try to prevent the worker failure; it
 * makes it impossible to miss.
 *
 * Filtered runs (`vitest run some/path`) legitimately execute a subset, so the
 * check only applies when the whole suite was requested.
 */
const ROOT = resolve(import.meta.dirname, "..");
const TESTS_DIR = join(ROOT, "tests");

/**
 * tests/integration/ is excluded from the root config's `include`, so its
 * files are on disk but are never part of a default run. Counting them here
 * would make every unit run report a shortfall and fail, which is the exact
 * false alarm this reporter exists to avoid producing. That tier has its own
 * config (tests/integration/vitest.config.ts) and does not use this reporter:
 * it is a handful of files run in one fork, so a silently-dropped worker is
 * not the failure mode it has.
 */
const UNCOUNTED_DIRS = new Set(["integration"]);

function countTestFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (dir === TESTS_DIR && UNCOUNTED_DIRS.has(entry)) continue;
      n += countTestFiles(full);
    } else if (/\.(test|spec)\.ts$/.test(entry)) {
      n += 1;
    }
  }
  return n;
}

export default class CompletenessReporter {
  constructor() {
    // Read the invocation directly rather than off the reporter context: the
    // shape of ctx.config differs between vitest majors, and getting this
    // wrong in the permissive direction would make the guard fire on every
    // filtered run (noise), while the strict direction disables it silently.
    // argv is stable. Anything positional after `run`/`watch`/`related` that
    // is not a flag is a path or name filter.
    const argv = process.argv.slice(2);
    const SUBCOMMANDS = new Set(["run", "watch", "related", "bench", "dev"]);
    this.filtered = argv.some(
      (a, i) =>
        !a.startsWith("-") &&
        !SUBCOMMANDS.has(a) &&
        // skip a value that belongs to the preceding flag, e.g. `--reporter x`
        !(i > 0 && argv[i - 1].startsWith("-") && !argv[i - 1].includes("=")),
    );
  }

  check(ranCount) {
    if (this.filtered || this.reported) return;

    let onDisk;
    try {
      onDisk = countTestFiles(TESTS_DIR);
    } catch {
      return; // cannot read the tree: stay out of the way
    }
    if (ranCount >= onDisk) return;

    this.reported = true;
    const missing = onDisk - ranCount;
    console.error(
      `\n\x1b[31m\x1b[1mINCOMPLETE TEST RUN\x1b[0m\n` +
        `  ${ranCount} test files ran, but ${onDisk} exist under tests/.\n` +
        `  ${missing} file${missing === 1 ? "" : "s"} never executed, ` +
        `almost certainly a forks worker that failed to start.\n` +
        `  This run proves nothing about the missing files. Re-run it.\n`,
    );

    // Setting process.exitCode here is not enough: vitest assigns its own
    // exit code after reporters finish, so it overwrites this back to 0 and
    // the run still reports success (observed: the message printed above an
    // "exited with code 0"). Forcing it from an `exit` listener runs last and
    // does take effect, which is what makes the guard actually gate CI rather
    // than just print a warning nobody's pipeline acts on.
    process.exitCode = 1;
    process.once("exit", () => process.exit(1));
  }

  // vitest 4's reporter lifecycle. `onFinished` is the pre-4 name and is kept
  // so the guard survives a version move in either direction.
  onTestRunEnd(testModules = []) {
    this.check(testModules.length);
  }

  onFinished(files = []) {
    this.check(files.length);
  }
}
