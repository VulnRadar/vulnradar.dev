#!/usr/bin/env node
/**
 * Runs the AI verification eval against whatever endpoint .env.local points at.
 *
 * A wrapper rather than an npm script string because setting an environment
 * variable inline (`AI_EVAL=1 vitest ...`) is POSIX shell syntax and npm runs
 * scripts through cmd on Windows, where it is a syntax error. This project is
 * developed on Windows and built on Linux, so the script has to work on both.
 *
 * It also loads .env.local itself. `npx dotenv-cli` would do that, but it is
 * not a dependency of this project and adding one for a manual eval is not
 * worth a lockfile change.
 *
 *   npm run eval:verify
 *
 * Needs AI_BASE_URL, AI_MODEL and (usually) AI_API_KEY, which is what a
 * working local .env.local already has. Costs real tokens: one call per case.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Minimal .env reader: KEY=VALUE per line, `#` comments, optional surrounding
 * quotes. Deliberately does not expand ${...} or handle multi-line values,
 * because the three keys this needs never use either, and a half-correct
 * dotenv parser is worse than an obviously limited one.
 *
 * Anything already in the real environment wins, so a one-off override on the
 * command line still works.
 */
function loadEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvLocal();

if (!process.env.AI_BASE_URL || !process.env.AI_MODEL) {
  console.error(
    "AI_BASE_URL and AI_MODEL are not set. Point them at the endpoint you " +
      "want to measure, in .env.local or in the environment.",
  );
  process.exit(1);
}

console.log(
  `Evaluating ${process.env.AI_MODEL} at ${process.env.AI_BASE_URL}\n` +
    "One call per case, serially. This costs tokens.\n",
);

// Vitest's own entry point, run on this Node, rather than through npx. npx
// resolves to a .cmd shim on Windows that spawnSync cannot launch without a
// shell, and going through a shell would put us back in the quoting problem
// this script exists to avoid. The bin path is stable: it is what
// node_modules/vitest/package.json declares.
const vitestBin = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
if (!fs.existsSync(vitestBin)) {
  console.error(
    `vitest is not installed at ${vitestBin}. Run an install first.`,
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [vitestBin, "run", "tests/lib/ai/verify-eval.test.ts"],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, AI_EVAL: "1" },
  },
);

process.exit(result.status ?? 1);
