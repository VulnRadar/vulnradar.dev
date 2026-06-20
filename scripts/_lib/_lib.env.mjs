/**
 * VulnRadar — .env loader and DATABASE_URL gate.
 *
 * Loads .env.local only for keys NOT already in process.env, so an
 * explicit `DATABASE_URL=...` in the shell always wins.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { error as logError, info as logInfo } from "./_lib.output.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..", "..");

// ── .env.local loader (only sets vars not already in process.env) ──────────
export function loadEnv() {
  if (process.env.DATABASE_URL) return true;
  try {
    const envPath = resolve(ROOT, ".env.local");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
    return Boolean(process.env.DATABASE_URL);
  } catch {
    return false;
  }
}

// ── Pre-flight: ensure DATABASE_URL is available ───────────────────────────
export function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    logError("DATABASE_URL is not set.");
    logInfo("");
    logInfo("Set it in your environment or in .env.local at the project root.");
    logInfo("Example: DATABASE_URL=postgres://user:pass@host:5432/dbname");
    logInfo("");
    process.exit(1);
  }
}
