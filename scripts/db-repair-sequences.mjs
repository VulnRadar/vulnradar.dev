#!/usr/bin/env node

/**
 * VulnRadar — Repair PostgreSQL sequences
 *
 * Resets every SERIAL/BIGSERIAL sequence in the public schema so that
 * the next INSERT gets an ID one above the current MAX. Run this after
 * any bulk import, seed, or restore to prevent duplicate-key errors.
 *
 * Usage:
 *   npm run db:repair-sequences
 */

import { loadEnv, requireDatabaseUrl } from "./_lib/_lib.env.mjs";
import { createPool, connect } from "./_lib/_lib.db.mjs";
import { log, success, error, banner } from "./_lib/_lib.output.mjs";
import { repairAllSequences } from "./migrate/_runner.mjs";

async function main() {
  banner(
    "VulnRadar — Repair Sequences",
    "Reset all SERIAL sequences to MAX(id)",
  );

  loadEnv();
  requireDatabaseUrl();

  const pool = createPool();
  if (!(await connect(pool))) {
    await pool.end();
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    log("  Scanning all sequences in the public schema...\n");
    await repairAllSequences(client);
    log("");
    success("All sequences reset to MAX(id). Safe to insert new rows.");
  } catch (err) {
    error(`Sequence repair failed: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
