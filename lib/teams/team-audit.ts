import { getClientIp } from "@/lib/api/request-utils";
import pool from "@/lib/database/db";

/**
 * Write one team audit row without letting it decide the response.
 *
 * Every caller has already committed the change. A failed INSERT turning into
 * a 500 would tell someone their removal or rename failed when it happened,
 * and would skip the notice mail that follows it.
 *
 * The write is a callback so the logAction(..., "literal") stays at the call
 * site: an action name passed through a parameter here is one neither the type
 * nor tests/lib/admin/audit-actions.test.ts could read.
 */
export async function recordTeamAudit(
  write: (ip: string | undefined) => Promise<void>,
): Promise<void> {
  try {
    await write((await getClientIp()) || undefined);
  } catch (err) {
    console.error("[teams] Failed to write an audit row:", err);
  }
}

/** The name as well as the id: the team may be gone when someone reads this. */
export function teamAuditLabel(teamId: number, name?: string | null): string {
  return name ? `"${name}" (#${teamId})` : `#${teamId}`;
}

export async function readTeamAuditLabel(teamId: number): Promise<string> {
  const res = await pool.query<{ name: string }>(
    "SELECT name FROM teams WHERE id = $1",
    [teamId],
  );
  return teamAuditLabel(teamId, res.rows[0]?.name);
}
