#!/usr/bin/env node

/**
 * VulnRadar — Diagnose 2FA data integrity
 *
 * READ-ONLY. Connects to DATABASE_URL and, for every user with
 * totp_enabled = true, checks:
 *
 *   1. Is backup_codes valid JSON, an array, and are its elements
 *      strings in a shape verifyPassword() can actually parse? (see
 *      scripts/_lib/_lib.2fa-hash-mirror.mjs, which mirrors
 *      lib/auth/password-hash.ts's own parsing logic)
 *   2. Does totp_secret decrypt with the configured
 *      API_KEY_ENCRYPTION_KEY, and does the decrypted value actually
 *      look like a TOTP seed? (see scripts/_lib/_lib.2fa-crypto-mirror.mjs,
 *      which mirrors lib/auth/crypto.ts's AES-256-GCM framing)
 *   3. Are there email_2fa_codes rows that are expired-but-uncleaned or
 *      malformed?
 *
 * This script makes ZERO writes, ever. For the opt-in repair, see
 * `npm run db:repair-2fa` (scripts/db-repair-2fa.mjs).
 *
 * Schema-aware: production may be on an older schema than this checkout
 * (see scripts/migrate/_registry.mjs). Every column this script touches
 * is confirmed to exist via information_schema first; a schema that's
 * missing an optional/newer column has that specific check skipped and
 * noted, not a crash.
 *
 * Never prints a secret, hash, or code value -- only user ids and plain
 * descriptions of what's wrong.
 *
 * Usage:
 *   npm run db:diagnose-2fa
 *
 * Exit code: 0 if no repair-eligible problems were found (or the run
 * itself couldn't determine that -- see the printed summary), 1 if at
 * least one user is repair-eligible. This script is NOT wired into any
 * automatic process (see AGENTS.md / the accompanying report for why);
 * the exit code is for a human or CI job that explicitly chooses to key
 * off it.
 */
import { fileURLToPath } from "node:url";
import { loadEnv, requireDatabaseUrl } from "./_lib/_lib.env.mjs";
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
  infoBox,
  warningBox,
} from "./_lib/_lib.output.mjs";
import { getActualSchema } from "./_lib/_lib.schema.mjs";
import { isEncryptionConfigured } from "./_lib/_lib.2fa-crypto-mirror.mjs";
import {
  classifyUser,
  classifyEmail2FACodeRow,
  describeCategory,
} from "./_lib/_lib.2fa-diagnostics.mjs";

const REQUIRED_USER_COLUMNS = [
  "id",
  "totp_enabled",
  "totp_secret",
  "backup_codes",
  "two_factor_method",
];
const REQUIRED_EMAIL_CODE_COLUMNS = [
  "id",
  "user_id",
  "code_hash",
  "expires_at",
];

/**
 * Core, testable logic. Takes a pg-Pool-shaped object (only `.query` is
 * used -- this is entirely read-only) and returns a plain report object.
 * Never throws for a reachable schema; a hard stop (e.g. no `users`
 * table at all) is returned as `{ fatal: "..." }` rather than thrown, so
 * the CLI wrapper can print it consistently with everything else.
 */
export async function runDiagnostics(pool) {
  const skipped = [];
  const schema = await getActualSchema(pool);

  if (!Object.prototype.hasOwnProperty.call(schema, "users")) {
    return {
      fatal: "The 'users' table does not exist on this database.",
      skipped,
    };
  }

  const usersCols = new Set(schema.users || []);
  const missingUserCols = REQUIRED_USER_COLUMNS.filter(
    (col) => !usersCols.has(col),
  );
  if (missingUserCols.length > 0) {
    return {
      fatal: `The 'users' table is missing required column(s): ${missingUserCols.join(", ")}. Cannot run the 2FA diagnostic against this schema.`,
      skipped,
    };
  }

  if (!isEncryptionConfigured()) {
    skipped.push(
      "API_KEY_ENCRYPTION_KEY is not set for this run -- every totp_secret will be reported as 'encryption_not_configured' instead of a real pass/fail.",
    );
  }

  const totalUsersResult = await pool.query(
    "SELECT COUNT(*)::int AS n FROM users",
  );
  const totalUsers = totalUsersResult.rows[0]?.n ?? 0;

  const usersResult = await pool.query(
    "SELECT id, totp_enabled, totp_secret, backup_codes, two_factor_method FROM users WHERE totp_enabled = true ORDER BY id",
  );
  const userResults = usersResult.rows.map((row) => classifyUser(row));

  // --- email_2fa_codes hygiene (schema-aware) ---
  let emailCodeResults = [];
  let emailCodesScanned = 0;
  if (!Object.prototype.hasOwnProperty.call(schema, "email_2fa_codes")) {
    skipped.push(
      "email_2fa_codes table does not exist on this schema -- skipping email 2FA code hygiene check.",
    );
  } else {
    const emailCols = new Set(schema.email_2fa_codes || []);
    const missingEmailCols = REQUIRED_EMAIL_CODE_COLUMNS.filter(
      (col) => !emailCols.has(col),
    );
    if (missingEmailCols.length > 0) {
      skipped.push(
        `email_2fa_codes is missing column(s) ${missingEmailCols.join(", ")} -- skipping the email 2FA code hygiene check.`,
      );
    } else {
      const hasCodeSalt = emailCols.has("code_salt");
      if (!hasCodeSalt) {
        skipped.push(
          "email_2fa_codes.code_salt column does not exist on this schema -- the unsalted-code check is skipped (instrumentation.ts adds this column via CREATE TABLE for new tables, but has no ALTER TABLE for a table created before the column existed).",
        );
      }
      const selectCols = hasCodeSalt
        ? "id, user_id, code_hash, code_salt, expires_at"
        : "id, user_id, code_hash, expires_at";
      const emailRows = await pool.query(
        `SELECT ${selectCols} FROM email_2fa_codes`,
      );
      emailCodesScanned = emailRows.rows.length;
      emailCodeResults = emailRows.rows
        .map((row) => classifyEmail2FACodeRow(row, { hasCodeSalt }))
        .filter((r) => r.problems.length > 0);
    }
  }

  return {
    totalUsers,
    totpEnabledUsers: userResults.length,
    userResults,
    emailCodesScanned,
    emailCodeResults,
    skipped,
  };
}

// ── Output rendering ────────────────────────────────────────────────────
function printReport(report) {
  if (report.fatal) {
    error(report.fatal);
    return { hasRepairEligible: false };
  }

  section("Summary");
  log(
    `  ${c.dim}Total users:${c.reset}          ${c.bold}${report.totalUsers}${c.reset}`,
  );
  log(
    `  ${c.dim}2FA-enabled users:${c.reset}    ${c.bold}${report.totpEnabledUsers}${c.reset}`,
  );
  log(
    `  ${c.dim}email_2fa_codes rows scanned:${c.reset} ${c.bold}${report.emailCodesScanned}${c.reset}`,
  );
  log("");

  if (report.skipped.length > 0) {
    infoBox(
      "Checks skipped for this schema",
      report.skipped.map((s) => `${c.dim}-${c.reset} ${s}`),
    );
  }

  const repairEligibleUsers = report.userResults.filter(
    (r) => r.repairEligible,
  );
  const warningOnlyUsers = report.userResults.filter(
    (r) => !r.repairEligible && r.problems.length > 0,
  );

  section(
    `Users (${repairEligibleUsers.length} repair-eligible, ${warningOnlyUsers.length} warning-only)`,
  );

  if (repairEligibleUsers.length === 0 && warningOnlyUsers.length === 0) {
    success(
      "No problems found in any 2FA-enabled user's backup_codes or totp_secret.",
    );
  } else {
    if (repairEligibleUsers.length > 0) {
      const lines = [];
      for (const u of repairEligibleUsers) {
        for (const p of u.problems.filter(
          (p) => p.severity === "repair-eligible",
        )) {
          lines.push(
            `${c.red}user ${u.userId}${c.reset}: ${describeCategory(p.category)}`,
          );
        }
      }
      warningBox("Repair-eligible (permanent lockout, unrecoverable)", lines);
    }
    if (warningOnlyUsers.length > 0) {
      log(`  ${c.bold}${c.yellow}Warnings (not repair-eligible):${c.reset}`);
      for (const u of warningOnlyUsers) {
        for (const p of u.problems) {
          const extra = p.detail ? ` (${p.detail})` : "";
          log(
            `    ${c.yellow}user ${u.userId}${c.reset}: ${describeCategory(p.category)}${extra}`,
          );
        }
      }
      log("");
    }
  }

  if (report.emailCodeResults.length > 0) {
    log(`  ${c.bold}email_2fa_codes hygiene:${c.reset}`);
    for (const r of report.emailCodeResults) {
      for (const p of r.problems) {
        log(
          `    ${c.yellow}row ${r.id} (user ${r.userId})${c.reset}: ${p.category}`,
        );
      }
    }
    log("");
  }

  if (repairEligibleUsers.length > 0) {
    info(
      `Run ${c.bold}npm run db:repair-2fa${c.reset} to review the safe repair (dry run by default).`,
    );
  }

  return { hasRepairEligible: repairEligibleUsers.length > 0 };
}

async function main() {
  banner(
    "VulnRadar — Diagnose 2FA Data",
    "Read-only. Checks backup_codes / totp_secret / email_2fa_codes. Makes zero writes.",
  );

  loadEnv();
  requireDatabaseUrl();

  const pool = createPool();
  if (!(await connect(pool))) {
    await pool.end();
    process.exit(1);
  }
  success("Connected.");

  try {
    const report = await runDiagnostics(pool);
    const { hasRepairEligible } = printReport(report);
    if (report.fatal) {
      process.exit(1);
    }
    process.exit(hasRepairEligible ? 1 : 0);
  } catch (err) {
    error(`Diagnostic failed: ${err.message}`);
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
