import {
  UNLIMITED_API_KEY_DAILY_LIMIT,
  peekRateLimit,
} from "@/lib/api/api-keys";
import { canMakeRequest } from "@/lib/rate-limiting/daily-limits";

export interface QuotaWindow {
  /** Null means unlimited. */
  limit: number | null;
  used: number;
  /** Null means unlimited. */
  remaining: number | null;
  resetsAt: string;
}

export interface QuotaBlock {
  /** The plan's daily scans. Resets at the next 00:00 UTC. */
  scans: QuotaWindow;
  /** The key's request budget, a rolling 24 hours. Null without a key. */
  requests: QuotaWindow | null;
}

type WindowState = {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
};

/**
 * v3 spells "no cap" three ways depending on which counter answered (-1, the
 * 999999 stand-in, Infinity on the way through). Clients should not have to
 * know them, so the block has one: null.
 */
function toWindow(state: WindowState): QuotaWindow {
  const unlimited =
    state.limit === -1 ||
    !Number.isFinite(state.limit) ||
    state.limit >= UNLIMITED_API_KEY_DAILY_LIMIT;
  return {
    limit: unlimited ? null : state.limit,
    used: state.used,
    remaining: unlimited ? null : state.remaining,
    resetsAt: state.resetsAt,
  };
}

/**
 * Where the caller stands on both budgets. Reads only: building this never
 * spends a scan or a key request.
 */
export async function buildQuotaBlock(
  userId: number,
  key?: { keyId: number; dailyLimit: number } | null,
): Promise<QuotaBlock> {
  const [scans, requests] = await Promise.all([
    canMakeRequest(userId),
    key ? peekRateLimit(key.keyId, key.dailyLimit) : null,
  ]);
  return {
    scans: toWindow(scans),
    requests: requests ? toWindow(requests) : null,
  };
}
