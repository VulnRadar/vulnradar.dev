/**
 * Centralized console.error -> system_error_logs capture.
 *
 * ~280 console.error call sites exist across this codebase (see STYLE.md's
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
 *
 * Two flood guards decide what is NOT stored (below). Dropping a row is only
 * acceptable if the panel says so: otherwise a burst of failures, which is
 * exactly when the panel is read, shows a tidy hundred rows and looks like the
 * whole story. Every dropped call is counted, and one `[error-capture]`
 * summary row stands in for them when their window ends.
 */
import pool from "@/lib/database/db";
import { redactEmailsInDetails } from "@/lib/auth/authorization";
import {
  currentRequestId,
  currentScanId,
} from "@/lib/database/request-context";
import { CAPTURE_NOTICE_PREFIX } from "@/lib/logging/capture-notice";

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

// What a summary row quotes of the messages it stands in for. They were
// redacted before they got here, so quoting them adds no exposure; the bounds
// keep a storm of unique messages from growing the accumulator.
const SAMPLE_LENGTH = 160;
const MAX_TRACKED_REPEATED = 20;
const MAX_CAPPED_SAMPLES = 3;
const MAX_DETAIL_REPEATED = 5;

let installed = false;
let lastMessage: string | null = null;
let lastMessageAt = 0;
let windowStart = 0;
let windowCount = 0;

/**
 * Everything the flood guards dropped inside one rate-limit window.
 *
 * One accumulator per window and one summary row per accumulator, on
 * purpose: reporting at every change of message would write a row for each
 * flip of an A, A, B, B, A, A pattern, which is the flood this exists to
 * contain. At most one extra row per window per process.
 */
interface Suppression {
  /** The summary is due once the window the drops happened in has ended. */
  windowEndsAt: number;
  firstAt: number;
  lastAt: number;
  /** Calls identical to the previous one, skipped by the coalesce guard. */
  repeats: number;
  /** Calls skipped because the window's insert budget was spent. */
  capped: number;
  /** The coalesced messages, by how many times each was skipped. */
  repeated: Map<string, number>;
  /** A few of the messages the cap swallowed, in arrival order. */
  cappedSamples: string[];
}

let suppressed: Suppression | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function noteSuppressed(
  kind: "repeat" | "capped",
  message: string,
  now: number,
): void {
  if (!suppressed) {
    suppressed = {
      windowEndsAt: windowStart + RATE_LIMIT_WINDOW_MS,
      firstAt: now,
      lastAt: now,
      repeats: 0,
      capped: 0,
      repeated: new Map(),
      cappedSamples: [],
    };
    // Without a timer the marker would only appear when some LATER error
    // happened to arrive, which after an incident can be hours away, and the
    // panel would look complete in the meantime. unref'd: a pending summary
    // must never be the reason a process refuses to exit.
    if (installed) {
      flushTimer = setTimeout(
        () => {
          flushTimer = null;
          writeSuppressionSummary(takeSuppression(Date.now(), true));
        },
        Math.max(0, suppressed.windowEndsAt - now),
      );
      flushTimer.unref?.();
    }
  }
  suppressed.lastAt = now;
  const sample = message.slice(0, SAMPLE_LENGTH);
  if (kind === "repeat") {
    suppressed.repeats++;
    const seen = suppressed.repeated.get(sample);
    if (seen !== undefined) suppressed.repeated.set(sample, seen + 1);
    else if (suppressed.repeated.size < MAX_TRACKED_REPEATED) {
      suppressed.repeated.set(sample, 1);
    }
  } else {
    suppressed.capped++;
    if (suppressed.cappedSamples.length < MAX_CAPPED_SAMPLES) {
      suppressed.cappedSamples.push(sample);
    }
  }
}

/**
 * Hands over the accumulator if its window has ended, or unconditionally with
 * `force`, which the timer uses so a clock that reads a millisecond early
 * cannot make it skip its own flush. Clearing the timer here is what keeps a
 * stale one from flushing the NEXT window's accumulator early.
 */
function takeSuppression(now: number, force = false): Suppression | null {
  if (!suppressed) return null;
  if (!force && now < suppressed.windowEndsAt) return null;
  const taken = suppressed;
  suppressed = null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  return taken;
}

function describeSuppression(s: Suppression): {
  message: string;
  detail: string;
} {
  const total = s.repeats + s.capped;
  const ranked = [...s.repeated.entries()].sort((a, b) => b[1] - a[1]);
  const reasons: string[] = [];
  if (s.repeats > 0) {
    const top = ranked[0]?.[0] ?? "";
    const repeats = `${s.repeats} ${s.repeats === 1 ? "repeat" : "repeats"}`;
    reasons.push(
      ranked.length <= 1
        ? `${repeats} of "${top}"`
        : `${repeats} of ${ranked.length} messages, most often "${top}"`,
    );
  }
  if (s.capped > 0) {
    reasons.push(
      `${s.capped} over the ${RATE_LIMIT_MAX_INSERTS} per minute cap`,
    );
  }
  const message =
    `${CAPTURE_NOTICE_PREFIX} suppressed ${total} ${total === 1 ? "error" : "errors"} ` +
    `(${reasons.join(", ")}) between ${new Date(s.firstAt).toISOString()} and ${new Date(s.lastAt).toISOString()}`;

  const lines: string[] = [];
  if (ranked.length > 0) {
    lines.push(
      `Identical to the previous error within ${COALESCE_WINDOW_MS / 1000}s, so not stored again:`,
    );
    for (const [text, n] of ranked.slice(0, MAX_DETAIL_REPEATED)) {
      lines.push(`  ${n}x  ${text}`);
    }
  }
  if (s.cappedSamples.length > 0) {
    lines.push(
      `Not stored once ${RATE_LIMIT_MAX_INSERTS} rows had been written in the minute (first ${s.cappedSamples.length}):`,
    );
    for (const text of s.cappedSamples) lines.push(`  ${text}`);
  }
  lines.push(
    "Every one of these calls was still printed to the server console; only the stored row was skipped.",
  );
  return {
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    detail: lines.join("\n").slice(0, MAX_DETAIL_LENGTH),
  };
}

function insertRow(
  message: string,
  detail: string | null,
  requestId: string | null,
  scanId: number | null,
): void {
  // Fire-and-forget: never awaited inline, and any rejection is swallowed
  // here so it can never propagate to the console.error caller (which may
  // itself be inside an error handler).
  void pool
    .query(
      "INSERT INTO system_error_logs (message, detail, request_id, scan_id) VALUES ($1, $2, $3, $4)",
      [message, detail, requestId, scanId],
    )
    .catch(() => {
      // Best-effort only. Do not call console.error here -- that
      // would re-enter this same wrapper.
    });
}

function writeSuppressionSummary(s: Suppression | null): void {
  if (!s) return;
  try {
    const { message, detail } = describeSuppression(s);
    // Both ids are NULL on purpose. The row is written by whichever call
    // follows the window, so the ambient request or scan belongs to some
    // unrelated work, and stamping it would tie the notice to that.
    insertRow(message, detail, null, null);
  } catch {
    // Reporting a drop must never become a second failure.
  }
}

/**
 * Decides whether this formatted message should be persisted, and updates
 * the module-level flood-guard state as a side effect, including the count
 * of what it refuses. Exported for tests only -- not part of the public
 * capture API.
 */
export function _shouldCapture(message: string, now: number): boolean {
  // The window is rolled first so every drop below is filed under the window
  // it really happened in. Rolled after the coalesce check, a repeat that
  // arrived just past a boundary was counted against a window that had
  // already ended.
  if (now - windowStart >= RATE_LIMIT_WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }

  if (message === lastMessage && now - lastMessageAt < COALESCE_WINDOW_MS) {
    noteSuppressed("repeat", message, now);
    return false;
  }
  lastMessage = message;
  lastMessageAt = now;

  windowCount++;
  if (windowCount > RATE_LIMIT_MAX_INSERTS) {
    noteSuppressed("capped", message, now);
    return false;
  }
  return true;
}

/** Test-only: resets module-level flood-guard state between test cases. */
export function _resetErrorLogCaptureStateForTests(): void {
  installed = false;
  lastMessage = null;
  lastMessageAt = 0;
  windowStart = 0;
  windowCount = 0;
  suppressed = null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
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

      const now = Date.now();

      // Report a window that has ended before judging this message, whether
      // or not this message is itself stored.
      writeSuppressionSummary(takeSuppression(now));

      // Dedupe/coalesce on the full, untruncated message -- two distinct
      // errors that happen to share their first MAX_MESSAGE_LENGTH
      // characters (e.g. long JSON payloads differing only past that
      // point) would otherwise collapse into one, silently dropping a
      // genuinely different error from the admin-facing log within the
      // coalesce window.
      if (!_shouldCapture(joined, now)) return;

      // The correlation ids of the work that is running, if there are any
      // (AUDIT-012#obs-07, see lib/database/request-context.ts). Read
      // here, synchronously, rather than passed in by the ~330 console.error
      // call sites: this runs inside the caller's async context, so the
      // lookup is exact. The request id ties the several rows one failing
      // request writes together; the scan id ties a background scan's rows
      // to the scan even though it outlived the request that started it.
      // Both are null for anything outside them (boot, cron tick, worker).
      insertRow(message, detail, currentRequestId(), currentScanId());
    } catch {
      // Formatting itself must never throw back into the caller.
    }
  };
}
