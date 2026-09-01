#!/usr/bin/env node

/**
 * VulnRadar — General-purpose database corruption diagnostic
 *
 * READ-ONLY. Schema-driven: introspects the live database via
 * information_schema/pg_catalog (never a hardcoded table list) and
 * checks six categories:
 *
 *   1. Foreign-key orphans (declared FK constraints + naming-convention
 *      "implied" relationships not yet declared on an old schema)
 *   2. Encrypted-column decrypt failures (api_keys.key_encrypted,
 *      discord_connections tokens, user_ai_configs.api_key_encrypted --
 *      see scripts/_lib/_lib.encrypted-columns.mjs)
 *   3. JSON/JSONB shape (Postgres already enforces well-formedness for
 *      real json/jsonb columns; this checks shape instead -- see
 *      scripts/_lib/_lib.check-json-shape.mjs)
 *   4. Enum/status values outside the recognized set (DB CHECK
 *      constraints, discovered generically, plus the application-level
 *      enums that have no DB constraint -- see _lib.app-enums.mjs)
 *   5. Cross-column state consistency (grounded in real code paths --
 *      see _lib.check-cross-column.mjs's header for exactly which
 *      invariants were verified against the app code and which
 *      candidate invariants were checked and found NOT to hold)
 *   6. Timestamp sanity (updated_at before created_at, far-future
 *      created_at) across every table generically
 *
 * 2FA-specific data (users.totp_secret / backup_codes / email_2fa_codes)
 * is deliberately NOT reimplemented here -- this script calls directly
 * into scripts/maintenance/db-diagnose-2fa.mjs's runDiagnostics() and folds its
 * summary into this report, so there is exactly one source of truth for
 * "what counts as broken 2FA data." Run `npm run db:diagnose-2fa` for
 * the full per-user detail.
 *
 * Makes ZERO writes, ever. For the opt-in repair, see
 * `npm run db:repair` (scripts/maintenance/db-repair.mjs).
 *
 * Usage:
 *   npm run db:diagnose
 *
 * Exit code: 0 if no findings in any category (including the 2FA
 * summary), 1 otherwise. Never wired into any automatic process -- see
 * the accompanying report for why.
 */
import { fileURLToPath } from "node:url";
import { loadEnv, requireDatabaseUrl } from "../_lib/_lib.env.mjs";
import { createPool, connect } from "../_lib/_lib.db.mjs";
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
} from "../_lib/_lib.output.mjs";
import {
  CHECK_MODULES,
  buildContext,
  runAllChecks,
  flattenFindings,
} from "../_lib/_lib.corruption-orchestrator.mjs";
import { runDiagnostics as run2faDiagnostics } from "./db-diagnose-2fa.mjs";

/**
 * Core, testable logic. Returns the full report; never throws for a
 * reachable schema (a hard stop like a missing `users` table surfaces as
 * `fatal2fa` inside the 2fa sub-report, matching that tool's own
 * contract) and never writes anything.
 */
export async function runDiagnostics(pool) {
  const ctx = await buildContext(pool);
  const results = await runAllChecks(pool, ctx);
  const twoFactor = await run2faDiagnostics(pool);
  return { ctx, results, twoFactor };
}

function severityCounts(findings) {
  const autoFixable = findings.filter(
    (f) => f.severity === "auto-fixable",
  ).length;
  const needsHuman = findings.filter(
    (f) => f.severity === "needs-human",
  ).length;
  return { autoFixable, needsHuman };
}

function printReport({ results, twoFactor }) {
  section("Summary");
  const allFindings = flattenFindings(results);
  const { autoFixable, needsHuman } = severityCounts(allFindings);
  log(
    `  ${c.dim}Total findings:${c.reset}     ${c.bold}${allFindings.length}${c.reset}`,
  );
  log(
    `  ${c.dim}Auto-fixable:${c.reset}       ${c.bold}${autoFixable}${c.reset}`,
  );
  log(
    `  ${c.dim}Needs a human:${c.reset}      ${c.bold}${needsHuman}${c.reset}`,
  );
  log("");

  for (const { key, label } of CHECK_MODULES) {
    const { findings, meta } = results[key];
    section(label);
    if (meta && Object.keys(meta).length > 0) {
      log(`  ${c.dim}${JSON.stringify(meta)}${c.reset}`);
    }
    if (findings.length === 0) {
      success("No problems found.");
      continue;
    }
    for (const f of findings) {
      const tag =
        f.severity === "auto-fixable"
          ? `${c.green}[auto-fixable]${c.reset}`
          : `${c.red}[needs-human]${c.reset}`;
      log(`  ${tag} ${c.bold}${f.table}.${f.column}${c.reset} (${f.count})`);
      log(`    ${f.description}`);
      for (const ex of f.examples.slice(0, 5)) {
        log(`    ${c.dim}- ${JSON.stringify(ex)}${c.reset}`);
      }
    }
    log("");
  }

  section("2FA data (via scripts/maintenance/db-diagnose-2fa.mjs)");
  let twoFactorIssues = 0;
  if (twoFactor.fatal) {
    error(twoFactor.fatal);
    twoFactorIssues = 1;
  } else {
    log(
      `  ${c.dim}Total users:${c.reset} ${twoFactor.totalUsers}  ${c.dim}2FA-enabled:${c.reset} ${twoFactor.totpEnabledUsers}`,
    );
    const repairEligible = twoFactor.userResults.filter(
      (r) => r.repairEligible,
    ).length;
    twoFactorIssues = repairEligible;
    if (repairEligible === 0) {
      success("No 2FA repair-eligible users found.");
    } else {
      warn(`${repairEligible} user(s) are 2FA repair-eligible.`);
      info(`Run ${c.bold}npm run db:diagnose-2fa${c.reset} for full detail.`);
    }
  }

  if (autoFixable > 0) {
    log("");
    info(
      `Run ${c.bold}npm run db:repair${c.reset} to review the ${autoFixable} auto-fixable finding(s) (dry run by default).`,
    );
  }
  if (needsHuman > 0) {
    log("");
    warningBox(`${needsHuman} finding(s) need a human decision`, [
      "These are NOT auto-fixed by scripts/maintenance/db-repair.mjs -- the correct value",
      "requires business/product judgment (a Stripe lookup, deciding which enum",
      "value a row should have been, etc). Review each one above.",
    ]);
  }

  return { totalFindings: allFindings.length + twoFactorIssues };
}

async function main() {
  banner(
    "VulnRadar — Diagnose Database Corruption",
    "Read-only, schema-driven. Checks FKs, encrypted columns, JSON shape, enums, cross-column state, timestamps.",
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
    const { totalFindings } = printReport(report);
    process.exit(totalFindings > 0 ? 1 : 0);
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
