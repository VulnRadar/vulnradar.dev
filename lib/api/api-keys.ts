import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import pool from "@/lib/database/db";
import { API_KEY_PREFIX } from "@/lib/config/constants";
import {
  encryptApiKey,
  decryptApiKey,
  isEncryptionConfigured,
} from "@/lib/auth/crypto";
import { isKeyHex, parseKeyHex } from "@/lib/auth/key-hex";
import {
  getClientIp,
  getUserAgent,
  ipsInSameSubnet,
} from "@/lib/api/request-utils";
import { getSetting, getSettings } from "@/lib/config/runtime-config";
import { logError } from "@/lib/logging/log";
import {
  currentApiClient,
  currentApiVersion,
  normalizeApiClient,
} from "@/lib/database/request-context";
import type { ApiVersion } from "@/lib/api/versions";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { newLoginEmail, apiKeyRotationEmail } from "@/lib/email/email";
import {
  DEFAULT_NEW_KEY_SCOPES,
  resolveApiKeyScopes,
  type ApiKeyScope,
} from "@/lib/config/client-constants";
import { resolveEffectivePlan } from "@/lib/rate-limiting/daily-limits";
import {
  getPlanLimitsForPlan,
  getUserPlanLimits,
} from "@/lib/billing/plan-limits";

/**
 * Constant-time compare for a decrypted API key against the presented one.
 * `a === b` short-circuits on the first differing byte, which is the one
 * pattern every other secret compare in this codebase already avoids
 * (lib/auth/password-hash.ts, lib/auth/totp.ts, lib/auth/oauth-state.ts).
 * The timing signal here is weak because the locator lookup has already
 * narrowed the candidate set to one row, but there is no reason for this to
 * be the single exception to the rule (AUDIT-012#auth-11).
 *
 * timingSafeEqual throws on a length mismatch, so the length is compared
 * first. Key length is not a secret: it is fixed by generateApiKey.
 */
function apiKeysMatch(decrypted: string, presented: string): boolean {
  const a = Buffer.from(decrypted, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Helper function to generate a random deprecated placeholder string
function generateDeprecatedPlaceholder(): string {
  // Generate 64 random bytes as hex (fully random, no predictable pattern)
  return `deprecated_${randomBytes(48).toString("hex")}`;
}

// Derive a server-side secret for key locator HMAC.
// removed the hardcoded `"vulnradar-key-locator-v1"`
// fallback. A global default in the source would let anyone who read the
// source compute the locator for any stolen key. Require the real secret.
function getLocatorSecret(): Buffer {
  return parseKeyHex(
    process.env.API_KEY_ENCRYPTION_KEY,
    "[api-keys] API_KEY_ENCRYPTION_KEY must be set to a 64-character hex " +
      "string (32 bytes) to compute API key locators. " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
}

/**
 * The key the previous deployment used, while an operator is rotating
 * API_KEY_ENCRYPTION_KEY (lib/auth/crypto.ts has the procedure). Null when no
 * rotation is in progress or the value is not a 64-character hex string;
 * crypto.ts already reports the malformed case, so this stays quiet.
 */
function getPreviousLocatorSecret(): Buffer | null {
  const hex = process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
  return isKeyHex(hex) ? Buffer.from(hex, "hex") : null;
}

// Compute a deterministic 8-hex-char locator for indexed O(1) lookup.
// HMAC-SHA256(rawKey, secret)  first 4 bytes  hex.
function locatorUnder(rawKey: string, secret: Buffer): string {
  // This is NOT a password. It is a keyed HMAC over a CSPRNG-generated
  // 256-bit API key used as a deterministic column index for O(1) lookup.
  // The 256-bit key entropy makes brute-force irrelevant; bcrypt would be
  // wrong here because we need a deterministic, fast, keyed hash.
  const hmac = createHmac("sha256", secret);
  // codeql[js/insufficient-password-hash]
  hmac.update(rawKey);
  return hmac.digest("hex").slice(0, 8);
}

function computeKeyLocator(rawKey: string): string {
  return locatorUnder(rawKey, getLocatorSecret());
}

/**
 * The locator this key would have been stored under before the last
 * rotation, or null when no previous key is configured.
 */
function computePreviousKeyLocator(rawKey: string): string | null {
  const secret = getPreviousLocatorSecret();
  return secret ? locatorUnder(rawKey, secret) : null;
}

/**
 * Key ids already reported as undecryptable by this process.
 *
 * A locator match whose ciphertext opens under neither key is a corrupt row
 * or a rotation that dropped the old key too early, and it repeats on every
 * request that reaches the row: a CLI polling every few seconds would write an
 * Error Logs entry each time. One report per row per process is enough for an
 * operator to act on, and bounds the set by the number of broken rows.
 */
const reportedUndecryptableKeys = new Set<number>();

function reportUndecryptableKey(keyId: number, err: unknown): void {
  if (reportedUndecryptableKeys.has(keyId)) return;
  reportedUndecryptableKeys.add(keyId);
  logError(
    "api-keys",
    "stored API key could not be decrypted under the current or previous encryption key",
    err,
    { keyId },
  );
}

// Generate a new API key - returns the raw key (only shown once) and metadata
// dailyLimit defaults to DEFAULT_API_KEY_DAILY_LIMIT if not specified.
// scopes defaults to DEFAULT_NEW_KEY_SCOPES (scan:write + scan:read, not
// scan:delete) so a caller that predates the scopes UI -- or an internal
// call site that doesn't pass one -- still gets a sensible, non-destructive
// default instead of an empty/no-access array.
export async function generateApiKey(
  userId: number,
  name: string = "Default",
  dailyLimit?: number,
  scopes: ApiKeyScope[] = DEFAULT_NEW_KEY_SCOPES,
  /**
   * The caller's plan cap on active keys, re-applied around the INSERT.
   *
   * Counting keys in the route and inserting here is check-then-act: two
   * requests that both read the same count before either writes both pass
   * the gate, and the account ends up holding more live keys than its plan
   * allows. Undefined or null means unlimited, which is also what a caller
   * that predates this parameter gets.
   */
  activeKeyCap?: number | null,
) {
  const limit = dailyLimit ?? (await getSetting("DEFAULT_API_KEY_DAILY_LIMIT"));

  // Generate a random key: vr_live_<64 hex chars>
  const raw = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
  const prefix = raw.slice(0, API_KEY_PREFIX.length + 8); // show prefix + some chars
  const locator = computeKeyLocator(raw);

  let keyHash: string;
  let keyEncrypted: string | null = null;

  if (isEncryptionConfigured()) {
    // If encryption key is available, store encrypted key + deprecated placeholder
    keyEncrypted = encryptApiKey(raw);
    keyHash = generateDeprecatedPlaceholder();
  } else {
    // If no encryption key, use bcrypt-based hashing for lookup
    keyHash = await hashKey(raw);
  }

  // The count matches the route's own definition of an active key: rows
  // that have not been revoked. getUserApiKeys selects every row and filters
  // revoked_at in JavaScript, so this is where that predicate has to be
  // written out in SQL.
  const insertSql = `INSERT INTO api_keys (user_id, key_hash, key_locator, key_prefix, name, daily_limit, key_encrypted, scopes)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8
     WHERE $9::int IS NULL
        OR (SELECT COUNT(*) FROM api_keys
             WHERE user_id = $1 AND revoked_at IS NULL) < $9::int
     RETURNING id, key_prefix, name, daily_limit, created_at, scopes`;
  const params = [
    userId,
    keyHash,
    locator,
    prefix,
    name,
    limit,
    keyEncrypted,
    JSON.stringify(scopes),
    activeKeyCap ?? null,
  ];

  // Uncapped: no counting, so nothing to serialize.
  if (activeKeyCap == null) {
    const result = await pool.query(insertSql, params);
    return { ...result.rows[0], raw_key: raw };
  }

  // Capped: the statement above counts and inserts in one go, which is what
  // it was written for, and that is still not enough. Under READ COMMITTED,
  // which is Postgres's default and what this pool runs, the COUNT subquery
  // is evaluated against the snapshot taken when the statement STARTED, so
  // two creates arriving together each see `cap - 1` live keys, neither sees
  // the other's uncommitted row, and both insert: an account on a two-key
  // plan ends up holding three. One statement is not the same thing as one
  // at a time.
  //
  // Same fix as reserveConcurrentScanSlot: a transaction-scoped advisory
  // lock keyed per user, which auto-releases on COMMIT or ROLLBACK and never
  // makes two different accounts wait for each other. Not a row lock on
  // users, which would also block an unrelated profile save.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `api-key-create:${userId}`,
    ]);
    const result = await client.query(insertSql, params);
    await client.query("COMMIT");

    // The guard refused: another request took the last slot. Null rather
    // than a throw, so the caller answers with its own plan-limit message
    // instead of a 500.
    if (result.rows.length === 0) return null;

    return {
      ...result.rows[0],
      raw_key: raw, // Only returned on creation, never stored in plaintext
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Hash the API key with bcrypt for secure storage
async function hashKey(key: string): Promise<string> {
  // bcrypt silently truncates input at 72 bytes. Assert here so a future
  // prefix change doesn't silently reduce key entropy.
  if (Buffer.byteLength(key, "utf8") > 72) {
    throw new Error(
      `[api-keys] Key length ${Buffer.byteLength(key, "utf8")} bytes exceeds bcrypt's 72-byte limit; extend the fallback path to pre-hash with SHA-256`,
    );
  }
  const saltRounds = 12;
  return await bcrypt.hash(key, saltRounds);
}

// Compare API key with its hash
async function verifyKey(key: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(key, hash);
}

// Check if user has accepted the latest terms. termsUpdatedAt is resolved by
// the caller through the runtime config (database, then env, then the
// shipped CONFIG_TERMS_UPDATED_AT default) so an admin's edit to the terms
// date takes effect on the next request, no rebuild required.
function hasAcceptedLatestTerms(
  termsAcceptedAt: string | null,
  termsUpdatedAt: string,
): boolean {
  if (!termsAcceptedAt) return false;
  try {
    const acceptedDate = new Date(termsAcceptedAt);
    const termsUpdatedDate = new Date(termsUpdatedAt);
    // Validate dates are valid
    if (isNaN(acceptedDate.getTime()) || isNaN(termsUpdatedDate.getTime())) {
      // If dates are invalid, assume terms are accepted to avoid blocking
      return true;
    }
    return acceptedDate >= termsUpdatedDate;
  } catch {
    // On any error, don't block the user
    return true;
  }
}

interface KeyValidationResult {
  keyId: number;
  userId: number;
  email: string;
  userName: string;
  keyName: string;
  /**
   * The OWNER'S CURRENT plan allowance (PlanLimits.apiRequestsPerDay), resolved
   * on every validation -- NOT the api_keys.daily_limit column.
   *
   * That column is stamped once at creation and re-stamped only on rotation.
   * No billing path writes it: not the Stripe webhook, not the staff-plan
   * grant/revoke, not an admin plan change. So a cancelled Elite subscriber
   * kept their old high limit forever, and someone upgrading from Free stayed
   * on the free cap despite paying, contradicting what the pricing FAQ
   * promises ("raises your daily limit on the spot"). A stored copy of a
   * derived value is what caused that, and a webhook that has to remember to
   * update a second table would drift again, so it is derived here instead.
   *
   * Cheap enough to sit on every authenticated API request: the plan columns
   * come back on the JOIN the lookup already does, and the per-plan numbers
   * resolve out of the runtime-config snapshot (30s TTL, one cached table for
   * every key), so this adds no database round trip.
   */
  dailyLimit: number;
  needsTermsAcceptance?: boolean;
  // Always a concrete array: a legacy row's NULL column is already resolved
  // to every scope here (see resolveApiKeyScopes), so every caller of
  // validateApiKey can pass this straight to hasApiKeyScope without its own
  // null check.
  scopes: ApiKeyScope[];
}

/**
 * Columns every validateApiKey lookup selects so the owner's plan can be
 * resolved without a second read of the users row. `resolveEffectivePlan`
 * applies the staff tag and the "a gift only ever upgrades" rule over exactly
 * these three fields.
 */
const PLAN_COLUMNS = `u.plan, u.role, gs.plan AS gifted_plan`;

/** The join those columns come from. Kept beside them so the two cannot drift. */
const PLAN_JOIN = `LEFT JOIN gifted_subscriptions gs
                ON gs.user_id = u.id
               AND gs.revoked_at IS NULL
               AND gs.expires_at > NOW()`;

/**
 * The finite stand-in for "no cap". Deliberately not Infinity: this number is
 * returned to clients in the 429 body and in X-RateLimit-Limit, and
 * JSON.stringify(Infinity) is `null`. It is the same value POST /api/v3/keys
 * and the rotate route have always written into api_keys.daily_limit for an
 * unlimited plan, exported here so the three of them share one definition.
 */
export const UNLIMITED_API_KEY_DAILY_LIMIT = 999999;

/**
 * Turn a resolved PlanLimits (or null, meaning billing is switched off) into
 * the number checkRateLimit compares `used` against.
 */
function normalizeApiDailyLimit(
  limits: Awaited<ReturnType<typeof getUserPlanLimits>>,
): number {
  // null = billing disabled entirely: a self-hosted deployment has no plans
  // to charge against, so its keys are uncapped.
  if (!limits) return UNLIMITED_API_KEY_DAILY_LIMIT;
  const limit = limits.apiRequestsPerDay;
  // Fail CLOSED on a corrupt (non-numeric) setting, the same stance
  // resolveConcurrentLimit takes: NaN would fall through `used < NaN` as
  // "never allowed" anyway, and the alternative reading (treat it as no cap)
  // is a billing leak. -1 is a real configured answer, not corruption.
  if (!Number.isFinite(limit)) return 0;
  return limit === -1 ? UNLIMITED_API_KEY_DAILY_LIMIT : limit;
}

/**
 * The owner's live per-day API request allowance, from the plan columns the
 * key lookup already selected. This is the hot path (every authenticated API
 * request), which is why it takes the joined row rather than a user id: no
 * second read of the users row, and the per-plan numbers come out of the
 * runtime-config snapshot.
 */
async function resolveKeyDailyLimit(row: {
  plan?: string | null;
  role?: string | null;
  gifted_plan?: string | null;
}): Promise<number> {
  return normalizeApiDailyLimit(
    await getPlanLimitsForPlan(resolveEffectivePlan(row)),
  );
}

async function rowToResult(
  row: {
    key_id: number;
    user_id: number;
    name: string;
    email: string;
    user_name: string;
    tos_accepted_at: string | null;
    scopes?: unknown;
    plan?: string | null;
    role?: string | null;
    gifted_plan?: string | null;
  },
  termsUpdatedAt: string,
): Promise<KeyValidationResult> {
  return {
    keyId: row.key_id,
    userId: row.user_id,
    email: row.email,
    userName: row.user_name,
    keyName: row.name,
    dailyLimit: await resolveKeyDailyLimit(row),
    needsTermsAcceptance: !hasAcceptedLatestTerms(
      row.tos_accepted_at,
      termsUpdatedAt,
    ),
    scopes: resolveApiKeyScopes(row.scopes),
  };
}

/**
 * ip-binding: optional, off-by-default defense against a leaked API key
 * being used from somewhere other than where it's meant to run (see
 * lib/config/config-values.ts for the tradeoff — API keys get a
 * stricter default subnet than sessions, but the feature itself
 * defaults to off because a key used from CI does not necessarily have
 * a stable IP: GitHub Actions and similar shared-runner providers hand
 * out a different address on every job).
 *
 * The first successful use of a key after binding is enabled adopts
 * that request's subnet as the key's home network (there is nothing yet
 * to compare against). Every later mismatch declines just that one
 * request — the key itself is never revoked. A legitimate owner recovers
 * by retrying from the expected network, by clearing the binding
 * (resetApiKeyBinding), or by rotating the key, which keeps the row and
 * clears the binding with the old secret. Both of those need a signed-in
 * session, so whoever holds only a leaked key can do neither. Returns true
 * (no-op) when the feature is disabled or when the current IP can't be
 * determined.
 */
export async function passesApiKeyIpBinding(row: {
  key_id: number;
  bound_ip?: string | null;
  user_id: number;
  email: string;
  name: string;
}): Promise<boolean> {
  const settings = await getSettings([
    "API_KEY_IP_BINDING_ENABLED",
    "API_KEY_IP_BINDING_IPV4_PREFIX",
    "API_KEY_IP_BINDING_IPV6_PREFIX",
  ] as const);
  if (!settings.API_KEY_IP_BINDING_ENABLED) return true;

  const currentIp = await getClientIp();
  if (!currentIp || currentIp === "unknown") return true;

  const boundIp = row.bound_ip;
  if (!boundIp || boundIp === "unknown") {
    await pool
      .query(
        "UPDATE api_keys SET bound_ip = $1 WHERE id = $2 AND bound_ip IS NULL",
        [currentIp, row.key_id],
      )
      .catch((err) =>
        console.error("[api-keys] Failed to record bound_ip:", err),
      );
    return true;
  }

  if (
    ipsInSameSubnet(
      currentIp,
      boundIp,
      Number(settings.API_KEY_IP_BINDING_IPV4_PREFIX),
      Number(settings.API_KEY_IP_BINDING_IPV6_PREFIX),
    )
  ) {
    return true;
  }

  await notifyApiKeyIpMismatch({
    userId: row.user_id,
    userEmail: row.email,
    keyName: row.name,
    previousIp: boundIp,
    currentIp,
  });

  return false;
}

/**
 * ip-binding: best-effort notification for an API key IP mismatch — a
 * security_alerts row for the admin-facing alert surface, plus the same
 * "new login" email sent for a session mismatch (see
 * notifySessionIpMismatch in lib/auth/auth.ts), reused here rather than
 * adding a new email template for what is, from the account owner's
 * point of view, the same event. Awaited by the caller (the mismatch
 * path already declines the request, so the extra latency is an
 * acceptable trade for not having a dangling background promise) but
 * never throws itself, so a notification failure cannot turn into an
 * unhandled rejection or change whether the request is treated as
 * authenticated.
 */
async function notifyApiKeyIpMismatch(params: {
  userId: number;
  userEmail: string;
  keyName: string;
  previousIp: string;
  currentIp: string;
}): Promise<void> {
  const { userId, userEmail, keyName, previousIp, currentIp } = params;

  await pool
    .query(
      `INSERT INTO security_alerts
         (user_id, alert_type, severity, description, details, ip_address)
       VALUES ($1, 'api_key_ip_mismatch', 'medium', $2, $3, $4)`,
      [
        userId,
        `API key "${keyName}" was used from a network it is not bound to. The request was declined; the key itself was not revoked.`,
        JSON.stringify({ keyName, previousIp, currentIp }),
        currentIp,
      ],
    )
    .catch((err) =>
      console.error(
        "[api-keys] Failed to record api_key_ip_mismatch alert:",
        err,
      ),
    );

  try {
    const emailContent = newLoginEmail(
      `An unrecognized network (API key "${keyName}")`,
      currentIp,
      { ipAddress: currentIp, userAgent: "API request (no browser)" },
    );
    await sendNotificationEmail({
      userId,
      userEmail,
      type: "api_keys",
      emailContent,
    });
  } catch (err) {
    console.error("[api-keys] Failed to send api_key_ip_mismatch email:", err);
  }
}

/**
 * perf: whether any api_keys row still lacks a key_locator.
 *
 * The locator lookup is O(1) and indexed; the two fallback paths below are
 * full scans of the un-backfilled rows, and one of them runs a bcryptjs
 * compare (cost 12, pure JS, on the main thread) PER ROW. Because a locator
 * miss fell straight through to them, every INVALID key, and every request
 * from a scanner probing for one, paid both scans. generateApiKey has
 * written a locator since it shipped, so on any install without legacy rows
 * the correct answer is "return null immediately".
 *
 * null means "not looked up yet". Once resolved to false it stays false: no
 * code path creates a locator-less row. Reset to null after a backfill so
 * the next miss re-checks whether any remain.
 */
let legacyKeyRowsPresent: boolean | null = null;

async function hasLegacyKeyRows(): Promise<boolean> {
  if (legacyKeyRowsPresent !== null) return legacyKeyRowsPresent;
  try {
    const res = await pool.query<{ present: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM api_keys WHERE key_locator IS NULL) AS present",
    );
    legacyKeyRowsPresent = res.rows[0]?.present === true;
  } catch {
    // Fail OPEN: a failed probe must never turn a valid legacy key into an
    // authentication failure. The scans below are slow, not wrong.
    return true;
  }
  return legacyKeyRowsPresent;
}

/** Test-only: forget the cached legacy-row answer. */
export function __resetLegacyKeyRowCache(): void {
  legacyKeyRowsPresent = null;
}

/**
 * The by-locator row lookup, shared by the current-key and previous-key paths
 * so both select the same columns through the same joins.
 */
const ENCRYPTED_LOCATOR_LOOKUP_SQL = `SELECT ak.id as key_id, ak.user_id, ak.name,
              ak.revoked_at, ak.key_encrypted, ak.bound_ip, ak.scopes,
              u.email, u.name as user_name, u.tos_accepted_at, u.disabled_at,
              ${PLAN_COLUMNS}
         FROM api_keys ak
              JOIN users u ON ak.user_id = u.id
              ${PLAN_JOIN}
        WHERE ak.key_locator = $1
          AND ak.key_encrypted IS NOT NULL`;

/**
 * Decrypt a row's stored key, or null (reported once per row, see
 * reportUndecryptableKey) when neither the current nor the previous
 * encryption key opens it. Only the decrypt is covered: a failure anywhere
 * else is not an undecryptable key and must not be reported as one.
 */
function readStoredKey(row: {
  key_id: number;
  key_encrypted: string;
}): string | null {
  try {
    return decryptApiKey(row.key_encrypted);
  } catch (err) {
    reportUndecryptableKey(row.key_id, err);
    return null;
  }
}

/**
 * Find a key whose locator was written under the encryption key in use BEFORE
 * the last rotation, and move it onto the current one.
 *
 * The locator is an HMAC under API_KEY_ENCRYPTION_KEY, so rotating that key
 * changes the locator of every key while every stored row keeps the old one.
 * The ciphertext survived (lib/auth/crypto.ts falls back to the previous key),
 * but nothing ever found the row: the lookup by the new locator came back
 * empty and the operator who followed the documented procedure had every CLI,
 * CI and API integration answer 401 with nothing in any log.
 *
 * Runs only after the current-locator lookup missed and a previous key is
 * configured. A match is rewritten in place, locator and ciphertext both under
 * the current key, so each key pays for this once and the previous key can be
 * dropped when every key still in use has done so.
 */
async function findKeyUnderPreviousSecret(
  rawKey: string,
  currentLocator: string,
) {
  const previousLocator = computePreviousKeyLocator(rawKey);
  if (!previousLocator || previousLocator === currentLocator) return null;

  const result = await pool.query(ENCRYPTED_LOCATOR_LOOKUP_SQL, [
    previousLocator,
  ]);
  for (const row of result.rows) {
    const decrypted = readStoredKey(row);
    if (decrypted === null || !apiKeysMatch(decrypted, rawKey)) continue;

    // Both columns move together, and the WHERE re-checks what was read, so a
    // rotation of this one key that landed in between is not overwritten with
    // the old secret's material. Losing the race to another request carrying
    // the same key just updates zero rows: they wrote the same values.
    try {
      await pool.query(
        `UPDATE api_keys
            SET key_locator = $1, key_encrypted = $2
          WHERE id = $3 AND key_locator = $4 AND key_encrypted = $5`,
        [
          currentLocator,
          encryptApiKey(rawKey),
          row.key_id,
          previousLocator,
          row.key_encrypted,
        ],
      );
    } catch (err) {
      // The key itself is valid, so this request goes through; the next one
      // for the same key tries the rewrite again.
      logError(
        "api-keys",
        "could not move an API key onto the current encryption key",
        err,
        { keyId: row.key_id },
      );
    }
    return row;
  }
  return null;
}

// Validate an API key and return the user/key info, or null.
// Uses an indexed key_locator for O(1) lookup instead of a full-table scan.
// Returns { needsTermsAcceptance: true } if user hasn't accepted latest terms.
//
// Every branch checks `u.disabled_at` alongside `ak.revoked_at`. The cookie
// path already re-checks the suspension on every getSession() (lib/auth/auth.ts),
// but the Bearer path had no equivalent, so an account the admin panel showed as
// disabled kept full API access: a user suspended for abuse could go on running
// scans and reading or deleting their history with a key issued before the ban.
// The account-state gate belongs here rather than at the ~15 Bearer call sites.
async function lookupApiKey(key: string): Promise<KeyValidationResult | null> {
  const locator = computeKeyLocator(key);
  const [{ TERMS_UPDATED_AT: termsUpdatedAt }, featureEnabled] =
    await Promise.all([
      getSettings(["TERMS_UPDATED_AT"] as const),
      getSetting("FEATURE_API_KEYS"),
    ]);

  // FEATURE_API_KEYS gated only key CREATION, so turning the feature off (what
  // an operator does when a key may have leaked, or to lock a self-hosted
  // deployment down to browser sessions) left every already-issued key
  // authenticating against the whole API while the admin panel reported the
  // feature as off. Gate the authentication path too, following the
  // DOMAIN_REVERIFY_ENABLED pattern. Fails closed with the ordinary
  // invalid-key result: callers already handle null.
  if (!featureEnabled) return null;

  if (isEncryptionConfigured()) {
    // Primary path: O(1) indexed lookup by HMAC locator.
    const locatorResult = await pool.query(ENCRYPTED_LOCATOR_LOOKUP_SQL, [
      locator,
    ]);

    for (const row of locatorResult.rows) {
      const decrypted = readStoredKey(row);
      if (decrypted === null) continue;
      try {
        if (apiKeysMatch(decrypted, key)) {
          if (row.revoked_at || row.disabled_at) return null;
          if (!(await passesApiKeyIpBinding(row))) return null;
          return rowToResult(row, termsUpdatedAt);
        }
      } catch {
        continue;
      }
    }

    // A miss on the current locator may be a key that predates a rotation of
    // API_KEY_ENCRYPTION_KEY: its row still holds the locator the old key
    // computed. Only costs a query while PREVIOUS_API_KEY_ENCRYPTION_KEY is set.
    const rotated = await findKeyUnderPreviousSecret(key, locator);
    if (rotated) {
      if (rotated.revoked_at || rotated.disabled_at) return null;
      if (!(await passesApiKeyIpBinding(rotated))) return null;
      return rowToResult(rotated, termsUpdatedAt);
    }

    // Everything below is a scan of the rows that have no locator yet. Skip
    // both scans entirely when there are none, which is the normal state.
    if (!(await hasLegacyKeyRows())) return null;

    // Backfill: key matched a row that has no locator yet (legacy row).
    // Compute locator from decrypted key and persist it for future lookups.
    const legacyResult = await pool.query(
      `SELECT ak.id as key_id, ak.user_id, ak.name,
              ak.revoked_at, ak.key_encrypted, ak.key_locator, ak.bound_ip, ak.scopes,
              u.email, u.name as user_name, u.tos_accepted_at, u.disabled_at,
              ${PLAN_COLUMNS}
         FROM api_keys ak
              JOIN users u ON ak.user_id = u.id
              ${PLAN_JOIN}
        WHERE ak.key_locator IS NULL
          AND ak.key_encrypted IS NOT NULL`,
    );
    for (const row of legacyResult.rows) {
      const decrypted = readStoredKey(row);
      if (decrypted === null) continue;
      try {
        if (apiKeysMatch(decrypted, key)) {
          // Persist locator so subsequent lookups are O(1).
          await pool
            .query(
              "UPDATE api_keys SET key_locator = $1 WHERE id = $2 AND key_locator IS NULL",
              [computeKeyLocator(decrypted), row.key_id],
            )
            .catch(() => undefined);
          // A row just lost its legacy status, so re-check whether any remain.
          legacyKeyRowsPresent = null;
          if (row.revoked_at || row.disabled_at) return null;
          if (!(await passesApiKeyIpBinding(row))) return null;
          return rowToResult(row, termsUpdatedAt);
        }
      } catch {
        continue;
      }
    }

    // Fallback: hash-based bcrypt lookup (old keys without encryption).
    const hashResult = await pool.query(
      `SELECT ak.id as key_id, ak.user_id, ak.name,
              ak.revoked_at, ak.key_hash, ak.bound_ip, ak.scopes,
              u.email, u.name as user_name, u.tos_accepted_at, u.disabled_at,
              ${PLAN_COLUMNS}
         FROM api_keys ak
              JOIN users u ON ak.user_id = u.id
              ${PLAN_JOIN}
        WHERE ak.key_hash IS NOT NULL
          AND ak.key_locator IS NULL
          AND ak.key_encrypted IS NULL`,
    );
    for (const row of hashResult.rows) {
      try {
        if (await verifyKey(key, row.key_hash)) {
          if (row.revoked_at || row.disabled_at) return null;
          if (!(await passesApiKeyIpBinding(row))) return null;
          return rowToResult(row, termsUpdatedAt);
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  // No encryption configured: O(1) locator lookup for bcrypt-hashed keys.
  const locatorResult = await pool.query(
    `SELECT ak.id as key_id, ak.user_id, ak.name,
            ak.revoked_at, ak.key_hash, ak.bound_ip, ak.scopes,
            u.email, u.name as user_name, u.tos_accepted_at, u.disabled_at,
            ${PLAN_COLUMNS}
       FROM api_keys ak
            JOIN users u ON ak.user_id = u.id
            ${PLAN_JOIN}
      WHERE ak.key_locator = $1
        AND ak.key_hash IS NOT NULL`,
    [locator],
  );
  for (const row of locatorResult.rows) {
    try {
      if (await verifyKey(key, row.key_hash)) {
        if (row.revoked_at || row.disabled_at) return null;
        if (!(await passesApiKeyIpBinding(row))) return null;
        return rowToResult(row, termsUpdatedAt);
      }
    } catch {
      continue;
    }
  }

  // Legacy bcrypt keys without locator: full scan with a bcrypt compare per
  // row. Skipped entirely when no locator-less row exists.
  if (!(await hasLegacyKeyRows())) return null;

  // Legacy bcrypt keys without locator: full scan (backfill on match).
  const legacyHashResult = await pool.query(
    `SELECT ak.id as key_id, ak.user_id, ak.name,
            ak.revoked_at, ak.key_hash, ak.bound_ip, ak.scopes,
            u.email, u.name as user_name, u.tos_accepted_at, u.disabled_at,
            ${PLAN_COLUMNS}
       FROM api_keys ak
            JOIN users u ON ak.user_id = u.id
            ${PLAN_JOIN}
      WHERE ak.key_hash IS NOT NULL
        AND ak.key_locator IS NULL`,
  );
  for (const row of legacyHashResult.rows) {
    try {
      if (await verifyKey(key, row.key_hash)) {
        await pool
          .query(
            "UPDATE api_keys SET key_locator = $1 WHERE id = $2 AND key_locator IS NULL",
            [locator, row.key_id],
          )
          .catch(() => undefined);
        legacyKeyRowsPresent = null;
        if (row.revoked_at || row.disabled_at) return null;
        if (!(await passesApiKeyIpBinding(row))) return null;
        return rowToResult(row, termsUpdatedAt);
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Every key-authenticated request comes through here, authenticateApiKey's
 * included, which is why the version and client telemetry is recorded here
 * and not beside the last_used_at write in checkRateLimit: the extension's
 * steady traffic is reputation and auth/me, which are never metered, so a
 * write that rode on the meter would never see an extension-only install.
 *
 * Only a request answered under versioned() knows its API version. Outside
 * it (an unwrapped route, a script, a test calling this directly) there is
 * nothing true to write, so nothing is.
 */
export async function validateApiKey(
  key: string,
): Promise<KeyValidationResult | null> {
  const result = await lookupApiKey(key);
  const apiVersion = currentApiVersion();
  if (result && apiVersion) {
    void recordKeyUsage(result.keyId, {
      apiVersion,
      client: currentApiClient(),
    });
  }
  return result;
}

/**
 * How long an unchanged version and client go unwritten. The columns answer
 * "which keys still call v3" for a sunset months away, so a minute of lag
 * costs nothing, and it keeps a polling client from turning every request
 * into a row write.
 */
const KEY_USAGE_WRITE_INTERVAL_MS = 60 * 1000;

/**
 * The most keys the throttle remembers. Past it the least recently written
 * key is forgotten, which costs that key one early write and nothing else.
 */
const KEY_USAGE_THROTTLE_MAX_KEYS = 10_000;

interface KeyUsageWrite {
  apiVersion: ApiVersion;
  client: string | null;
  writtenAt: number;
}

const lastKeyUsageWrite = new Map<number, KeyUsageWrite>();

/**
 * Store the API version and first-party client a key was just used with.
 *
 * At most one write per key per KEY_USAGE_WRITE_INTERVAL_MS, except that a
 * change of version or client writes at once: the moment a key moves from v3
 * to v4 is the fact the sunset review needs. The throttle is per process, so
 * several instances each write on their own schedule, which is harmless for
 * columns that only ever hold the latest value.
 *
 * Fire and forget. The returned promise never rejects and only exists so a
 * test can wait for the write; a request never waits on it, and a failed
 * write is logged and forgotten so the next request tries again.
 *
 * `client` is checked again here rather than trusted from the caller: it is
 * client-controlled text that the admin panel shows, and a value outside
 * normalizeApiClient's pattern is stored as NULL, never trimmed.
 */
export function recordKeyUsage(
  keyId: number,
  usage: { apiVersion: ApiVersion; client: string | null },
): Promise<void> {
  const client = normalizeApiClient(usage.client);
  const now = Date.now();
  const previous = lastKeyUsageWrite.get(keyId);
  if (
    previous &&
    previous.apiVersion === usage.apiVersion &&
    previous.client === client &&
    now - previous.writtenAt < KEY_USAGE_WRITE_INTERVAL_MS
  ) {
    return Promise.resolve();
  }

  // Deleted and re-set so Map order stays least recently written first.
  lastKeyUsageWrite.delete(keyId);
  if (lastKeyUsageWrite.size >= KEY_USAGE_THROTTLE_MAX_KEYS) {
    const oldest = lastKeyUsageWrite.keys().next().value;
    if (oldest !== undefined) lastKeyUsageWrite.delete(oldest);
  }
  const write: KeyUsageWrite = {
    apiVersion: usage.apiVersion,
    client,
    writtenAt: now,
  };
  lastKeyUsageWrite.set(keyId, write);

  // An async body rather than a .then chain, so a pool that throws instead
  // of rejecting still cannot fail the request that triggered the write.
  return (async () => {
    try {
      await pool.query(
        `UPDATE api_keys
            SET last_used_api_version = $2, last_used_client = $3
          WHERE id = $1`,
        [keyId, usage.apiVersion, client],
      );
    } catch (err) {
      if (lastKeyUsageWrite.get(keyId) === write) {
        lastKeyUsageWrite.delete(keyId);
      }
      logError(
        "api-keys",
        "could not record which API version a key was used with",
        err,
        { keyId },
      );
    }
  })();
}

/** Test-only: forget every throttled write. */
export function __resetKeyUsageThrottle(): void {
  lastKeyUsageWrite.clear();
}

export interface ApiKeyVersionUsage {
  keyId: number;
  keyPrefix: string;
  keyName: string;
  userId: number;
  ownerEmail: string;
  lastUsedApiVersion: ApiVersion | null;
  lastUsedClient: string | null;
  lastUsedAt: Date | null;
}

/**
 * Live keys by the API version and client they last called with, for the
 * admin panel and the review a month before the v3 sunset.
 *
 * Keys still on v3 come first, then keys not seen since the telemetry columns
 * existed, then v4. Within each, a NULL client comes first: that is every
 * pre-4.0 CLI, Action and extension build plus raw HTTP callers, the callers
 * an update cannot reach. `only` narrows the list to one of the two lists
 * the review reads.
 *
 * Coverage is keys that authenticate through validateApiKey under
 * versioned(). An anonymous poller never names a key and is not counted.
 */
export async function listApiKeysByVersionUsage(
  options: {
    only?: "v3" | "no-client";
    limit?: number;
    offset?: number;
  } = {},
): Promise<ApiKeyVersionUsage[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);

  const result = await pool.query<{
    key_id: number;
    key_prefix: string;
    name: string;
    user_id: number;
    email: string;
    last_used_api_version: ApiVersion | null;
    last_used_client: string | null;
    last_used_at: Date | null;
  }>(
    `SELECT ak.id AS key_id, ak.key_prefix, ak.name, ak.user_id, u.email,
            ak.last_used_api_version, ak.last_used_client, ak.last_used_at
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
      WHERE ak.revoked_at IS NULL
        AND ($3::text IS NULL
             OR ($3::text = 'v3' AND ak.last_used_api_version = 'v3')
             OR ($3::text = 'no-client' AND ak.last_used_client IS NULL))
      ORDER BY CASE ak.last_used_api_version
                 WHEN 'v3' THEN 0
                 WHEN 'v4' THEN 2
                 ELSE 1
               END,
               (ak.last_used_client IS NULL) DESC,
               ak.last_used_at DESC NULLS LAST,
               ak.id
      LIMIT $1 OFFSET $2`,
    [limit, offset, options.only ?? null],
  );

  return result.rows.map((row) => ({
    keyId: row.key_id,
    keyPrefix: row.key_prefix,
    keyName: row.name,
    userId: row.user_id,
    ownerEmail: row.email,
    lastUsedApiVersion: row.last_used_api_version,
    lastUsedClient: row.last_used_client,
    lastUsedAt: row.last_used_at,
  }));
}

const API_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * When the rolling window next frees a slot: 24 hours after the oldest request
 * still in it, or a full window from now when it is empty.
 */
function usageWindowResetsAt(oldest: Date | null): string {
  const start = oldest ? new Date(oldest).getTime() : Date.now();
  return new Date(start + API_USAGE_WINDOW_MS).toISOString();
}

// rate-limit: atomic check-and-increment under a row lock.
// Concurrent requests observing `used = limit - 1` would otherwise
// both pass and both insert — a real billing-cap bypass for paid
// API customers. The lock on api_keys.id serializes the count +
// insert, so the second request sees the first's incremented
// counter and is rejected.
//
// Everything runs on the one client this call holds. It used to ask the pool
// for a second connection (the last_used_at update and the oldest-row read)
// before releasing the first, so once every pooled client belonged to a caller
// doing the same thing, each waited on a connection only another could free,
// and a burst of API requests ended in connect timeouts.
export async function checkRateLimit(keyId: number, dailyLimit: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockResult = await client.query<{ id: number }>(
      "SELECT id FROM api_keys WHERE id = $1 FOR UPDATE",
      [keyId],
    );
    if (lockResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return {
        allowed: false,
        remaining: 0,
        limit: dailyLimit,
        used: 0,
        resetsAt: usageWindowResetsAt(null),
      };
    }

    // The lock has to come first, as its own statement. READ COMMITTED takes
    // a fresh snapshot per statement, so this one starts after the lock was
    // granted and sees what the previous holder committed. Folding the lock
    // into the CTE would count against a snapshot from before the wait.
    //
    // COALESCE is for a key's first request in the window: every part of a
    // statement shares one snapshot, so in_window cannot see the row being
    // inserted here and the new row is the oldest.
    const meter = await client.query<{
      used: number;
      inserted: boolean;
      oldest: Date | null;
    }>(
      `WITH in_window AS (
         SELECT COUNT(*)::int AS used, MIN(used_at) AS oldest
           FROM api_usage
          WHERE api_key_id = $1::int
            AND used_at > NOW() - INTERVAL '24 hours'
       ), recorded AS (
         INSERT INTO api_usage (api_key_id)
         SELECT $1::int FROM in_window WHERE used < $2::int
         RETURNING used_at
       )
       SELECT in_window.used,
              EXISTS (SELECT 1 FROM recorded) AS inserted,
              COALESCE(in_window.oldest, (SELECT used_at FROM recorded)) AS oldest
         FROM in_window`,
      [keyId, dailyLimit],
    );
    const { used, inserted, oldest } = meter.rows[0];

    await client.query(
      "UPDATE api_keys SET last_used_at = NOW() WHERE id = $1",
      [keyId],
    );

    await client.query("COMMIT");

    const usedAfter = inserted ? used + 1 : used;
    return {
      allowed: inserted,
      remaining: Math.max(0, dailyLimit - usedAfter),
      limit: dailyLimit,
      used: usedAfter,
      resetsAt: usageWindowResetsAt(oldest),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Read-only usage snapshot: same shape as checkRateLimit but WITHOUT inserting
 * a usage row. For fast-fail pre-checks (e.g. bulk scan's "is this key already
 * exhausted before we do any work") where the actual per-item enforcement is a
 * separate atomic checkRateLimit call. Using checkRateLimit for such a pre-check
 * would burn a phantom slot the request never actually used.
 *
 * Takes no lock on purpose: the answer is advisory, and waiting behind the
 * requests that are being metered would make the fast-fail slow.
 */
export async function peekRateLimit(keyId: number, dailyLimit: number) {
  const result = await pool.query<{ used: number; oldest: Date | null }>(
    `SELECT COUNT(*)::int AS used, MIN(used_at) AS oldest
       FROM api_usage
      WHERE api_key_id = $1
        AND used_at > NOW() - INTERVAL '24 hours'`,
    [keyId],
  );
  const { used, oldest } = result.rows[0];

  return {
    allowed: used < dailyLimit,
    remaining: Math.max(0, dailyLimit - used),
    limit: dailyLimit,
    used,
    resetsAt: usageWindowResetsAt(oldest),
  };
}

// rate-limit: no-op stub. The atomic checkRateLimit above both
// counts AND inserts under a row lock — the old read-then-write
// race is gone. Kept only so existing call sites don't crash; new
// code must not call this.
export async function recordUsage(_keyId: number) {
  /* no-op: see checkRateLimit above for the atomic implementation */
  return;
}

// Get all API keys for a user (without the actual key, just metadata).
// `scopes` is returned as stored -- NULL for a pre-scoping key -- rather
// than resolved here, so the caller decides how to render "this key
// predates scoping" (see resolveApiKeyScopes, used both by the API route's
// response and directly by the profile UI).
//
// `daily_limit` is the ONE field not returned as stored: it is overwritten
// with the owner's live plan allowance, the same number validateApiKey now
// enforces against. The stored column is a creation-time snapshot no billing
// path updates, so reporting it here made the profile's "12 of 25 today" meter
// disagree with the limit the API was actually applying the moment the account
// changed plan. One resolve covers every row the caller owns.
export async function getUserApiKeys(userId: number) {
  // getUserPlanLimits rather than resolveKeyDailyLimit's joined-row form: this
  // is the cold path (a profile page load), and it is the same resolver the
  // key-creation and rotation routes already call, so the three cannot drift.
  const dailyLimit = normalizeApiDailyLimit(await getUserPlanLimits(userId));

  const result = await pool.query(
    // bound_ip is selected because it is enforced: when
    // API_KEY_IP_BINDING_ENABLED is on, a key that worked yesterday starts
    // returning 403 from a new network. Without the value on the list there
    // is no visible cause and no way to fix it short of issuing a new key
    // (AUDIT-011#drift-27). Pairs with resetApiKeyBinding below.
    `SELECT ak.id, ak.key_prefix, ak.name, ak.daily_limit, ak.created_at, ak.last_used_at, ak.revoked_at, ak.scopes, ak.bound_ip,
                (SELECT COUNT(*)::int FROM api_usage au WHERE au.api_key_id = ak.id AND au.used_at > NOW() - INTERVAL '24 hours') as usage_today
         FROM api_keys ak
         WHERE ak.user_id = $1
         ORDER BY ak.created_at DESC`,
    [userId],
  );

  return result.rows.map((row) => ({ ...row, daily_limit: dailyLimit }));
}

/**
 * Clear a key's pinned home network so the next successful use re-adopts
 * whichever subnet it comes from, exactly as if the key had never been used
 * (see passesApiKeyIpBinding). This is the recovery path for the ordinary
 * case of a legitimate owner moving networks: before it existed the only way
 * out of a binding mismatch was to rotate the key, which invalidates the
 * secret every consumer of that key already has (AUDIT-011#drift-27).
 *
 * Scoped to the caller's own non-revoked keys; returns false when the key is
 * not theirs, which the route reports as 404 rather than 403 so the endpoint
 * cannot be used to probe for other users' key ids.
 */
export async function resetApiKeyBinding(keyId: number, userId: number) {
  const result = await pool.query(
    "UPDATE api_keys SET bound_ip = NULL WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id",
    [keyId, userId],
  );
  return result.rows.length > 0;
}

// Revoke an API key
export async function revokeApiKey(keyId: number, userId: number) {
  const result = await pool.query(
    "UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id",
    [keyId, userId],
  );
  return result.rows.length > 0;
}

// Rotate an API key - swaps the secret in place, same row, same id.
// Returns the new key details including raw_key (only shown once)
export async function rotateApiKey(
  keyId: number,
  userId: number,
  dailyLimit?: number,
) {
  // Get the old key's limit and scopes (rotation issues a new secret, not
  // new permissions, so the replacement key must carry forward exactly what
  // the old one could do) first.
  const oldKeyResult = await pool.query(
    "SELECT daily_limit, scopes FROM api_keys WHERE id = $1 AND user_id = $2",
    [keyId, userId],
  );

  if (oldKeyResult.rows.length === 0) {
    return null;
  }

  const { daily_limit: oldLimit, scopes: oldScopes } = oldKeyResult.rows[0];

  // Generate new key material, but UPDATE the existing row rather than
  // delete-and-recreate. api_usage.api_key_id references api_keys(id) ON
  // DELETE CASCADE, so the old delete-then-insert approach silently wiped
  // out the key's entire usage history (including today's count toward its
  // daily limit) on every rotation, since the replacement row got a brand
  // new id with no usage rows attached. Rotating in place keeps the id, so
  // usage_today and the rate limit built on it survive exactly like a new
  // secret on the same key should, not a new key.
  const raw = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
  const prefix = raw.slice(0, API_KEY_PREFIX.length + 8);
  const locator = computeKeyLocator(raw);

  let keyHash: string;
  let keyEncrypted: string | null = null;
  if (isEncryptionConfigured()) {
    keyEncrypted = encryptApiKey(raw);
    keyHash = generateDeprecatedPlaceholder();
  } else {
    keyHash = await hashKey(raw);
  }

  const resolvedScopes = resolveApiKeyScopes(oldScopes);
  const newLimit = dailyLimit ?? oldLimit;

  // Re-check ownership in the WHERE clause itself (not just the SELECT
  // above) so a future refactor can't turn this into an update-any-key-by-id
  // primitive.
  //
  // bound_ip goes with the old secret: the next use of the new one adopts its
  // network, exactly as a new key would. Keeping it left a key that had moved
  // networks refused even after its owner replaced the secret to recover it.
  const updateResult = await pool.query(
    `UPDATE api_keys
        SET key_hash = $1, key_locator = $2, key_prefix = $3,
            key_encrypted = $4, daily_limit = $5, scopes = $6,
            bound_ip = NULL
      WHERE id = $7 AND user_id = $8
      RETURNING id, key_prefix, name, daily_limit, created_at, scopes`,
    [
      keyHash,
      locator,
      prefix,
      keyEncrypted,
      newLimit,
      JSON.stringify(resolvedScopes),
      keyId,
      userId,
    ],
  );

  if (updateResult.rows.length === 0) {
    return null;
  }

  const newKey = {
    ...updateResult.rows[0],
    raw_key: raw, // Only returned on creation/rotation, never stored in plaintext
  };

  // Notify: rotation mints a brand new secret for an existing key -- a
  // different event from first-time key creation, and worth its own email
  // (apiKeyRotationEmail) rather than reusing apiKeyCreatedEmail, which
  // reads as "a new key appeared" instead of "your existing key's secret
  // changed." Best-effort: rotation must still succeed and return the new
  // key even if this notification fails (e.g. getClientIp/getUserAgent
  // throwing outside a real request scope, or SMTP being down).
  try {
    const userRes = await pool.query<{ email: string }>(
      "SELECT email FROM users WHERE id = $1",
      [userId],
    );
    const userEmail = userRes.rows[0]?.email;
    if (userEmail) {
      const ip = await getClientIp();
      const userAgent = await getUserAgent();
      await sendNotificationEmail({
        userId,
        userEmail,
        type: "api_keys",
        emailContent: apiKeyRotationEmail(
          newKey.name,
          // apiKeyRotationEmail's newKeyCreatedAt is typed string, but
          // pg parses a TIMESTAMPTZ column (created_at) into a real Date
          // object, not a string -- escapeHtml() inside the template
          // then crashed calling .replace() on it. Normalize here rather
          // than loosen the template's type, since every other caller of
          // that template already passes a real string.
          new Date(newKey.created_at).toISOString(),
          {
            ipAddress: ip,
            userAgent,
          },
        ),
      });
    }
  } catch (err) {
    console.error("[api-keys] Failed to send rotation notification:", err);
  }

  return newKey;
}
