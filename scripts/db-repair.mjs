#!/usr/bin/env node

/**
 * VulnRadar — Repair general database corruption
 *
 * Same safety model as scripts/db-repair-2fa.mjs:
 *   - Dry run by default. Real writes require --apply --admin-id=<id>.
 *   - A JSON backup (fact-of-what-was-found, never raw secret/token
 *     values) is written under scripts/storage/db-repair-backups/
 *     before any UPDATE/DELETE runs.
 *   - Every real change is logged to admin_audit_log
 *     (action = "data_integrity_repair").
 *   - Each finding's fix runs in its OWN transaction. Here "one fix"
 *     means one finding (e.g. "all orphaned admin_audit_log.target_user_id
 *     rows"), not one row -- these are set-based repairs (a single bulk
 *     UPDATE/DELETE), and splitting a single bulk fix mid-way across
 *     multiple transactions would leave the SAME category of row in two
 *     different states for no reason. One finding failing to apply never
 *     rolls back or blocks any other finding's already-committed fix.
 *
 * Only ever touches what scripts/_lib/_lib.check-*.mjs marked
 * severity: "auto-fixable" -- every one of those categories mirrors an
 * already-existing, precedented app action (see each check module's file
 * header for the exact precedent). Everything marked "needs-human" is
 * reported by `npm run db:diagnose` and never touched here, no matter
 * how confident the pattern looks.
 *
 * 2FA-specific repairs (totp_secret / backup_codes) are NOT included --
 * run `npm run db:repair-2fa` for those, so there is exactly one
 * repair path for 2FA data instead of two that could disagree.
 *
 * Usage:
 *   npm run db:repair                                 # dry run (default)
 *   npm run db:repair -- --apply --admin-id=<id>       # real run
 *   npm run db:repair -- --apply --admin-id=<id> --yes # skip the confirmation prompt
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, requireDatabaseUrl, ROOT } from "./_lib/_lib.env.mjs";
import { createPool, connect } from "./_lib/_lib.db.mjs";
import {
  c,
  log,
  info,
  success,
  warn,
  error,
  banner,
  section,
  warningBox,
} from "./_lib/_lib.output.mjs";
import { askExact } from "./_lib/_lib.prompts.mjs";
import {
  buildContext,
  runAllChecks,
  flattenFindings,
} from "./_lib/_lib.corruption-orchestrator.mjs";

export function defaultWriteBackupFile({ timestamp, adminId, entries }) {
  const dir = resolve(ROOT, "scripts", "storage", "db-repair-backups");
  mkdirSync(dir, { recursive: true });
  const iso = timestamp.toISOString().replace(/[:.]/g, "-");
  const file = resolve(dir, `db-repair-${iso}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        generatedAt: timestamp.toISOString(),
        performedByAdminId: adminId,
        note:
          "Fact-of-what-was-found backup, not a data backup. Every entry here " +
          "was already independently re-verified as broken (orphaned FK, " +
          "undecryptable ciphertext, etc.) immediately before its fix ran.",
        entries,
      },
      null,
      2,
    ),
    "utf-8",
  );
  return file;
}

/** Classify only -- never writes. Used by both the dry-run preview and as the first step of a real run. */
export async function runRepairPlan(pool) {
  const ctx = await buildContext(pool);
  const results = await runAllChecks(pool, ctx);
  const findings = flattenFindings(results);
  const autoFixable = findings.filter(
    (f) => f.severity === "auto-fixable" && f.repair,
  );
  const needsHuman = findings.filter((f) => f.severity !== "auto-fixable");
  return { autoFixable, needsHuman };
}

/**
 * A backup-file entry: the fact a finding was found and repaired, never
 * the raw row values that made it a finding.
 * @typedef {{category: string, table: string, column: string, description: string, count: number, examples: unknown[]}} RepairBackupEntry
 */

/**
 * @param {{query: Function, connect?: Function}} pool
 * @param {object} [options]
 * @param {boolean} [options.apply]
 * @param {number|null} [options.adminId]
 * @param {(args: {timestamp: Date, adminId: number, entries: RepairBackupEntry[]}) => string} [options.writeBackupFile]
 * @param {() => Date} [options.now]
 * @returns {Promise<{
 *   autoFixable: any[],
 *   results: {table: string, column: string, category: string, ok: boolean, error?: string}[],
 *   backupFile: string|null,
 *   dryRun?: boolean,
 * }>}
 */
export async function runRepair(
  pool,
  {
    apply = false,
    adminId = null,
    writeBackupFile = defaultWriteBackupFile,
    now = () => new Date(),
  } = {},
) {
  const { autoFixable } = await runRepairPlan(pool);

  if (!apply || autoFixable.length === 0) {
    return { autoFixable, results: [], backupFile: null, dryRun: !apply };
  }

  if (!Number.isInteger(adminId) || adminId <= 0) {
    throw new Error(
      "--apply requires a valid --admin-id=<id> (a positive integer) for audit-log attribution.",
    );
  }
  const adminCheck = await pool.query(
    "SELECT id, email, role FROM users WHERE id = $1",
    [adminId],
  );
  if (adminCheck.rows.length === 0) {
    throw new Error(
      `--admin-id=${adminId} does not match any row in the users table (admin_audit_log.admin_id has a NOT NULL foreign key to users(id)).`,
    );
  }

  const timestamp = now();
  const backupFile = writeBackupFile({
    timestamp,
    adminId,
    entries: autoFixable.map((f) => ({
      category: f.category,
      table: f.table,
      column: f.column,
      description: f.description,
      count: f.count,
      examples: f.examples,
    })),
  });

  const results = [];
  for (const finding of autoFixable) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(finding.repair.sql, finding.repair.params || []);
      await client.query(
        "INSERT INTO admin_audit_log (admin_id, target_user_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)",
        [
          adminId,
          null,
          "data_integrity_repair",
          `Automated repair (scripts/db-repair.mjs): ${finding.repair.description}`,
          null,
        ],
      );
      await client.query("COMMIT");
      results.push({
        table: finding.table,
        column: finding.column,
        category: finding.category,
        ok: true,
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      results.push({
        table: finding.table,
        column: finding.column,
        category: finding.category,
        ok: false,
        error: err.message,
      });
    } finally {
      client.release();
    }
  }

  return { autoFixable, results, backupFile, dryRun: false };
}

// ── CLI ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const yes = argv.includes("--yes");
  const help = argv.includes("--help") || argv.includes("-h");
  const adminIdArg = argv.find((a) => a.startsWith("--admin-id="));
  const adminId = adminIdArg ? Number(adminIdArg.split("=")[1]) : null;
  return { apply, yes, help, adminId };
}

function printPlan(autoFixable, needsHuman) {
  if (autoFixable.length === 0) {
    success("No auto-fixable findings. Nothing to do.");
  } else {
    const lines = autoFixable.map(
      (f) =>
        `${c.green}${f.table}.${f.column}${c.reset} (${f.category}): ${f.repair.description}`,
    );
    warningBox(`This will apply ${autoFixable.length} repair(s)`, lines);
  }
  if (needsHuman.length > 0) {
    log("");
    warn(
      `${needsHuman.length} additional finding(s) need a human decision and will NOT be touched. Run ${c.bold}npm run db:diagnose${c.reset} for detail.`,
    );
  }
}

async function main() {
  banner(
    "VulnRadar — Repair Database Corruption",
    "Dry run by default. Pass --apply --admin-id=<id> to write.",
  );

  const { apply, yes, help, adminId } = parseArgs(process.argv.slice(2));
  if (help) {
    log(`
Usage:
  npm run db:repair                                 # dry run (default)
  npm run db:repair -- --apply --admin-id=<id>       # real run
  npm run db:repair -- --apply --admin-id=<id> --yes # real run, skip the confirmation prompt

Only touches findings scripts/db-diagnose.mjs marked "auto-fixable" --
run that first to review. Findings marked "needs-human" are never
auto-fixed; see scripts/_lib/_lib.check-*.mjs for why each one requires
a person. 2FA-specific data has its own separate tool:
\`npm run db:repair-2fa\`.
`);
    process.exit(0);
  }

  if (apply && (!Number.isInteger(adminId) || adminId <= 0)) {
    error(
      "--apply requires --admin-id=<id> (a real user id, used to attribute the admin_audit_log entry).",
    );
    process.exit(1);
  }

  loadEnv();
  requireDatabaseUrl();

  const pool = createPool();
  if (!(await connect(pool))) {
    await pool.end();
    process.exit(1);
  }
  success("Connected.");

  try {
    section("Step 1 — Classify");
    const { autoFixable, needsHuman } = await runRepairPlan(pool);
    printPlan(autoFixable, needsHuman);

    if (autoFixable.length === 0) {
      return;
    }

    if (!apply) {
      log("");
      info(
        "Dry run only. Re-run with --apply --admin-id=<id> to write these changes.",
      );
      return;
    }

    const adminRow = await pool.query(
      "SELECT id, email, role FROM users WHERE id = $1",
      [adminId],
    );
    if (adminRow.rows.length === 0) {
      error(
        `--admin-id=${adminId} does not match any user. Aborting -- no changes made.`,
      );
      process.exit(1);
    }
    const admin = adminRow.rows[0];
    log("");
    info(
      `Audit-log attribution: admin_id=${admin.id} (${admin.email}, role=${admin.role || "user"}).`,
    );

    section("Step 2 — Confirm");
    if (!yes) {
      const confirmed = await askExact(
        `Type ${c.bold}${c.red}yes-repair-data${c.reset} to apply ${autoFixable.length} repair(s) (or 'n' to cancel)`,
        "yes-repair-data",
      );
      if (!confirmed) {
        info("Cancelled. No changes made.");
        return;
      }
    }

    section("Step 3 — Apply");
    const result = await runRepair(pool, { apply: true, adminId });
    success(`Backup written: ${result.backupFile}`);
    log("");
    let okCount = 0;
    let failCount = 0;
    for (const r of result.results) {
      if (r.ok) {
        okCount++;
        log(
          `  ${c.green}OK${c.reset}    ${r.table}.${r.column} (${r.category}) -- fixed, audit-logged.`,
        );
      } else {
        failCount++;
        log(
          `  ${c.red}FAIL${c.reset}  ${r.table}.${r.column} (${r.category}) -- ${r.error}`,
        );
      }
    }
    log("");
    if (failCount === 0) {
      success(`Applied ${okCount} repair(s). Each ran in its own transaction.`);
    } else {
      warn(
        `${okCount} repair(s) succeeded, ${failCount} failed and were rolled back independently. Already-committed repairs were not affected.`,
      );
    }
  } catch (err) {
    error(`Repair failed: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
