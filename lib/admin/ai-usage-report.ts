import pool from "@/lib/database/db";
import { resolveCurrentWindow } from "@/lib/billing/ai-usage";

/**
 * Site-wide AI token spend, for the billing overview.
 *
 * There was no admin view of AI usage at all: no total per window and no way
 * to see who was using the budget, which is the first thing needed to price a
 * plan's allowance or to find one account eating it. ai_usage already holds
 * one row per user per fixed window, so both answers are reads.
 *
 * ai_usage has no index on window_start alone, so both queries are bounded by
 * it: the history to the last 30 windows' worth of time, the leaderboard to
 * the one window it names. A table that grows with users stays a range scan.
 */

/** Windows of history shown. */
export const AI_USAGE_WINDOWS_SHOWN = 30;
/** Accounts on the leaderboard. */
export const AI_USAGE_TOP_USERS = 10;

export interface AiUsageWindow {
  windowStart: string;
  tokensUsed: number;
  users: number;
}

export interface AiUsageTopUser {
  id: number;
  email: string;
  name: string | null;
  tokensUsed: number;
}

export interface AiUsageReport {
  windowHours: number;
  /** The window still filling, which is the first row of `windows`. */
  currentWindowStart: string;
  /** Newest first. */
  windows: AiUsageWindow[];
  /** Heaviest accounts in the current window. */
  topUsers: AiUsageTopUser[];
}

/**
 * The two reads run one after the other, not together: the billing overview
 * calls this beside its own queries, and sequencing these keeps that request
 * at four pool connections at most.
 */
export async function getAiUsageReport(): Promise<AiUsageReport> {
  const { windowStart, windowHours } = await resolveCurrentWindow();
  const since = new Date(
    windowStart.getTime() -
      (AI_USAGE_WINDOWS_SHOWN - 1) * windowHours * 60 * 60 * 1000,
  );

  const windows = await pool.query<{
    window_start: string | Date;
    tokens_used: string | number;
    users: number;
  }>(
    `SELECT window_start, SUM(tokens_used) AS tokens_used,
            COUNT(DISTINCT user_id)::int AS users
       FROM ai_usage
      WHERE window_start >= $1
      GROUP BY window_start
      ORDER BY window_start DESC
      LIMIT ${AI_USAGE_WINDOWS_SHOWN}`,
    [since],
  );
  const top = await pool.query<{
    id: number;
    email: string;
    name: string | null;
    tokens_used: string | number;
  }>(
    `SELECT u.id, u.email, u.name, a.tokens_used
       FROM ai_usage a
       JOIN users u ON u.id = a.user_id
      WHERE a.window_start = $1
      ORDER BY a.tokens_used DESC, u.id
      LIMIT ${AI_USAGE_TOP_USERS}`,
    [windowStart],
  );

  return {
    windowHours,
    currentWindowStart: windowStart.toISOString(),
    windows: windows.rows.map((row) => ({
      windowStart:
        row.window_start instanceof Date
          ? row.window_start.toISOString()
          : row.window_start,
      // SUM(integer) is a bigint, which node-postgres hands back as a string.
      tokensUsed: Number(row.tokens_used),
      users: Number(row.users),
    })),
    topUsers: top.rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      tokensUsed: Number(row.tokens_used),
    })),
  };
}
