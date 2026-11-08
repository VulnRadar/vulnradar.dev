#!/usr/bin/env node

/**
 * VulnRadar: Version-aware Database Migration
 *
 * Detects the current schema version, lets you pick a target version,
 * shows the diff as a plan, and applies it inside a single transaction.
 *
 * Usage:
 *   npm run db:migrate              # detect, target = recommended (app version)
 *   npm run db:migrate -- --dry-run # show plan only, don't execute
 *   npm run db:migrate -- --yes     # non-interactive: accept every default
 *   npm run db:migrate -- --skip-backup
 *                                   # migrate without the pre-migration dump
 *
 * Before any DDL runs, the database is dumped to
 * <BACKUP_DIR or ./backups>/pre-migration/ (see _lib.backup.mjs). If that
 * dump cannot be written the migration stops without changing anything, and
 * --skip-backup is the explicit way past it.
 *
 * Non-interactive automatically, no flag needed, whenever stdin isn't a
 * real terminal (e.g. spawned by the in-app self-updater, or piped in
 * CI) -- see _lib.prompts.mjs's NON_INTERACTIVE. Every prompt answers
 * with its own documented safe default (current DATABASE_URL's database,
 * the app's recommended version, proceed with a routine upgrade) except
 * a downgrade, which always refuses and exits non-zero unattended rather
 * than silently applying or silently doing nothing while reporting
 * success.
 *
 * Requires DATABASE_URL in .env.local or as an environment variable.
 */

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
  ask,
  askYesNo,
  askExact,
  NON_INTERACTIVE,
} from "../_lib/_lib.prompts.mjs";
import { loadEnv, requireDatabaseUrl } from "../_lib/_lib.env.mjs";
import {
  parseDbUrl,
  buildConnectionString,
  createPool,
  connect,
} from "../_lib/_lib.db.mjs";
import { chooseDatabase } from "../_lib/_lib.target.mjs";
import { getActualSchema } from "../_lib/_lib.schema.mjs";
import { getProjectMeta } from "../_lib/_lib.meta.mjs";
import {
  VERSIONS,
  getVersion,
  isUpgrade,
  isDowngrade,
  getRecommendedVersion,
  listVersionFiles,
} from "./_registry.mjs";
import { ensureMetaTable, readMeta, writeMeta } from "./_meta.mjs";
import { fingerprintDetect } from "./_detect.mjs";
import { buildPlan, renderPlan } from "./_planner.mjs";
import { runPlan, repairAllSequences } from "./_runner.mjs";
import { verifyTargetSchema, assessSameVersionRun } from "./_verify.mjs";
import { runPreMigrationBackup } from "../_lib/_lib.backup.mjs";

// ── Args (--dry-run and --skip-backup; --yes is read by _lib.prompts.mjs) ──
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_BACKUP = process.argv.includes("--skip-backup");
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  log(`
VulnRadar: Version-aware Database Migration

Usage:
  npm run db:migrate              # run the migration
  npm run db:migrate:dry-run      # show the plan, SQL runs in a rolled-back transaction
  npm run db:migrate -- --yes     # non-interactive: accept every default
  npm run db:migrate -- --skip-backup
                                  # do not take the pre-migration dump (only
                                  # when the dump itself is what fails)

Behavior:
  A database already at the target version has no DDL to run. The run
  repairs sequences, compares the live schema with the target and names
  anything missing, then records the app version in the meta row. Missing
  items are expected until this release has booted once, since boot creates
  them, so that case warns. On a database already recorded at this release
  it exits non-zero.

  Runs non-interactively (accepting the current DATABASE_URL's database,
  the recommended target version, and any routine destructive step)
  automatically whenever stdin isn't a real terminal, or with --yes.
  A downgrade always refuses to run unattended.

Known versions:
${VERSIONS.map((v) => `  ${v.name.padEnd(8)}  ${v.label}`).join("\n")}

Note: the app's package.json may be at a higher version (e.g. 2.3.0) but
the migration framework tracks schema state, which is the same for v2
and v2.3.0 (the only difference is api_keys.key_locator, which
instrumentation.ts auto-adds on app boot).

Version files in scripts/migrate/versions/:
${listVersionFiles()
  .map((f) => `  - ${f}`)
  .join("\n")}
`);
  process.exit(0);
}

// ── Welcome banner (shown at the very top of the run) ─────────────────────
function showWelcome(meta, dbHost) {
  banner(
    `VulnRadar ${meta.version}: Database Migration`,
    "Version-aware. Detects your current schema, lets you pick any target.",
  );
  log(`  ${c.dim}App version:${c.reset}  ${c.bold}${meta.version}${c.reset}`);
  log(`  ${c.dim}Connecting to:${c.reset}  ${c.bold}${dbHost}${c.reset}`);
  log("");
}

// ── Plan summary block (shown after the user picks a target) ──────────────
function showPlanSummary({
  meta,
  current,
  target,
  direction,
  dbTarget,
  recommended,
}) {
  const isRecommended = target === recommended.name;
  const targetLabel = isRecommended
    ? `${c.cyan}${target}${c.reset}  ${c.dim}(recommended for app v${meta.version})${c.reset}`
    : `${c.cyan}${target}${c.reset}  ${c.dim}(app v${meta.version} recommends ${recommended.name})${c.reset}`;

  const directionLabel =
    direction === "same"
      ? `${c.yellow}SAME${c.reset}`
      : direction === "upgrade"
        ? `${c.green}${direction.toUpperCase()}${c.reset}`
        : `${c.red}${direction.toUpperCase()}${c.reset}`;

  log(`  ${c.bold}What this migration will do:${c.reset}`);
  log(`    ${c.cyan}•${c.reset} Direction: ${directionLabel}`);
  log(
    `    ${c.cyan}•${c.reset} From:        ${c.bold}${current}${c.reset}  ${c.dim}(detected)${c.reset}`,
  );
  log(`    ${c.cyan}•${c.reset} To:          ${targetLabel}`);
  log(`    ${c.cyan}•${c.reset} Database:    ${c.bold}${dbTarget}${c.reset}`);
  log("");
  if (direction === "same") {
    log(
      `    ${c.cyan}•${c.reset} Already at target: the plan will be empty, no DDL runs.`,
    );
    log(
      `    ${c.cyan}•${c.reset} Check the live schema against the target and name anything missing.`,
    );
  } else {
    log(
      `    ${c.cyan}•${c.reset} Compose the chain of transitions, render the plan, ask for approval.`,
    );
    log(
      `    ${c.cyan}•${c.reset} Run every step in a single transaction (rollback on any error).`,
    );
  }
  log(
    `    ${c.cyan}•${c.reset} Write the new version to ${c.bold}vulnradar_schema_meta${c.reset}.`,
  );
  log("");
  if (direction === "downgrade") {
    log(
      `  ${c.red}${c.bold}Destructive downgrade:${c.reset} ${c.red}will DROP tables and columns; see the red warning below.${c.reset}`,
    );
  } else if (direction === "same") {
    log(
      `  ${c.yellow}${c.bold}Heads up:${c.reset} Same version: nothing destructive, and no schema changes.`,
    );
  } else {
    log(
      `  ${c.yellow}${c.bold}Heads up:${c.reset} Always back up your database before running migrations.`,
    );
  }
  log("");
}

// ── Version picker (with recommended marker) ──────────────────────────────
async function pickTargetVersion(recommended) {
  log(`  ${c.bold}Available schema versions:${c.reset}`);
  log("");
  for (let i = 0; i < VERSIONS.length; i++) {
    const v = VERSIONS[i];
    const isRec = v.name === recommended.name;
    const marker = isRec ? `${c.cyan}${c.bold}← recommended${c.reset}` : "";
    log(
      `    ${c.bold}${String(i + 1).padStart(2)}${c.reset}. ${c.bold}${v.name.padEnd(8)}${c.reset}  ${c.dim}${v.label}${c.reset}  ${marker}`,
    );
  }
  log(`     ${c.dim} n. Cancel${c.reset}`);
  log("");

  const defaultName = recommended.name;
  while (true) {
    const answer = (
      await ask(
        `Pick target version [1-${VERSIONS.length}, or name, or 'n' to cancel]`,
        defaultName,
      )
    ).trim();

    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "cancel") {
      return null;
    }

    // Numeric pick
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= VERSIONS.length) {
      return VERSIONS[n - 1].name;
    }

    // Name pick
    try {
      getVersion(answer);
      return answer;
    } catch {
      warn(`Unknown version: '${answer}'. Try again.`);
    }
  }
}

/**
 * The check a same-version run makes in place of the DDL it does not have.
 * Returns the app version to record, and exits non-zero on a database that
 * should already be complete and is not.
 */
async function checkSameVersionSchema(pool, target, meta, projectMeta) {
  const verified = await verifyTargetSchema(pool, target);
  const outcome = assessSameVersionRun({
    missing: verified,
    recordedAppVersion: meta?.appVersion ?? null,
    appVersion: projectMeta.version,
  });
  if (outcome === "complete") {
    success(
      `Verified: every ${target} table and column is present (${verified.checkedTables} tables checked).`,
    );
    return projectMeta.version;
  }

  const report = outcome === "incomplete" ? error : warn;
  report(
    `${verified.missingTables.length} table(s) and ${verified.missingColumns.length} column(s) of schema ${target} are not in this database:`,
  );
  for (const t of verified.missingTables) {
    log(`    ${c.yellow}missing table${c.reset}  ${t}`);
  }
  for (const col of verified.missingColumns) {
    log(`    ${c.yellow}missing column${c.reset} ${col}`);
  }

  if (outcome === "incomplete") {
    warn(
      `This database is already recorded at app v${meta.appVersion}, so these should exist. Starting the app creates what its boot schema has; run this again afterwards, and if the same items are listed, the boot log says why they could not be created.`,
    );
    process.exit(1);
  }

  info(
    `The first boot of v${projectMeta.version} creates these, so this is expected before the restart.`,
  );
  // Left at the older version on purpose. Recording this release now would
  // make the next run read the same expected gap as a failure.
  return meta?.appVersion ?? projectMeta.version;
}

// ── Big red warning for downgrades ────────────────────────────────────────
function showDowngradeWarning(current, target, destructiveSteps) {
  const dropTables = destructiveSteps.filter((s) => s.kind === "dropTable");
  const dropColumns = destructiveSteps.filter((s) => s.kind === "dropColumn");
  // AUDIT-013 migrate-15: destructive steps of kind "dataUpdate" were
  // excluded from both filters above, so the 3.0.0 -> 2.0.0 downgrade's
  // `DELETE FROM users WHERE password_hash IS NULL` never appeared in the
  // box the operator types the confirmation phrase into. Every OAuth-only
  // account was deleted, and every purchased AI credit balance zeroed,
  // without either being named anywhere the operator could see. Their
  // labels are the only description that exists, so print those.
  const dataLosses = destructiveSteps.filter((s) => s.kind === "dataUpdate");

  const body = [
    `You are DOWNGRADING from ${c.bold}${current}${c.reset} to ${c.bold}${target}${c.reset}.`,
    "",
    "This will PERMANENTLY DELETE:",
  ];
  if (dropTables.length > 0) {
    body.push(
      `  ${c.red}•${c.reset} ${c.bold}${dropTables.length} table(s)${c.reset} ${c.dim}(${dropTables
        .map((s) => s.dataLoss?.table)
        .filter(Boolean)
        .slice(0, 4)
        .join(", ")}${dropTables.length > 4 ? ", ..." : ""})${c.reset}`,
    );
  }
  if (dropColumns.length > 0) {
    body.push(
      `  ${c.red}•${c.reset} ${c.bold}${dropColumns.length} column(s)${c.reset} ${c.dim}(${dropColumns
        .map((s) => `${s.dataLoss.table}.${s.dataLoss.column}`)
        .slice(0, 3)
        .join(", ")})${c.reset}`,
    );
  }
  if (dataLosses.length > 0) {
    body.push(
      `  ${c.red}•${c.reset} ${c.bold}${dataLosses.length} row-level change(s)${c.reset} ${c.dim}(not a table or column drop, real data loss all the same)${c.reset}`,
    );
    for (const s of dataLosses) {
      body.push(`      ${c.red}!${c.reset} ${s.label}`);
    }
  }
  body.push("");
  body.push(
    `${c.bold}All data in dropped tables/columns will be LOST FOREVER.${c.reset}`,
  );
  body.push("");
  body.push(`${c.yellow}Before continuing:${c.reset}`);
  body.push(`  ${c.yellow}1.${c.reset} Back up your database.`);
  body.push(
    `  ${c.yellow}2.${c.reset} Confirm you actually want to go BACKWARDS.`,
  );
  body.push(
    `  ${c.yellow}3.${c.reset} Have a recovery plan if something goes wrong.`,
  );
  body.push("");
  body.push(
    `${c.bold}To continue:${c.reset} type ${c.bold}${c.red}yes-delete-data${c.reset}`,
  );
  body.push(`${c.bold}To cancel:${c.reset}   type ${c.bold}n${c.reset}`);

  warningBox(`DESTRUCTIVE OPERATION: DOWNGRADING ${current} → ${target}`, body);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const projectMeta = getProjectMeta();
  const recommended = getRecommendedVersion(projectMeta.version);

  loadEnv();
  requireDatabaseUrl();

  const parsed = parseDbUrl(process.env.DATABASE_URL);
  if (!parsed) {
    error("Could not parse DATABASE_URL.");
    process.exit(1);
  }

  // 1. Welcome banner: the very first thing the user sees.
  showWelcome(projectMeta, `${parsed.host}:${parsed.port}`);

  // 2. Connect.
  const pool = createPool();
  if (!(await connect(pool))) {
    await pool.end();
    process.exit(1);
  }
  success(`Connected to ${c.dim}${parsed.host}:${parsed.port}${c.reset}`);
  log("");

  // 3. Pick the target database.
  const chosenDb = await chooseDatabase(parsed, {
    currentDb: parsed.database,
    prompt: "Which database to migrate",
  });
  if (chosenDb === null) {
    info("Cancelled.");
    await pool.end();
    return;
  }
  if (chosenDb !== parsed.database) {
    process.env.DATABASE_URL = buildConnectionString(parsed, chosenDb);
  }
  success(`Target database: ${c.bold}${chosenDb}${c.reset}`);
  log("");

  // Re-create pool against the chosen database.
  await pool.end();
  const livePool = createPool();
  if (!(await connect(livePool))) {
    await livePool.end();
    process.exit(1);
  }

  try {
    // 4. Detect current version.
    section("Step 1: Detect current schema version");
    await ensureMetaTable(livePool);
    let meta = await readMeta(livePool);
    let current;

    // Trust the meta table ONLY if its version is one we still know
    // about. Otherwise (e.g. a stale "2.3.0" entry from the old script)
    // fall through to fingerprint detection so the meta gets corrected.
    let metaIsCurrent = false;
    if (meta) {
      try {
        getVersion(meta.schemaVersion);
        metaIsCurrent = true;
      } catch {
        warn(
          `Meta table says ${c.bold}${meta.schemaVersion}${c.reset}, but that version is no longer tracked. Re-detecting via fingerprint.`,
        );
      }
    }

    if (metaIsCurrent) {
      current = meta.schemaVersion;
      info(
        `Meta table says: ${c.bold}${current}${c.reset} ${c.dim}(app: ${meta.appVersion}, applied: ${meta.appliedAt.toISOString()})${c.reset}`,
      );
    } else {
      if (!meta) info("No meta row: fingerprint-detecting...");
      const actual = await getActualSchema(livePool);
      const detected = fingerprintDetect(actual);
      if (!detected.version) {
        error(
          "Could not detect a known schema version. The database has tables/columns that don't match v1 or v2.",
        );
        warn(
          "This usually means the database has tables from a different project or a partial migration.",
        );
        process.exit(1);
      }
      current = detected.version;
      info(
        `Detected: ${c.bold}${current}${c.reset} ${c.dim}(confidence: ${detected.confidence})${c.reset} ${c.dim}·${c.reset} ${detected.reason}`,
      );
      // AUDIT-013 migrate-08: an unattended run has nobody to sanity-check
      // a guess, and acting on a wrong guess is how a half-migrated
      // database gets stamped as complete. Only "high" is acted on
      // without a human.
      if (NON_INTERACTIVE && detected.confidence !== "high") {
        error(
          `Refusing to migrate on a ${detected.confidence}-confidence version detection in an unattended run. Run npm run db:migrate interactively, or npm run db:diagnose to see what is missing.`,
        );
        process.exit(1);
      }
      info(
        `Meta not yet written. It will be recorded after a migration (or initialized if you pick the same version below).`,
      );
    }
    log("");

    // 5. Pick target version.
    section("Step 2: Pick target version");
    const target = await pickTargetVersion(recommended);
    if (target === null) {
      info("Cancelled.");
      return;
    }
    log("");

    // Determine direction. "same" means current === target: there is no
    // DDL to run, but the live schema is still checked and the meta row
    // brought up to date.
    const direction = isUpgrade(current, target)
      ? "upgrade"
      : isDowngrade(current, target)
        ? "downgrade"
        : "same";

    // 6. Plan summary (always shown, even for same version).
    section("Step 3: Plan summary");
    showPlanSummary({
      meta: projectMeta,
      current,
      target,
      direction,
      dbTarget: `${chosenDb} on ${parsed.host}:${parsed.port}`,
      recommended,
    });

    // 7. Build the plan. Empty if current === target.
    const plan = await buildPlan(
      current,
      target,
      direction === "same" ? null : direction,
    );

    // 8. Render the plan steps (or "no changes" message for same version).
    section("Step 4: Detailed plan");
    const destructiveSteps = plan.steps.filter((s) => s.destructive);
    if (plan.steps.length === 0) {
      if (direction === "same") {
        info(
          `No DDL to run: already at ${c.bold}${current}${c.reset}. The live schema is still checked against it below.`,
        );
      } else {
        info("No changes needed.");
      }
    } else {
      renderPlan(plan);
    }
    log("");

    // 9. Big red warning for downgrades.
    if (direction === "downgrade" && destructiveSteps.length > 0) {
      showDowngradeWarning(current, target, destructiveSteps);
    }

    // 10. Confirmation gate.
    if (DRY_RUN) {
      if (plan.steps.length === 0) {
        log("");
        info(`[DRY-RUN] No SQL to run. Plan is empty.`);
        if (direction === "same") {
          await checkSameVersionSchema(livePool, target, meta, projectMeta);
        }
      } else {
        info(
          `[DRY-RUN] SQL will run inside a transaction that's ROLLED BACK at the end. No persistent changes.`,
        );
        log("");
        const result = await runPlan(livePool, plan, { dryRun: true });
        if (result.failed > 0) {
          log("");
          error(
            `Dry-run encountered ${result.failed} SQL error(s). The plan is not safe to run.`,
          );
          process.exit(1);
        }
      }
      log("");
      success("Dry-run successful. Remove --dry-run to apply for real.");
      return;
    }

    // Real run.
    if (direction === "downgrade") {
      // A downgrade never runs unattended, full stop -- typing the exact
      // confirmation phrase is the whole point of the extra bar this
      // sets over a plain y/n, and there is no safe non-interactive
      // default to substitute for it. Checked explicitly here (on top of
      // askExact's own NON_INTERACTIVE guard) so this exits non-zero
      // instead of falling through to the generic "Confirmation failed"
      // path, which only ever `return`s -- exit code 0, indistinguishable
      // from success to whatever spawned this.
      if (NON_INTERACTIVE) {
        error(
          "Refusing to run a schema downgrade unattended. Downgrades require typing an exact confirmation phrase interactively -- rerun this in a real terminal.",
        );
        process.exit(1);
      }
      const confirmed = await askExact(
        `Type ${c.bold}${c.red}yes-delete-data${c.reset} to confirm (or ${c.bold}n${c.reset} to cancel)`,
        "yes-delete-data",
      );
      if (!confirmed) {
        info("Confirmation failed. Aborted.");
        return;
      }
    } else if (destructiveSteps.length > 0) {
      warn(`This upgrade drops ${destructiveSteps.length} table(s)/column(s).`);
      // Unlike a downgrade, these are routine, reviewed schema changes
      // that ship as part of the release being applied (e.g. dropping a
      // superseded column) -- the admin already approved applying this
      // exact version before this script ever ran. Auto-proceeding here
      // (rather than reusing askYesNo's own interactive default of "no")
      // is what lets the self-updater's unattended `npm run db:migrate`
      // actually complete instead of always failing on the first real
      // release that includes one of these.
      if (NON_INTERACTIVE) {
        info(
          `Unattended run: proceeding automatically with ${destructiveSteps.length} destructive step(s) shipped as part of this release.`,
        );
      } else if (
        !(await askYesNo(
          `Continue with ${destructiveSteps.length} destructive step(s)?`,
          false,
        ))
      ) {
        info("Cancelled.");
        return;
      }
    } else if (plan.steps.length > 0) {
      if (!(await askYesNo("Proceed with the migration?", true))) {
        info("Cancelled.");
        return;
      }
    } else {
      // Empty plan + non-dry-run + non-downgrade = same version. No
      // confirmation needed; we'll just write meta and exit.
    }
    log("");

    // 11. Back up before touching anything -- only when there's real DDL
    // about to run (a same-version no-op re-run has nothing to protect
    // against). Labeled with the version being migrated FROM, since
    // that's the state this snapshot can actually restore.
    if (plan.steps.length > 0) {
      section("Step 5: Back up database");
      const mayProceed = await runPreMigrationBackup({
        connectionString: process.env.DATABASE_URL,
        schemaVersion: current,
        skip: SKIP_BACKUP,
      });
      if (!mayProceed) process.exit(1);
      log("");
    }

    // 12. Execute.
    section("Step 6: Execute");
    let appVersionToRecord = projectMeta.version;
    if (plan.steps.length === 0) {
      log(
        `  ${c.dim}0.${c.reset}  ${c.dim}SKIP${c.reset}  (no DDL to run; schema is already at the target version)`,
      );
      log("");
      success(
        `No DDL changes needed. Schema is already at ${c.bold}${current}${c.reset}.`,
      );
      // Still repair sequences on same-version re-runs so any desync
      // introduced outside of migrations (imports, seeds) gets fixed.
      // AUDIT-009 migration-03: guarded, like the call in runPlan. This is
      // a safety net running after the work is already done; a failure
      // here must not turn a successful no-op re-run into a reported
      // failure that also skips the meta-row write below.
      const seqClient = await livePool.connect();
      try {
        await repairAllSequences(seqClient);
      } catch (seqErr) {
        warn(`Sequence repair failed (non-fatal): ${seqErr.message}`);
      } finally {
        seqClient.release();
      }
      if (direction === "same") {
        appVersionToRecord = await checkSameVersionSchema(
          livePool,
          target,
          meta,
          projectMeta,
        );
      }
    } else {
      // AUDIT-013 migrate-05: the schema-version marker is written as the
      // last statement INSIDE the migration's own transaction, not as a
      // separate commit afterwards. Before, a migration reached durability
      // in three independent commits (the DDL, then sequence repair, then
      // writeMeta), so a killed process or a dropped connection anywhere
      // after the DDL COMMIT left a fully migrated database whose meta row
      // still held the old version. instrumentation.ts then compared that
      // stale version against MIN_SCHEMA_VERSION and process.exit(1)'d
      // with a SCHEMA VERSION MISMATCH box: the app would not start at all,
      // on a database that was actually correct, and the message told the
      // operator the opposite of what was true.
      const result = await runPlan(livePool, plan, {
        dryRun: false,
        beforeCommit: (client) =>
          writeMeta(client, {
            schemaVersion: target,
            appVersion: projectMeta.version,
          }),
      });
      if (result.failed > 0) {
        error(`Migration failed with ${result.failed} error(s).`);
        process.exit(1);
      }

      // AUDIT-013 migrate-09: verify the schema actually reached the
      // target before reporting success. The registry's own header has
      // always said fingerprints are used "for verifying a target version
      // was reached after a migration"; that half did not exist, so there
      // was no gate at all between "every statement executed without
      // error" and "the schema is now version X". That is the structural
      // reason the same drift shipped twice (AUDIT-009 migration-01, then
      // AUDIT-013 migrate-01) while db:migrate kept reporting success.
      const verified = await verifyTargetSchema(livePool, target);
      if (!verified.ok) {
        error(
          `Migration ran, but the resulting schema does not match ${target}.`,
        );
        for (const t of verified.missingTables) {
          log(`    ${c.red}missing table${c.reset}  ${t}`);
        }
        for (const col of verified.missingColumns) {
          log(`    ${c.red}missing column${c.reset} ${col}`);
        }
        warn(
          "The DDL is committed and the meta row records the target version, so re-running db:migrate is safe and is the first thing to try. If the same items are still missing afterwards, the version file for this transition is incomplete.",
        );
        process.exit(1);
      }
      success(
        `Verified: every ${target} table and column is present (${verified.checkedTables} tables checked).`,
      );
    }

    // 13. Update the meta table. For a real migration this already
    // happened inside the transaction above (see beforeCommit); this is
    // the same-version path, where there is no transaction to ride along
    // with. The upsert is idempotent either way.
    await writeMeta(livePool, {
      schemaVersion: target,
      appVersion: appVersionToRecord,
    });
    if (direction === "same") {
      const isAppRecommended = recommended.name === current;
      success(
        `Schema is at ${c.bold}${current}${c.reset} ${c.dim}(meta table updated)${c.reset}${
          isAppRecommended
            ? ""
            : ` ${c.dim}(app v${projectMeta.version} recommends ${recommended.name})${c.reset}`
        }`,
      );
    } else {
      success(
        `Schema is now ${c.bold}${target}${c.reset} ${c.dim}(meta table updated)${c.reset}`,
      );
    }
  } finally {
    await livePool.end();
  }
}

main().catch((err) => {
  error(err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
