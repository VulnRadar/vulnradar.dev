import pool from "@/lib/database/db";
import { getClientIp } from "@/lib/api/request-utils";
import { RATE_LIMIT_DEFAULTS } from "@/lib/config/constants";
import type { SettingKey } from "@/lib/config/registry";
import { getSettings } from "@/lib/config/runtime-config";

export type RateLimitName = keyof typeof RATE_LIMIT_DEFAULTS;

type RateLimitPair = { maxAttempts: number; windowSeconds: number };

/**
 * Named limits whose cap and window are admin-editable, mapped to their
 * registry keys as [attempts, window in minutes]. Every current named limit
 * has an entry; the lookup still falls back to the shipped default for any
 * future limit added to RATE_LIMITS before it gets a registry entry.
 */
const CONFIGURABLE_LIMITS: Partial<
  Record<RateLimitName, readonly [SettingKey, SettingKey]>
> = {
  login: ["RATE_LIMIT_LOGIN_ATTEMPTS", "RATE_LIMIT_LOGIN_WINDOW_MINUTES"],
  signup: ["RATE_LIMIT_SIGNUP_ATTEMPTS", "RATE_LIMIT_SIGNUP_WINDOW_MINUTES"],
  forgotPassword: [
    "RATE_LIMIT_FORGOT_PASSWORD_ATTEMPTS",
    "RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MINUTES",
  ],
  api: ["RATE_LIMIT_API_REQUESTS", "RATE_LIMIT_API_WINDOW_MINUTES"],
  scan: ["RATE_LIMIT_SCAN_REQUESTS", "RATE_LIMIT_SCAN_WINDOW_MINUTES"],
  bulkScan: [
    "RATE_LIMIT_BULK_SCAN_REQUESTS",
    "RATE_LIMIT_BULK_SCAN_WINDOW_MINUTES",
  ],
  browserSession: [
    "RATE_LIMIT_BROWSER_SESSION_ATTEMPTS",
    "RATE_LIMIT_BROWSER_SESSION_WINDOW_MINUTES",
  ],
  aiChat: ["RATE_LIMIT_AI_CHAT_ATTEMPTS", "RATE_LIMIT_AI_CHAT_WINDOW_MINUTES"],
  aiVerify: [
    "RATE_LIMIT_AI_VERIFY_ATTEMPTS",
    "RATE_LIMIT_AI_VERIFY_WINDOW_MINUTES",
  ],
  aiSummary: [
    "RATE_LIMIT_AI_SUMMARY_ATTEMPTS",
    "RATE_LIMIT_AI_SUMMARY_WINDOW_MINUTES",
  ],
  adminReauth: [
    "RATE_LIMIT_ADMIN_REAUTH_ATTEMPTS",
    "RATE_LIMIT_ADMIN_REAUTH_WINDOW_MINUTES",
  ],
  billingVerify: [
    "RATE_LIMIT_BILLING_VERIFY_ATTEMPTS",
    "RATE_LIMIT_BILLING_VERIFY_WINDOW_MINUTES",
  ],
  teamInvite: [
    "RATE_LIMIT_TEAM_INVITE_ATTEMPTS",
    "RATE_LIMIT_TEAM_INVITE_WINDOW_MINUTES",
  ],
};

/** Resolve a named limit through the admin settings resolver. */
export async function getRateLimit(
  name: RateLimitName,
): Promise<RateLimitPair> {
  const keys = CONFIGURABLE_LIMITS[name];
  if (!keys) return RATE_LIMIT_DEFAULTS[name];

  const resolved = await getSettings(keys);
  return {
    maxAttempts: Number(resolved[keys[0]]),
    windowSeconds: Number(resolved[keys[1]]) * 60,
  };
}

/**
 * Either name a limit and let the resolver supply the numbers, or pass the
 * numbers directly for a one-off gate that has no registry entry.
 */
type RateLimitConfig =
  | {
      key: string;
      limit: RateLimitName;
      maxAttempts?: number;
      windowSeconds?: number;
    }
  | {
      key: string;
      limit?: undefined;
      maxAttempts: number;
      windowSeconds: number;
    };

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const { key } = config;
  const { maxAttempts, windowSeconds } = config.limit
    ? await getRateLimit(config.limit)
    : { maxAttempts: config.maxAttempts, windowSeconds: config.windowSeconds };

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowSeconds * 1000);

  // rate-limit: quantize `now` to the start of the current window
  // so the UPSERT's UNIQUE(key, window_start) constraint matches
  // requests that land in the same bucket. Without this, an
  // attacker firing N requests in 1 ms gets N distinct buckets each
  // starting at count=1, bypassing the cap entirely.
  //
  // Bucket boundary = floor(epoch_ms / window_ms) * window_ms.
  const windowMs = windowSeconds * 1000;
  const bucketStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  // Trim stale rows for this key only — the previous blanket DELETE scanned
  // the whole rate_limits table on every call. Doing the cleanup lazily
  // inside the UPSERT below avoids both the table scan and the read-then-
  // write TOCTOU race (two concurrent attempts could both observe the
  // pre-increment count and both squeeze under the cap).
  await pool.query(
    "DELETE FROM rate_limits WHERE key = $1 AND window_start < $2",
    [key, windowStart],
  );

  // Atomic UPSERT + read-back. Either:
  //   - insert a fresh row and read it back as `count=1`, or
  //   - increment the existing in-window row and read it back as the new count.
  // Both branches happen in a single statement so the count returned is the
  // same count that was persisted.
  const result = await pool.query<{ count: string }>(
    `INSERT INTO rate_limits (key, "count", window_start)
     VALUES ($1, 1, $2)
     ON CONFLICT (key, window_start)
     DO UPDATE SET "count" = rate_limits."count" + 1
     RETURNING "count"`,
    [key, bucketStart],
  );

  const count = Number(result.rows[0]?.count ?? 0);

  if (count > maxAttempts) {
    // We over-shot — roll back the increment we just did so the counter
    // stays pinned at the cap rather than drifting upward on every call.
    // (`> maxAttempts` means this attempt is the (maxAttempts+1)-th, which
    // must be rejected; the previous row sat at maxAttempts exactly.)
    await pool.query(
      `UPDATE rate_limits
       SET "count" = $2
       WHERE key = $1 AND window_start = $3`,
      [key, maxAttempts, bucketStart],
    );
    // Retry-after equals how long until the bucket rolls over.
    const nextBucket = new Date(bucketStart.getTime() + windowMs);
    const retryAfter = Math.max(
      1,
      Math.ceil((nextBucket.getTime() - now.getTime()) / 1000),
    );
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: retryAfter,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxAttempts - count),
    retryAfterSeconds: 0,
  };
}

/**
 * @deprecated Use getClientIp from request-utils instead
 */
export async function getClientIP(): Promise<string> {
  return getClientIp();
}

/**
 * Rate limit configs, each tagged with its own name. Spreading one into
 * checkRateLimit (`...RATE_LIMITS.login`) carries the name along, which is
 * what lets the call resolve the live admin value. The numbers stay on the
 * object so a caller that reads them for a message still gets something
 * sensible.
 *
 * Prefer this over the identically named export in lib/config/constants.ts:
 * that one is the shipped default table and is not resolver-aware.
 */
export const RATE_LIMITS = {
  login: { limit: "login", ...RATE_LIMIT_DEFAULTS.login },
  forgotPassword: {
    limit: "forgotPassword",
    ...RATE_LIMIT_DEFAULTS.forgotPassword,
  },
  signup: { limit: "signup", ...RATE_LIMIT_DEFAULTS.signup },
  api: { limit: "api", ...RATE_LIMIT_DEFAULTS.api },
  scan: { limit: "scan", ...RATE_LIMIT_DEFAULTS.scan },
  bulkScan: { limit: "bulkScan", ...RATE_LIMIT_DEFAULTS.bulkScan },
  browserSession: {
    limit: "browserSession",
    ...RATE_LIMIT_DEFAULTS.browserSession,
  },
  aiChat: { limit: "aiChat", ...RATE_LIMIT_DEFAULTS.aiChat },
  aiVerify: { limit: "aiVerify", ...RATE_LIMIT_DEFAULTS.aiVerify },
  aiSummary: { limit: "aiSummary", ...RATE_LIMIT_DEFAULTS.aiSummary },
  adminReauth: { limit: "adminReauth", ...RATE_LIMIT_DEFAULTS.adminReauth },
  billingVerify: {
    limit: "billingVerify",
    ...RATE_LIMIT_DEFAULTS.billingVerify,
  },
  teamInvite: { limit: "teamInvite", ...RATE_LIMIT_DEFAULTS.teamInvite },
} as const satisfies Record<RateLimitName, RateLimitPair & { limit: string }>;
