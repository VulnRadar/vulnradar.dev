/**
 * VulnRadar — Shared helpers for scripts in this directory (barrel).
 *
 * This file exists for backwards compatibility — every other script imports
 * from `./_lib.mjs` and gets the union of the focused submodules below.
 *
 * New scripts SHOULD import directly from the submodule that owns the
 * helper they need (e.g. `import { ask } from "./_lib/_lib.prompts.mjs"`).
 *
 * Submodules:
 *   _lib.output.mjs   — colours, banner, section, log/info/success/warn/error
 *   _lib.prompts.mjs  — ask, askYesNo, askDanger
 *   _lib.db.mjs       — parseDbUrl, buildConnectionString, createPool, connect
 *   _lib.env.mjs      — loadEnv, requireDatabaseUrl, ROOT
 *   _lib.schema.mjs   — getActualSchema, parseExpectedSchema, getDatabaseSummary
 *   _lib.target.mjs   — listDatabases, chooseDatabase, formatDbTarget, formatDbHost
 *   _lib.meta.mjs     — getProjectMeta, formatBytes, formatDuration
 *   _lib.intro.mjs    — confirmIntro
 */

export {
  c,
  log,
  info,
  success,
  warn,
  error,
  banner,
  section,
  warningBox,
  infoBox,
} from "./_lib.output.mjs";
export { ask, askYesNo, askDanger, askExact } from "./_lib.prompts.mjs";
export {
  parseDbUrl,
  buildConnectionString,
  createPool,
  connect,
} from "./_lib.db.mjs";
export { loadEnv, requireDatabaseUrl, ROOT } from "./_lib.env.mjs";
export {
  getActualSchema,
  getExistingTables,
  getTableCounts,
  getDatabaseSummary,
  parseExpectedSchema,
} from "./_lib.schema.mjs";
export {
  listDatabases,
  chooseDatabase,
  formatDbTarget,
  formatDbHost,
  formatBytes,
} from "./_lib.target.mjs";
export { getProjectMeta, formatDuration } from "./_lib.meta.mjs";
export { confirmIntro } from "./_lib.intro.mjs";
