#!/usr/bin/env node

/**
 * VulnRadar — Repair corrupted 2FA data
 *
 * Finds users whose backup_codes or totp_secret are PROVEN broken (the
 * exact categories in scripts/_lib/_lib.2fa-diagnostics.mjs's
 * REPAIR_ELIGIBLE_CATEGORIES -- the same classification
 * `npm run db:diagnose-2fa` reports) and, only for those rows, resets
 * 2FA to disabled so the user is not permanently locked out of their
 * account.
 *
 * There is no way to recover a corrupted hash or an undecryptable TOTP
 * secret -- a reset + forced re-enrollment is the only safe repair, and
 * this script never touches a row that isn't already proven broken by
 * the shared classifier. A row that merely "looks unusual" but parses
 * and decrypts fine is left alone.
 *
 * SAFE BY DEFAULT: dry run unless --apply is passed. A real run also
 * requires --admin-id=<id> (an existing user id, for admin_audit_log
 * attribution -- see below) and an interactive "yes-repair-2fa"
 * confirmation, unless --yes is also passed.
 *
 * Every user's fix runs in its OWN transaction: one user's failure
 * cannot roll back or block any other user's already-committed fix.
 *
 * Before any UPDATE runs, every row about to be touched is written to a
 * timestamped JSON file under scripts/storage/2fa-repair-backups/
 * (already gitignored via the repo's existing "scripts/storage/" entry).
 * The backup records the user id and which categories were found, never
 * the actual secret/hash values -- those are unrecoverable either way,
 * so persisting them would only create a second place for them to leak
 * from.
 *
 * Every real-run change is also logged to admin_audit_log with
 * action = "reset_2fa" (the same action string the admin UI's manual
 * "Reset 2FA" button uses -- see app/api/v3/admin/route.ts), so it shows
 * up in the existing admin audit log UI. admin_audit_log.admin_id is
 * NOT NULL with a FK to users(id): there is no "system" user, and no
 * authenticated request/session to pull an admin id from in a
 * standalone script, so the operator must supply a real user id via
 * --admin-id to attribute the action to. This is attribution for the
 * audit trail, not an authorization gate -- whoever can run this script
 * already holds DATABASE_URL for the target database, which is a
 * strictly higher privilege than any role check this script could
 * perform.
 *
 * Usage:
 *   npm run db:repair-2fa                                 # dry run (default, always safe)
 *   npm run db:repair-2fa -- --apply --admin-id=1          # real run, asks for confirmation
 *   npm run db:repair-2fa -- --apply --admin-id=1 --yes    # real run, skips the prompt
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
import { getActualSchema } from "./_lib/_lib.schema.mjs";
import {
  classifyUser,
  describeCategory,
} from "./_lib/_lib.2fa-diagnostics.mjs";

const REQUIRED_USER_COLUMNS = [
  "id",
  "totp_enabled",
  "totp_secret",
  "backup_codes",
  "two_factor_method",
];

/**
 * A backup-file entry: the fact a user had 2FA data and why it was reset,
 * never the actual secret/hash values.
 * @typedef {{userId: number, hadTotpSecret: boolean, method: string, categories: string[]}} BackupEntry
 */

/**
 * @param {{timestamp: Date, adminId: number, entries: BackupEntry[]}} args
 * @returns {string} the path written
 */
export function defaultWriteBackupFile({ timestamp, adminId, entries }) {
  const dir = resolve(ROOT, "scripts", "storage", "2fa-repair-backups");
  mkdirSync(dir, { recursive: true });
  const iso = timestamp.toISOString().replace(/[:.]/g, "-");
  const file = resolve(dir, `2fa-repair-${iso}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        generatedAt: timestamp.toISOString(),
        performedByAdminId: adminId,
        note:
          "Fact-of-existence backup only. The original backup_codes/totp_secret " +
          "values are unrecoverable (that is why the repair ran) and were never " +
          "written here or anywhere else.",
        entries,
      },
      null,
      2,
    ),
    "utf-8",
  );
  return file;
}

/**
 * Core, testable logic. Takes a pg-Pool-shaped object (`.query` for
 * reads, `.connect` for the per-user write transactions -- exactly the
 * pg.Pool surface this script uses) plus options, and returns a report.
 *
 * apply=false (the default): read-only. Classifies every totp_enabled
 * user, returns the repair-eligible ones, makes no writes at all --
 * `pool.connect` is never called.
 *
 * apply=true: requires a valid adminId that exists in `users` (the
 * admin_audit_log FK requires this). Writes the backup file, then fixes
 * each repair-eligible user in its own BEGIN/COMMIT, continuing past any
 * single user's failure.
 *
 * @param {{query: Function, connect?: Function}} pool
 * @param {object} [options]
 * @param {boolean} [options.apply]
 * @param {number|null} [options.adminId]
 * @param {(args: {timestamp: Date, adminId: number, entries: BackupEntry[]}) => string} [options.writeBackupFile]
 * @param {() => Date} [options.now]
 * @returns {Promise<{
 *   repairTargets: {userId: number, method: string, problems: {category: string, severity: string, detail?: string}[], repairEligible: boolean}[],
 *   results: {userId: number, ok: boolean, error?: string}[],
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
  const schema = await getActualSchema(pool);
  if (!Object.prototype.hasOwnProperty.call(schema, "users")) {
    throw new Error("The 'users' table does not exist on this database.");
  }
  const usersCols = new Set(schema.users || []);
  const missing = REQUIRED_USER_COLUMNS.filter((col) => !usersCols.has(col));
  if (missing.length > 0) {
    throw new Error(
      `The 'users' table is missing required column(s): ${missing.join(", ")}.`,
    );
  }
  const hasUpdatedAt = usersCols.has("updated_at");

  const usersResult = await pool.query(
    "SELECT id, totp_enabled, totp_secret, backup_codes, two_factor_method FROM users WHERE totp_enabled = true ORDER BY id",
  );
  const classified = usersResult.rows.map((row) => classifyUser(row));
  const repairTargets = classified.filter((r) => r.repairEligible);

  if (!apply || repairTargets.length === 0) {
    return { repairTargets, results: [], backupFile: null, dryRun: !apply };
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
    entries: repairTargets.map((t) => ({
      userId: t.userId,
      hadTotpSecret: true,
      method: t.method,
      categories: t.problems
        .filter((p) => p.severity === "repair-eligible")
        .map((p) => p.category),
    })),
  });

  const updateSql = hasUpdatedAt
    ? "UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, backup_codes = NULL, updated_at = NOW() WHERE id = $1"
    : "UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, backup_codes = NULL WHERE id = $1";

  const results = [];
  for (const target of repairTargets) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(updateSql, [target.userId]);
      const reasons = target.problems
        .filter((p) => p.severity === "repair-eligible")
        .map((p) => describeCategory(p.category))
        .join("; ");
      await client.query(
        "INSERT INTO admin_audit_log (admin_id, target_user_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)",
        [
          adminId,
          target.userId,
          "reset_2fa",
          `Automated repair (scripts/db-repair-2fa.mjs): ${reasons}`,
          null,
        ],
      );
      await client.query("COMMIT");
      results.push({ userId: target.userId, ok: true });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      results.push({ userId: target.userId, ok: false, error: err.message });
    } finally {
      client.release();
    }
  }

  return { repairTargets, results, backupFile, dryRun: false };
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

function printPlan(repairTargets) {
  if (repairTargets.length === 0) {
    success("No repair-eligible users found. Nothing to do.");
    return;
  }
  const lines = [];
  for (const t of repairTargets) {
    const reasons = t.problems
      .filter((p) => p.severity === "repair-eligible")
      .map((p) => describeCategory(p.category))
      .join("; ");
    lines.push(`${c.red}user ${t.userId}${c.reset}: ${reasons}`);
  }
  warningBox(
    `This will reset 2FA (totp_enabled=false, totp_secret=NULL, backup_codes=NULL) for ${repairTargets.length} user(s)`,
    lines,
  );
}

async function main() {
  banner(
    "VulnRadar — Repair 2FA Data",
    "Dry run by default. Pass --apply --admin-id=<id> to write.",
  );

  const { apply, yes, help, adminId } = parseArgs(process.argv.slice(2));
  if (help) {
    log(`
Usage:
  npm run db:repair-2fa                                 # dry run (default)
  npm run db:repair-2fa -- --apply --admin-id=<id>       # real run
  npm run db:repair-2fa -- --apply --admin-id=<id> --yes # real run, skip the confirmation prompt

Only resets 2FA for users whose backup_codes or totp_secret are already
proven unrecoverable (see scripts/_lib/_lib.2fa-diagnostics.mjs). Run
\`npm run db:diagnose-2fa\` first to review.
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
    // Always preview first, exactly like migrate.mjs's plan-then-confirm flow.
    section("Step 1 — Classify");
    const preview = await runRepair(pool, { apply: false });
    printPlan(preview.repairTargets);

    if (preview.repairTargets.length === 0) {
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
        `Type ${c.bold}${c.red}yes-repair-2fa${c.reset} to reset 2FA for ${preview.repairTargets.length} user(s) (or 'n' to cancel)`,
        "yes-repair-2fa",
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
          `  ${c.green}OK${c.reset}    user ${r.userId} -- 2FA reset, audit-logged.`,
        );
      } else {
        failCount++;
        log(`  ${c.red}FAIL${c.reset}  user ${r.userId} -- ${r.error}`);
      }
    }
    log("");
    if (failCount === 0) {
      success(`Repaired ${okCount} user(s). Each ran in its own transaction.`);
    } else {
      warn(
        `Repaired ${okCount} user(s); ${failCount} failed and were rolled back independently (see above). Already-committed users were not affected.`,
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
