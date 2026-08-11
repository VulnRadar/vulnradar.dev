/**
 * Centralized console.error -> system_error_logs capture.
 *
 * ~280 console.error call sites exist across this codebase (see CLAUDE.md's
 * "only genuine errors use console.error, routine status uses console.log"
 * convention) -- too many to touch individually so admins can see them
 * without shell/SSH access. Instead, installErrorLogCapture() wraps the
 * global console.error exactly once, at server boot (see
 * instrumentation.ts's register()). Every call still prints to the real
 * console completely unchanged; it additionally fires a best-effort,
 * non-blocking INSERT into system_error_logs, read back by
 * GET /api/v3/admin/error-logs for the Admin > System > Error Logs panel.
 *
 * The DB insert must never throw back into the console.error caller and
 * must never block it -- it is fired without an inline `await` and every
 * failure is swallowed.
 */
import pool from "@/lib/database/db";
import { redactEmailsInDetails } from "@/lib/auth/authorization";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_DETAIL_LENGTH = 8000;

// Every console.error call site in the app feeds this (see file header) --
// unlike a normal server log stream (ops/SSH-only), captured rows land in
// system_error_logs, readable by any admin-role staff member through
// GET /api/v3/admin/error-logs. No call site today logs a raw secret
// value directly, but this is retroactive to ~280 existing call sites and
// every one written after this, so scrub the common shapes before they
// ever reach that admin-facing table rather than trusting every future
// console.error to be careful. Order matters: bearer/basic auth headers
// before generic key patterns, so "Authorization: Bearer sk_live_..."
// doesn't also get double-redacted by the sk_ pattern (harmless either
// way, but the header pattern reads better as one redaction).
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // This app's own API keys (lib/api/api-keys.ts) and Stripe's (all of
  // sk_/pk_/rk_ live+test, plus webhook signing secrets).
  /\bvr_live_[A-Za-z0-9]{8,}/g,
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g,
  /\bwhsec_[A-Za-z0-9]{8,}/g,
  // A JWT-shaped token (three base64url segments) -- broad, but a stack
  // trace or error message containing three dot-joined base64url chunks
  // is far more likely to be a token than prose.
  /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

// A Postgres/generic connection string's embedded password -- kept
// separate from SECRET_PATTERNS above since this one replaces only the
// password itself (group 2), preserving the scheme/user/host around it
// (postgres://user:[redacted]@host) instead of blanking the whole match,
// which is more useful for actually debugging a connection error.
const CONNECTION_STRING_PASSWORD = /(:\/\/[^:/\s@]+:)([^@\s]+)(@)/g;

function redactSecrets(text: string): string {
  let out = text.replace(
    CONNECTION_STRING_PASSWORD,
    (_m, prefix: string, _password: string, at: string) =>
      `${prefix}[redacted]${at}`,
  );
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

// Flood guard 1: coalesce identical consecutive messages. A tight retry
// loop (a dependency hammering a broken connection every tick, say) would
// otherwise write one row per call forever. If the newly formatted message
// is byte-identical to the immediately preceding one and arrives within
// this window, skip the INSERT entirely -- the real console still gets
// every single call, only the DB write is coalesced.
const COALESCE_WINDOW_MS = 5_000;

// Flood guard 2: a hard per-process cap on inserts within a rolling
// window, so a burst of DIFFERENT messages (not caught by the coalesce
// guard above) still can't write unbounded rows in a short period.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_INSERTS = 100;

let installed = false;
let lastMessage: string | null = null;
let lastMessageAt = 0;
let windowStart = 0;
let windowCount = 0;

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Decides whether this formatted message should be persisted, and updates
 * the module-level flood-guard state as a side effect. Exported for tests
 * only -- not part of the public capture API.
 */
export function _shouldCapture(message: string, now: number): boolean {
  if (message === lastMessage && now - lastMessageAt < COALESCE_WINDOW_MS) {
    return false;
  }
  lastMessage = message;
  lastMessageAt = now;

  if (now - windowStart >= RATE_LIMIT_WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount++;
  return windowCount <= RATE_LIMIT_MAX_INSERTS;
}

/** Test-only: resets module-level flood-guard state between test cases. */
export function _resetErrorLogCaptureStateForTests(): void {
  installed = false;
  lastMessage = null;
  lastMessageAt = 0;
  windowStart = 0;
  windowCount = 0;
}

/**
 * Wrap console.error exactly once per process. Safe to call repeatedly
 * (e.g. dev hot-reload re-executing instrumentation.ts's register()) --
 * only the first call installs the wrapper.
 */
export function installErrorLogCapture(): void {
  if (installed) return;
  installed = true;

  const originalError = console.error.bind(console);

  console.error = (...args: unknown[]) => {
    // Print exactly as before, first and unconditionally. Nothing below
    // this line is allowed to change that behavior.
    originalError(...args);

    try {
      const parts = args
        .map(formatArg)
        .map(redactSecrets)
        .map((p) => redactEmailsInDetails(p) ?? p);
      const joined = parts.join(" ");
      if (!joined.trim()) return;

      const message = joined.slice(0, MAX_MESSAGE_LENGTH);
      const hasLongOrStackyContent =
        joined.length > MAX_MESSAGE_LENGTH ||
        args.some((a) => a instanceof Error);
      const detail = hasLongOrStackyContent
        ? parts.join("\n").slice(0, MAX_DETAIL_LENGTH)
        : null;

      // Dedupe/coalesce on the full, untruncated message -- two distinct
      // errors that happen to share their first MAX_MESSAGE_LENGTH
      // characters (e.g. long JSON payloads differing only past that
      // point) would otherwise collapse into one, silently dropping a
      // genuinely different error from the admin-facing log within the
      // coalesce window.
      if (!_shouldCapture(joined, Date.now())) return;

      // Fire-and-forget: never awaited inline, and any rejection is
      // swallowed here so it can never propagate to the console.error
      // caller (which may itself be inside an error handler).
      void pool
        .query(
          "INSERT INTO system_error_logs (message, detail) VALUES ($1, $2)",
          [message, detail],
        )
        .catch(() => {
          // Best-effort only. Do not call console.error here -- that
          // would re-enter this same wrapper.
        });
    } catch {
      // Formatting itself must never throw back into the caller.
    }
  };
}
