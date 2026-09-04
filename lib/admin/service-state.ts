// OPERATIONAL KILL SWITCHES - server-side enforcement.
//
// Four switches, all typed SETTINGS_REGISTRY entries in the "Operations"
// group: MAINTENANCE_MODE, PAUSE_SIGNUPS, PAUSE_LOGINS, PAUSE_SCANNING. They
// answer "is the service open for business right now", which is a different
// question from the FEATURE_* flags ("does this deployment ship teams").
//
// Everything here is the mechanism. Greying out a button is a courtesy on top
// of it: a disabled signup form that still accepts a POST is not a pause, so
// every switch is checked at the request boundary before any work happens.
//
// Shape follows lib/teams/feature-gate.ts deliberately: a function that
// returns a ready-to-return NextResponse when the gate is closed, or null
// when it is open, so a route handler is one `if` and no new control flow.
//
// MAINTENANCE_MODE implies the other three. An operator who declares
// maintenance should not have to also remember to tick "pause scanning", and
// the reverse (maintenance on, scans still queueing against a dead database)
// is exactly the failure this exists to prevent.
//
// Server only: this talks to Postgres. middleware.ts runs on the Edge
// runtime and cannot import it (see the note in that file about the
// environment-variable break-glass).

import { NextResponse } from "next/server";

import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { isStaffRole } from "@/lib/auth/permissions-client";
import { getSettings } from "@/lib/config/runtime-config";

/**
 * How long a client should wait before retrying a refused request. Five
 * minutes: long enough that a retry storm does not undo the point of the
 * pause, short enough that a client which honours it recovers on its own
 * once the switch goes back off.
 */
const RETRY_AFTER_SECONDS = 300;

/**
 * Built-in wording, used when the operator left the companion message empty.
 * Each says what happened and what the reader can do, because "scanning is
 * paused" with no reason is a support ticket.
 */
const DEFAULT_MESSAGES = {
  maintenance:
    "This service is down for maintenance. Nothing has been lost, and it will be back shortly.",
  signups:
    "New account signups are paused right now. Existing accounts are unaffected. Please try again later.",
  logins:
    "Signing in is paused right now while we work on the service. Please try again shortly.",
  scanning:
    "Scanning is paused right now. Existing results are unaffected, and new scans will be accepted again shortly.",
} as const;

/**
 * getSettings widens its value type across every key requested, so a mixed
 * bool/string read comes back as `string | boolean` per key. These two keep
 * the narrowing in one place instead of at each call site.
 */
function asBool(value: string | boolean): boolean {
  return value === true;
}

function asMessage(value: string | boolean, fallback: string): string {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : fallback;
}

export type ServiceStateSnapshot = {
  maintenance: boolean;
  maintenanceMessage: string;
  signupsPaused: boolean;
  signupsMessage: string;
  loginsPaused: boolean;
  loginsMessage: string;
  scanningPaused: boolean;
  scanningMessage: string;
};

/**
 * All four switches resolved from one settings snapshot.
 *
 * Fails OPEN on any resolver problem, matching getSetting's own behaviour
 * (lib/config/runtime-config.ts catches its query and returns an empty map,
 * so every key falls through to its environment override or shipped
 * default). A database blip must not be able to put a healthy deployment
 * into maintenance by itself.
 */
export async function getServiceState(): Promise<ServiceStateSnapshot> {
  const raw = await getSettings([
    "MAINTENANCE_MODE",
    "MAINTENANCE_MESSAGE",
    "PAUSE_SIGNUPS",
    "PAUSE_SIGNUPS_MESSAGE",
    "PAUSE_LOGINS",
    "PAUSE_LOGINS_MESSAGE",
    "PAUSE_SCANNING",
    "PAUSE_SCANNING_MESSAGE",
  ] as const);

  const maintenance = asBool(raw.MAINTENANCE_MODE);
  const maintenanceMessage = asMessage(
    raw.MAINTENANCE_MESSAGE,
    DEFAULT_MESSAGES.maintenance,
  );

  // Maintenance implies the rest, and carries its own message into them so a
  // user who tries to scan during a maintenance window is told about the
  // maintenance window rather than a generic pause.
  return {
    maintenance,
    maintenanceMessage,
    signupsPaused: maintenance || asBool(raw.PAUSE_SIGNUPS),
    signupsMessage: maintenance
      ? maintenanceMessage
      : asMessage(raw.PAUSE_SIGNUPS_MESSAGE, DEFAULT_MESSAGES.signups),
    loginsPaused: maintenance || asBool(raw.PAUSE_LOGINS),
    loginsMessage: maintenance
      ? maintenanceMessage
      : asMessage(raw.PAUSE_LOGINS_MESSAGE, DEFAULT_MESSAGES.logins),
    scanningPaused: maintenance || asBool(raw.PAUSE_SCANNING),
    scanningMessage: maintenance
      ? maintenanceMessage
      : asMessage(raw.PAUSE_SCANNING_MESSAGE, DEFAULT_MESSAGES.scanning),
  };
}

/**
 * 503, not 403. A pause is temporary and the client should come back, which
 * is what Service Unavailable plus Retry-After says; 403 tells a client the
 * request will never be allowed and tells a crawler to stop asking.
 */
function pausedResponse(message: string): NextResponse {
  return NextResponse.json(
    { error: message, paused: true },
    {
      status: 503,
      headers: { "Retry-After": String(RETRY_AFTER_SECONDS) },
    },
  );
}

/**
 * Gate for every scan entry point. Returns a response to hand straight back,
 * or null when scanning is allowed.
 *
 * Call it FIRST in the handler, before auth, rate limiting or quota: a
 * refused scan must not burn the caller's daily allowance, and a pause is
 * not information worth hiding behind a session check (the maintenance page
 * announces it to the whole internet anyway).
 */
export async function scanningPausedResponse(): Promise<NextResponse | null> {
  const state = await getServiceState();
  if (!state.scanningPaused) return null;
  return pausedResponse(state.scanningMessage);
}

/**
 * Same gate for the background scheduled-scan worker, which has no request
 * and no response: it just needs the boolean and the reason for its log line.
 */
export async function scanningPausedReason(): Promise<string | null> {
  const state = await getServiceState();
  return state.scanningPaused ? state.scanningMessage : null;
}

/** Gate for new account creation. */
export async function signupsPausedResponse(): Promise<NextResponse | null> {
  const state = await getServiceState();
  if (!state.signupsPaused) return null;
  return pausedResponse(state.signupsMessage);
}

/** The reason string alone, for callers that redirect instead of returning JSON. */
export async function signupsPausedReason(): Promise<string | null> {
  const state = await getServiceState();
  return state.signupsPaused ? state.signupsMessage : null;
}

/**
 * Gate for issuing a new session to `role`.
 *
 * Staff are always exempt. That is the single most important property of
 * this whole file: a login pause that locks out staff is unrecoverable
 * without opening a psql prompt, and the person who needs to undo it is
 * exactly the person it would have locked out.
 *
 * Call it AFTER credentials have been verified, not before. Checking on the
 * way in would mean an unknown email gets "logins are paused" while a staff
 * email falls through to the normal flow, which turns the pause into a staff
 * account enumeration oracle. Checking after verification means only someone
 * who already proved they own the account learns anything.
 */
export async function loginsPausedReasonFor(
  role: string | null | undefined,
): Promise<string | null> {
  if (isStaffRole(role)) return null;
  const state = await getServiceState();
  return state.loginsPaused ? state.loginsMessage : null;
}

/** The same gate, as a ready-to-return response. */
export async function loginsPausedResponseFor(
  role: string | null | undefined,
): Promise<NextResponse | null> {
  const reason = await loginsPausedReasonFor(role);
  return reason === null ? null : pausedResponse(reason);
}

/**
 * Page paths that stay reachable during maintenance for everyone, staff or
 * not. Only the login surface qualifies: a signed-out staff member is
 * indistinguishable from any other visitor until they have signed in, so
 * blocking /login is what would actually lock the operator out.
 *
 * The admin panel is NOT listed, and does not need to be: a signed-in staff
 * member passes the staff check below and reaches every page, and a non-staff
 * visitor who guesses /admin gets the maintenance page instead of the
 * panel's own access-denied screen, which is no loss.
 */
const MAINTENANCE_EXEMPT_PATHS = ["/login"] as const;

/**
 * Whether the current viewer is staff, for the maintenance gate only.
 *
 * A plain role read, NOT requireStaff(): that helper also applies
 * ENFORCE_STAFF_2FA, and a staff member who has not set up their second
 * factor yet would then be shown the maintenance page with no route to
 * /profile to fix it. Maintenance mode must not become a second, subtler
 * lockout mechanism. Authorization for anything that matters still runs
 * through requireStaff/requireAdmin in the routes themselves.
 *
 * Any failure reads as "not staff". During maintenance caused by a dead
 * database that is the honest answer anyway: nothing behind the gate would
 * work, and the environment-variable form of the switch is how you turn it
 * back off in that state.
 */
async function viewerIsStaff(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session) return false;
    const result = await pool.query<{ role: string | null }>(
      "SELECT role FROM users WHERE id = $1",
      [session.userId],
    );
    return isStaffRole(result.rows[0]?.role);
  } catch {
    return false;
  }
}

export type MaintenanceGate =
  { active: false } | { active: true; message: string };

/**
 * What the root layout renders. `active: true` means "show the maintenance
 * screen instead of this page".
 *
 * pathname comes from the x-pathname request header middleware.ts sets. A
 * missing header (a render outside the middleware matcher) is treated as a
 * non-exempt path, so the gate errs towards showing the maintenance screen
 * rather than towards leaking the app.
 */
export async function maintenanceGate(
  pathname: string | null,
): Promise<MaintenanceGate> {
  const state = await getServiceState();
  if (!state.maintenance) return { active: false };

  const normalized = pathname ?? "";
  if (
    MAINTENANCE_EXEMPT_PATHS.some(
      (p) => normalized === p || normalized.startsWith(`${p}/`),
    )
  ) {
    return { active: false };
  }

  if (await viewerIsStaff()) return { active: false };
  return { active: true, message: state.maintenanceMessage };
}
