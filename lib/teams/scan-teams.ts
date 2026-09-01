import pool from "@/lib/database/db";
import { APP_NAME, hasTeamPermission } from "@/lib/config/constants";
import { hasGodMode } from "@/lib/auth/permissions-client";
import { getAssignableTeamIds } from "@/lib/auth/team-resource-access";

/**
 * Multi-team scan sharing.
 *
 * A scan used to belong to at most ONE team: `scan_history.team_id`, a single
 * nullable FK. That is why the share picker in
 * components/scanner/scan-actions-menu.tsx was a radiogroup -- the data model
 * had no way to express "this scan is shared with security AND platform", so
 * picking a second team silently un-shared the first.
 *
 * The set now lives in the `scan_history_teams` join table.
 * `scan_history.team_id` is NOT dropped: it is kept in sync as the PRIMARY
 * team (the first id of the set, NULL when the set is empty). Two reasons,
 * both about not losing data on the way through:
 *
 *  1. Rolling back the migration must not destroy every existing assignment.
 *     Dropping the column in the same change that introduces its replacement
 *     makes the rollback lossy by construction.
 *  2. Several write paths outside this module still know only the column:
 *     lib/scanner/scheduled-scans-worker.ts copies a schedule's team onto each
 *     run, and lib/scanner/execute-crawl-scan.ts copies the crawl parent's
 *     team onto every discovered page. A row those write has a `team_id` and
 *     no join row until the next boot backfill, so every read below matches
 *     the column OR the join table. A scan can therefore never silently stop
 *     appearing for the team it was shared with.
 */

export interface ScanTeamAccess {
  canRead: boolean;
  canWrite: boolean;
}

/** The scan_history fields every access decision here needs. */
export interface ScanTeamSubject {
  id: number;
  user_id: number;
  team_id: number | null;
}

/**
 * A SQL predicate matching a scan_history row against one team id.
 *
 * Both arguments are compile-time literals from this codebase (a table alias
 * and a bind-parameter placeholder), never request data: the team id itself
 * is always bound, never interpolated. Shared rather than written out at each
 * call site so the "join table OR legacy column" rule cannot drift between
 * the list query and its COUNT.
 */
export function scanTeamMatchSql(alias: string, teamParam: string): string {
  return `(${alias}.team_id = ${teamParam} OR EXISTS (
     SELECT 1 FROM scan_history_teams sht
      WHERE sht.scan_id = ${alias}.id AND sht.team_id = ${teamParam}
   ))`;
}

/**
 * Every team a scan is shared with, ascending. Unions the join table with the
 * legacy column so a row written by a path that only knows `team_id` still
 * resolves to its team.
 */
export async function getScanTeamIds(scanId: number): Promise<number[]> {
  const res = await pool.query<{ team_id: number }>(
    `SELECT team_id FROM scan_history_teams WHERE scan_id = $1
     UNION
     SELECT team_id FROM scan_history WHERE id = $1 AND team_id IS NOT NULL
     ORDER BY team_id`,
    [scanId],
  );
  return res.rows.map((r) => r.team_id);
}

/**
 * Whether `callerId` may read/write a scan owned by `scanOwnerId` and shared
 * with `teamIds`. The single-team rules from
 * lib/auth/team-resource-access.ts's getTeamResourceAccess, widened to a set:
 *
 * - The scan's own creator always has full access.
 * - Empty set: only the owner has access. A personal scan stays personal.
 * - Otherwise the strongest role the caller holds across the set wins, so
 *   being a viewer in one of the scan's teams and a member in another reads
 *   as "member". Sharing into a second team can only ever widen access, which
 *   is the whole point of sharing.
 * - GOD_MODE exception, unchanged: when the scan's owner is a super_admin, no
 *   team role grants write to anyone but the owner.
 */
export async function getScanTeamAccess(
  callerId: number,
  scanOwnerId: number,
  teamIds: number[],
): Promise<ScanTeamAccess> {
  if (callerId === scanOwnerId) return { canRead: true, canWrite: true };
  if (teamIds.length === 0) return { canRead: false, canWrite: false };

  const memberRes = await pool.query<{ role: string }>(
    "SELECT role FROM team_members WHERE user_id = $1 AND team_id = ANY($2::int[])",
    [callerId, teamIds],
  );
  const roles = memberRes.rows.map((r) => r.role);
  if (roles.length === 0) return { canRead: false, canWrite: false };

  const canRead = roles.some((role) => hasTeamPermission(role, "view_reports"));
  if (!canRead) return { canRead: false, canWrite: false };

  const ownerRes = await pool.query<{ role: string | null }>(
    "SELECT role FROM users WHERE id = $1",
    [scanOwnerId],
  );
  if (hasGodMode(ownerRes.rows[0]?.role)) {
    return { canRead: true, canWrite: false };
  }

  return {
    canRead: true,
    canWrite: roles.some((role) => hasTeamPermission(role, "manage_scans")),
  };
}

/**
 * Drop-in replacement for getTeamResourceAccess at every scan call site: same
 * shape, but resolved over the scan's whole team set instead of one column.
 * Short-circuits for the owner so the common case costs no extra query.
 */
export async function getScanResourceAccess(
  callerId: number,
  scan: ScanTeamSubject,
): Promise<ScanTeamAccess> {
  if (callerId === scan.user_id) return { canRead: true, canWrite: true };
  const teamIds = await getScanTeamIds(scan.id);
  return getScanTeamAccess(callerId, scan.user_id, teamIds);
}

export type ParsedTeamIds =
  | { ok: true; provided: boolean; teamIds: number[] }
  | { ok: false; error: string };

/**
 * Read a team assignment off a request body, accepting both shapes.
 *
 * `teamIds: number[]` is the current contract and is a full REPLACEMENT set:
 * whatever it names is exactly what the scan ends up shared with, `[]` for
 * nobody. `teamId: number | null` is the original single-valued contract,
 * still accepted because PATCH /api/v3/history/[id] and the scan-creation
 * routes are public API: it means the same as a one- (or zero-) element
 * array. Sending both is rejected rather than silently resolved, since there
 * is no honest way to guess which one the caller meant.
 */
export function parseTeamIdsInput(body: {
  teamId?: unknown;
  teamIds?: unknown;
}): ParsedTeamIds {
  const hasSingle = body.teamId !== undefined;
  const hasMany = body.teamIds !== undefined;

  if (hasSingle && hasMany) {
    return {
      ok: false,
      error: "Send either teamId or teamIds, not both.",
    };
  }

  if (!hasSingle && !hasMany) return { ok: true, provided: false, teamIds: [] };

  if (hasMany && !Array.isArray(body.teamIds)) {
    return {
      ok: false,
      error:
        "Invalid teamIds. Send an array of team ids, or [] for a personal scan.",
    };
  }

  const raw: unknown[] = hasMany
    ? (body.teamIds as unknown[])
    : body.teamId === null
      ? []
      : [body.teamId];

  const teamIds: number[] = [];
  for (const value of raw) {
    if (!Number.isInteger(value) || (value as number) <= 0) {
      return {
        ok: false,
        error: hasMany
          ? "Invalid teamIds. Send an array of team ids, or [] for a personal scan."
          : "Invalid teamId. Use a team id, or null for a personal scan.",
      };
    }
    // A caller repeating an id is not an error, it just means the same team
    // once. Deduplicating here keeps the join-table write and the diff below
    // from having to care.
    if (!teamIds.includes(value as number)) teamIds.push(value as number);
  }

  return { ok: true, provided: true, teamIds };
}

export type ResolvedScanTeams =
  | { ok: true; teamIds: number[]; primaryTeamId: number | null }
  | { ok: false; error: string };

/**
 * Validate the team set for a scan being CREATED. Omitted means a personal
 * scan, which stays the default: a scan is only ever shared with a team
 * because the request said so, never because the caller happens to be in one.
 *
 * Every named team is checked against getAssignableTeamIds rather than
 * trusted -- assigning a scan to a team the caller does not manage would
 * publish it to strangers.
 */
export async function resolveNewScanTeamIds(
  callerId: number,
  body: { teamId?: unknown; teamIds?: unknown },
): Promise<ResolvedScanTeams> {
  const parsed = parseTeamIdsInput(body);
  if (!parsed.ok) return parsed;
  if (parsed.teamIds.length === 0) {
    return { ok: true, teamIds: [], primaryTeamId: null };
  }

  const assignable = await getAssignableTeamIds(callerId);
  const forbidden = parsed.teamIds.filter((id) => !assignable.includes(id));
  if (forbidden.length > 0) {
    return { ok: false, error: assignmentErrorFor(forbidden) };
  }
  return {
    ok: true,
    teamIds: parsed.teamIds,
    primaryTeamId: parsed.teamIds[0],
  };
}

/**
 * Authorize a change to an EXISTING scan's team set, given the set it has now
 * and the one the caller asked for.
 *
 * The gate is the symmetric difference, not just the additions. With a
 * replacement-array contract, OMITTING a team is how you remove it, so
 * checking only what was added would let a caller who manages team A but not
 * team B send `teamIds: [A]` on a scan shared with both and silently drop B.
 * Adding a scan to a team and taking one out of a team are both changes to
 * that team's shared work, so both require manage_scans in the team
 * concerned.
 *
 * Consequence worth knowing: an owner who has been demoted to viewer in a
 * team can no longer un-share from it. That is deliberate. Deleting the scan
 * still works, and the alternative (ungated removal) is a way to quietly pull
 * a scan out from under a team that is relying on it.
 */
export async function authorizeScanTeamChange(
  callerId: number,
  currentTeamIds: number[],
  nextTeamIds: number[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const added = nextTeamIds.filter((id) => !currentTeamIds.includes(id));
  const removed = currentTeamIds.filter((id) => !nextTeamIds.includes(id));
  const changed = [...added, ...removed];
  if (changed.length === 0) return { ok: true };

  const assignable = await getAssignableTeamIds(callerId);
  const forbidden = changed.filter((id) => !assignable.includes(id));
  if (forbidden.length > 0) {
    return { ok: false, error: assignmentErrorFor(forbidden) };
  }
  return { ok: true };
}

/**
 * Wording kept close to the original single-team message ("You cannot assign
 * scans to that team.") so an API client matching on it does not break, while
 * still naming which ids were refused once a request can carry several.
 */
function assignmentErrorFor(forbidden: number[]): string {
  return forbidden.length === 1
    ? "You cannot assign scans to that team."
    : `You cannot assign scans to those teams (${forbidden.join(", ")}).`;
}

/**
 * Make `teamIds` the scan's complete team set.
 *
 * One statement, so the join-table rewrite and the primary-team column can
 * never be left disagreeing by a failure in between. `<> ALL` over an empty
 * array is true for every row, so an empty set clears the scan; `unnest` over
 * an empty array yields no rows, so the INSERT is a no-op there.
 *
 * ON CONFLICT (scan_id, team_id) names the join table's composite primary
 * key. It matters under concurrency: two PATCHes adding the same team at once
 * would otherwise raise a duplicate-key error on one of them.
 */
export async function setScanTeams(
  scanId: number,
  teamIds: number[],
): Promise<void> {
  await pool.query(
    `WITH removed AS (
       DELETE FROM scan_history_teams
        WHERE scan_id = $1 AND team_id <> ALL($2::int[])
     ), added AS (
       INSERT INTO scan_history_teams (scan_id, team_id)
       SELECT $1, t FROM unnest($2::int[]) AS t
       ON CONFLICT (scan_id, team_id) DO NOTHING
     )
     UPDATE scan_history SET team_id = $3 WHERE id = $1`,
    [scanId, teamIds, teamIds[0] ?? null],
  );
}

/**
 * Share a NEWLY created scan with the rest of its teams.
 *
 * Every scan-creation route already writes the primary team into
 * scan_history.team_id as part of its own INSERT, and one team is the whole
 * story for all but a multi-team request, so this does nothing at all below
 * two teams: the read paths match the column as well as the join table.
 *
 * Deliberately best-effort. The scan row exists by the time this runs and a
 * failure here would otherwise turn "shared with one team instead of two"
 * into "the scan request 500'd", which is much the worse outcome.
 */
export async function attachNewScanTeams(
  scanId: number,
  teamIds: number[],
): Promise<void> {
  if (teamIds.length < 2) return;
  try {
    await setScanTeams(scanId, teamIds);
  } catch (error) {
    console.error(
      `[${APP_NAME}] Failed to share scan ${scanId} with every requested team:`,
      error instanceof Error ? error.message : error,
    );
  }
}
