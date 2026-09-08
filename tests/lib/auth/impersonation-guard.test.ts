/**
 * An impersonation session is an ordinary signed-in user as far as every route
 * below the admin panel is concerned. That is the point of it, and it is also
 * why four routes that rewrite the account's credentials or destroy it were
 * reachable through one while writing no audit row at all: `auth/update`
 * (email and password), `2fa/disable`, `2fa/backup-codes` and
 * `account/delete`. Changing the email redirects every future password reset,
 * which the admin panel itself treats as account takeover in one step and puts
 * behind a password prompt; through impersonation it needed no password and
 * left no record.
 *
 * Asserting the six routes fixed today would catch nothing, because the
 * failure mode is the seventh. So this finds every API route whose source
 * writes a credential column and requires each one to either call the guard or
 * be listed below with the reason it does not need to.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const API_ROOT = join(process.cwd(), "app/api/v3");
const GUARD = "refuseWhileImpersonating";

/**
 * Writes that change who the account holder is, or end the account. Reads are
 * not included: showing a value through impersonation is the feature.
 *
 * `(?<![=!<>])=(?!=)` is assignment and not comparison. Without it
 * `two_factor_method === "email"`, an ordinary read in the Discord callback,
 * matched and the guard demanded a credential guard on a route that writes
 * nothing.
 */
const CREDENTIAL_WRITE =
  /(?:password_hash|totp_secret|backup_codes|totp_enabled|two_factor_method)\s*(?<![=!<>])=(?!=)|SET email|deleteUserAccountData/;

/**
 * Comments are stripped before testing. A guard that reads raw source finds
 * its own subject in a comment ABOUT the subject: admin/staff-invites was
 * flagged for a line explaining that it had stopped reading password_hash.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/**
 * Routes that write those columns and still do not need the guard, each with
 * the reason. "It has no session" is the common one: a guard keyed on
 * `session.impersonatedBy` is unreachable where there is no session to read.
 */
const NO_GUARD_NEEDED = new Map<string, string>([
  [
    "admin/route.ts",
    "the admin surface itself, which is the legitimate path for these changes and is password-gated, rank-checked and audited; impersonation cannot reach it, because requireStaff re-reads the TARGET's role and an impersonated target is role tier 0",
  ],
  [
    "auth/reset-password/route.ts",
    "authenticated by a emailed token, not a session",
  ],
  [
    "auth/verify-email/route.ts",
    "authenticated by an emailed token, not a session",
  ],
  [
    "auth/2fa/verify/route.ts",
    "runs at the two-factor prompt, before the session is issued",
  ],
]);

/** Every route.ts under app/api/v3, as a path relative to that root. */
function routeFiles(dir = API_ROOT, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...routeFiles(full, prefix ? `${prefix}/${entry}` : entry));
    } else if (entry === "route.ts") {
      out.push(prefix ? `${prefix}/${entry}` : entry);
    }
  }
  return out;
}

const routes = routeFiles();

describe("impersonation cannot rewrite the account it is impersonating", () => {
  it("finds the API routes at all", () => {
    // A move of app/api/v3 would otherwise turn this into a test that passes
    // by finding nothing to check.
    expect(routes.length).toBeGreaterThan(50);
    expect(routes).toContain("auth/update/route.ts");
  });

  it("guards every route that writes a credential, or says why not", () => {
    const unguarded: string[] = [];
    for (const rel of routes) {
      const source = readFileSync(join(API_ROOT, rel), "utf8");
      if (!CREDENTIAL_WRITE.test(code(source))) continue;
      if (source.includes(GUARD)) continue;
      if (NO_GUARD_NEEDED.has(rel)) continue;
      unguarded.push(rel);
    }

    expect(
      unguarded,
      "These routes rewrite an account's credentials or delete it, and an " +
        "impersonation session reaches them as an ordinary signed-in user. " +
        `Either call ${GUARD}() from lib/auth/impersonation-guard.ts, or add ` +
        "the route to NO_GUARD_NEEDED in this file with the reason: " +
        unguarded.join(", "),
    ).toEqual([]);
  });

  it("does not carry exceptions for routes that no longer exist", () => {
    const gone = [...NO_GUARD_NEEDED.keys()].filter((r) => !routes.includes(r));
    expect(gone).toEqual([]);
  });

  it("does not carry exceptions for routes that stopped writing credentials", () => {
    // An exception outliving the write it excused is a reason nobody can check.
    const stale = [...NO_GUARD_NEEDED.keys()].filter((rel) => {
      const source = readFileSync(join(API_ROOT, rel), "utf8");
      return !CREDENTIAL_WRITE.test(code(source));
    });
    expect(stale).toEqual([]);
  });

  it("refuses only an impersonation session, and says what to do instead", async () => {
    const { refuseWhileImpersonating } =
      await import("@/lib/auth/impersonation-guard");

    // An ordinary session is untouched: this must not become a second
    // authentication check that everyone has to satisfy.
    expect(refuseWhileImpersonating(null, "Changing your email")).toBeNull();
    expect(refuseWhileImpersonating({}, "Changing your email")).toBeNull();

    const refused = refuseWhileImpersonating(
      { impersonatedBy: 7 },
      "Changing your email",
    );
    expect(refused).not.toBeNull();
    expect(refused!.status).toBe(403);
    const body = await refused!.json();
    expect(body.impersonationBlocked).toBe(true);
    // Names the action and points at the admin action that does it properly,
    // rather than reading as a bug to the staff member who hit it.
    expect(body.error).toContain("Changing your email");
    expect(body.error).toMatch(/admin/i);
  });
});
