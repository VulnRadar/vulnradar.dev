/**
 * Applying lib/database/schema at boot.
 *
 * The steps, their order and their guards all live in lib/database/schema so
 * that `npm run db:create` runs the identical list. This file is only the
 * boot-side wiring: how a warning is logged, and how the three steps whose DDL
 * is owned by a TypeScript helper module are resolved.
 *
 * Those three (staff_invites, admin_audit_log_archive, the posture-digest
 * columns) each export an idempotent ensure*() function with its own unit
 * test, so the boot path calls the function rather than a copy of its SQL.
 * `npm run db:create` cannot import TypeScript, so it reads the same
 * statements out of the same file (see moduleStepStatements in
 * scripts/_lib/_lib.schema-parity.mjs). Either way there is one copy of the
 * DDL, and either way it now runs in this position rather than being appended
 * after every other statement, which is what used to make db:create create the
 * index on staff_invites before the table.
 */

import type { Pool } from "pg";
import { applySchema } from "@/lib/database/schema/index.mjs";

type SchemaStep = { id: string; moduleSource?: string; warning?: string };

/**
 * The ensure*() helper each moduleSource step calls. Keyed by the same path
 * the step declares, so a step naming a module with no entry here fails loudly
 * at boot instead of silently skipping the table.
 */
const MODULE_STEP_RUNNERS: Record<string, (pool: Pool) => Promise<void>> = {
  "lib/admin/staff-invites.ts": async () => {
    const { ensureStaffInvitesTable } =
      await import("@/lib/admin/staff-invites");
    await ensureStaffInvitesTable();
  },
  "lib/database/audit-log-archive.ts": async (pool) => {
    const { ensureAuditLogArchiveTable } =
      await import("@/lib/database/audit-log-archive");
    await ensureAuditLogArchiveTable(pool);
  },
  "lib/notifications/digest-schema.ts": async () => {
    const { ensureDigestSchema } =
      await import("@/lib/notifications/digest-schema");
    await ensureDigestSchema();
  },
};

export async function applyBootSchema(
  pool: Pool,
  appName: string,
): Promise<void> {
  await applySchema(pool, {
    onNotice: (message: string) => console.log(message),
    onWarn: (step: SchemaStep, error: unknown) => {
      console.error(
        `[${appName}] ${step.warning ?? `Schema step ${step.id} failed`} (non-fatal):`,
        error instanceof Error ? error.message : error,
      );
    },
    runModuleStep: async (step: SchemaStep) => {
      const run = MODULE_STEP_RUNNERS[step.moduleSource as string];
      if (!run) {
        throw new Error(
          `no boot runner registered for schema step "${step.id}" (${step.moduleSource})`,
        );
      }
      await run(pool);
    },
  });
  console.log(`[${appName}] Database schema verified successfully.`);
}
