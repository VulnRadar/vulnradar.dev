import pool from "@/lib/database/db";
import { getClientIp } from "@/lib/api/request-utils";
import { RATE_LIMITS as RATE_LIMIT_CONFIGS } from "@/lib/config/constants";

interface RateLimitConfig {
  key: string;
  maxAttempts: number;
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit({
  key,
  maxAttempts,
  windowSeconds,
}: RateLimitConfig): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowSeconds * 1000);

  // SECURITY-AUDIT-2026-06-28 / M-15: quantize `now` to the start of
  // the current window so the UPSERT's UNIQUE(key, window_start)
  // constraint matches requests that land in the same bucket instead
  // of every request creating its own bucket with ms-precision
  // window_start. Without this, an attacker firing N requests in
  // 1 ms gets N distinct buckets each starting at count=1, bypassing
  // the cap entirely.
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

// Export rate limit configs from constants
export const RATE_LIMITS = RATE_LIMIT_CONFIGS;
