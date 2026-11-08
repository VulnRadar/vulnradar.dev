/**
 * VulnRadar — .env loader and DATABASE_URL gate.
 *
 * Fills process.env from .env.local and then .env, key by key, and never
 * replaces a variable the shell already set. So an explicit
 * `DATABASE_URL=...` always wins, and the rest of the configuration still
 * loads around it.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import {
  error as logError,
  info as logInfo,
  warn as logWarn,
} from "./_lib.output.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..", "..");

/**
 * Highest precedence first. These are the two files of Next's order that do not
 * depend on the mode: a script has no way to tell whether the app it serves
 * runs under `next dev` or `next start`, so .env.production and
 * .env.development are not guessed at.
 */
const ENV_FILES = [".env.local", ".env"];

// ── .env loader (only sets vars not already in process.env) ────────────────
/**
 * Parsed by Next's own function rather than a copy of its rules, so a value
 * cannot mean one thing to the app and another here: DATABASE_SSL_CA needs its
 * \n escapes expanded to be a valid PEM, and a `$` in a password expands.
 *
 * A second call in the same process is a no-op, which is what keeps a database
 * a script has since picked from being replaced by the file's value again.
 */
export function loadEnv({ root = ROOT } = {}) {
  const files = [];
  for (const path of ENV_FILES) {
    try {
      const contents = readFileSync(resolve(root, path), "utf-8");
      files.push({ path, contents, env: {} });
    } catch (err) {
      if (err.code !== "ENOENT") logWarn(`Could not read ${path}: ${err.code}`);
    }
  }
  // Next's expansion also writes back every key a file names, shell values
  // included, so a `$` in an exported BACKUP_ENCRYPTION_KEY would shorten it.
  const shell = { ...process.env };
  nextEnv.processEnv(files, root, {
    info: () => {},
    error: (message) => logWarn(message),
  });
  Object.assign(process.env, shell);
  return Boolean(process.env.DATABASE_URL);
}

// ── Pre-flight: ensure DATABASE_URL is available ───────────────────────────
export function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    logError("DATABASE_URL is not set.");
    logInfo("");
    logInfo(
      `Set it in your environment, or in ${ENV_FILES.join(" or ")} at the project root.`,
    );
    logInfo(
      `The environment wins over ${ENV_FILES[0]}, which wins over ${ENV_FILES[1]}.`,
    );
    logInfo("Example: DATABASE_URL=postgres://user:pass@host:5432/dbname");
    logInfo("");
    process.exit(1);
  }
}
