/**
 * Applying lib/database/schema at boot.
 *
 * The steps, their order and their guards all live in lib/database/schema so
 * that `npm run db:create` runs the identical list. This file is only the
 * boot-side wiring: the connection the schema runs on, how a warning is
 * logged, and how the three steps whose DDL is owned by a TypeScript helper
 * module are resolved.
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
 * How long one boot statement may run. The app pool's 30 seconds is right for
 * a request and wrong for a migration: a new index or a backfill on a large
 * table was cancelled at 30 seconds, logged as a warning, and cancelled again
 * on every boot after it, so it never finished (ops-10).
 */
export const BOOT_STATEMENT_TIMEOUT = "10min";

/**
 * How long one boot statement may wait for a lock. Without one, a DDL
 * statement queued behind a long transaction (a pg_dump, a report) waited for
 * as long as that transaction ran, and every query on the table queued behind
 * the DDL. The schema runner retries a step that times out and skips it when
 * the catalog shows it is already applied (bug-db-3).
 */
export const BOOT_LOCK_TIMEOUT = "5s";

/**
 * node-postgres enforces the pool's query_timeout (30 s) on the client side
 * as well, whatever the server allows, so each boot query carries its own,
 * a little past the server's limit so the server's cancellation is the one
 * that arrives.
 */
export const BOOT_QUERY_TIMEOUT_MS = 10 * 60 * 1000 + 30 * 1000;

/** The query surface the schema and the backfills need from the client. */
export interface BootExecutor {
  query: Pool["query"];
}

type BootClient = {
  query: (config: {
    text: string;
    values?: unknown[];
    query_timeout?: number;
  }) => Promise<unknown>;
  release: (destroy?: boolean) => void;
};

/**
 * Run `work` on a connection of its own with the boot timeouts set.
 *
 * Its own connection because SET applies to a session: setting these through
 * pool.query would land on whichever pooled connection answered and then
 * reach the requests that connection serves next. The connection is
 * destroyed afterwards rather than returned, so no request ever runs with a
 * ten-minute statement timeout.
 */
export async function withBootClient<T>(
  pool: Pool,
  work: (executor: BootExecutor) => Promise<T>,
): Promise<T> {
  const client = (await pool.connect()) as unknown as BootClient;
  try {
    const run = (text: string, values?: unknown[]) =>
      client.query({ text, values, query_timeout: BOOT_QUERY_TIMEOUT_MS });
    await run(`SET statement_timeout = '${BOOT_STATEMENT_TIMEOUT}'`);
    await run(`SET lock_timeout = '${BOOT_LOCK_TIMEOUT}'`);
    return await work({ query: run as unknown as Pool["query"] });
  } finally {
    client.release(true);
  }
}

/**
 * The ensure*() helper each moduleSource step calls. Keyed by the same path
 * the step declares, so a step naming a module with no entry here fails loudly
 * at boot instead of silently skipping the table.
 */
const MODULE_STEP_RUNNERS: Record<
  string,
  (executor: BootExecutor) => Promise<void>
> = {
  "lib/admin/staff-invites.ts": async () => {
    const { ensureStaffInvitesTable } =
      await import("@/lib/admin/staff-invites");
    await ensureStaffInvitesTable();
  },
  "lib/database/audit-log-archive.ts": async (executor) => {
    const { ensureAuditLogArchiveTable } =
      await import("@/lib/database/audit-log-archive");
    await ensureAuditLogArchiveTable(executor as Pool);
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
  await withBootClient(pool, (executor) =>
    applySchema(executor, {
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
        await run(executor);
      },
    }),
  );
  console.log(`[${appName}] Database schema verified successfully.`);
}
