import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * The integration tier: the only tests in this repository that execute real
 * SQL against a real PostgreSQL.
 *
 * It has its own config rather than living in the root vitest.config.ts
 * because it must NOT run by default. `npx vitest run` has to stay green for
 * a contributor with no database, so the root config excludes
 * tests/integration/** and this file is the only way in:
 *
 *   npx vitest run --config tests/integration/vitest.config.ts
 *
 * `root` points back at the repository so the `@/` alias, the include glob
 * and every relative import behave exactly as they do in the unit suite.
 *
 * Everything runs in ONE fork, sequentially. These suites share a single
 * database: several of them (the cleanup prunes especially) assert on rows
 * they did not create, so two files running at once would see each other's
 * fixtures. Sequential is also fast enough here, this tier is a handful of
 * files rather than four hundred.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export default defineConfig({
  root: REPO_ROOT,
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Builds the schema once per run by executing the real instrumentation.ts
    // boot path. See _global-setup.ts for why it is the real register() and
    // not an extracted copy of the DDL.
    globalSetup: ["tests/integration/_global-setup.ts"],
    // Runs inside the worker BEFORE any test file is imported, which is the
    // last moment DATABASE_URL can still be redirected: lib/database/db.ts
    // builds its Pool at module scope.
    setupFiles: ["tests/integration/_setup.ts"],
    pool: "forks",
    // Both, and neither is redundant. `fileParallelism: false` is what stops
    // two test FILES running at once, which is the interference that matters
    // here: these suites share one database and one schema, and cleanup.ts's
    // retention deletes are global. `maxWorkers: 1` caps the pool that runs
    // them so a single fork does all the work. (vitest 4 has no `minWorkers`
    // in InlineConfig, only `maxWorkers`.)
    maxWorkers: 1,
    fileParallelism: false,
    // Real connections, real locks, real concurrency races. The unit suite's
    // 5s default is not a meaningful budget here.
    testTimeout: 60_000,
    // The bootstrap runs ~320 DDL statements plus the boot path's own checks.
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": REPO_ROOT,
    },
  },
});
