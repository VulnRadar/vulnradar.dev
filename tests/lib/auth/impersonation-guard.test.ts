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
const ACTIONS_ROOT = join(process.cwd(), "app/actions");
const GUARD = "refuseWhileImpersonating";
/** A server action has no response to return, so it throws the same refusal. */
const ACTION_GUARD = "throwIfImpersonating";

/**
 * Writes that change who the account holder is, or end the account. Reads are
 * not included: showing a value through impersonation is the feature.
 *
 * `(?<![=!<>])=(?!=)` is assignment and not comparison. Without it
 * `two_factor_method === "email"`, an ordinary read in the Discord callback,
 * matched and the guard demanded a credential guard on a route that writes
 * nothing.
 *
 * A linked Google, GitHub or Discord identity is a credential too: it signs
 * into the account with no password. Those columns are looked up by value on
 * nearly every OAuth path (`WHERE google_id = $1`), so assignment is not enough
 * of a test for them and the match needs a SET with no WHERE before the column.
 * discord_connections is a table, so it is the statements that write it.
 *
 * saveGithubConnection stores a repo grant and revokes the token it replaces at
 * GitHub, which is what DELETE /account/github refuses.
 *
 * An API key is a credential with no session behind it, so minting one through
 * an impersonation outlives the impersonation, and revoking, rotating or
 * unbinding one breaks the customer's integrations. The four lib/api/api-keys
 * writers are matched by their call.
 *
 * A Stripe subscription create, update or cancel, a PaymentIntent, and a
 * billing portal session, move the customer's money: an immediate cancel
 * forfeits a paid period, a price switch prorates against the card on file, a
 * new subscription or a PaymentIntent can be paid from what the Stripe
 * customer already holds, and the portal can do any of it. A file that calls
 * one is held to the same rule; reactivate is the listed exception below.
 */
const MONEY_MOVE =
  /\bsubscriptions\.(?:create|update|cancel)\s*\(|\bpaymentIntents\.create\s*\(|\bbillingPortal\.sessions\.create\s*\(/;
const CREDENTIAL_WRITE = new RegExp(
  /(?:password_hash|totp_secret|backup_codes|totp_enabled|two_factor_method)\s*(?<![=!<>])=(?!=)|SET email|deleteUserAccountData|\bSET\b(?:(?!\bWHERE\b)[^`"])*?\b(?:google_id|github_id|discord_id)\s*=(?!=)|(?:INSERT INTO|UPDATE|DELETE FROM)\s+discord_connections\b|\bsaveGithubConnection\b|\b(?:generateApiKey|rotateApiKey|revokeApiKey|resetApiKeyBinding)\s*\(/
    .source +
    "|" +
    MONEY_MOVE.source,
);

/**
 * Server actions in app/actions/stripe.ts that call Stripe and still do not
 * need the guard, each with the reason.
 */
const ACTIONS_NO_GUARD_NEEDED = new Map<string, string>([
  [
    "confirmSubscription",
    "only retrieves a subscription the customer already paid for and copies its status onto their own row, the same as the webhook",
  ],
  [
    "confirmAiCreditPurchase",
    "only retrieves a PaymentIntent the customer already paid and credits it once, the same as the webhook",
  ],
  [
    "confirmGithubCreditPurchase",
    "only retrieves a PaymentIntent the customer already paid and credits it once, the same as the webhook",
  ],
  [
    "confirmBrowserbaseCreditPurchase",
    "only retrieves a PaymentIntent the customer already paid and credits it once, the same as the webhook",
  ],
]);

/** Each exported async function in a server action file, by name. */
function exportedActions(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const starts = [...source.matchAll(/export async function (\w+)\s*\(/g)];
  for (const [i, m] of starts.entries()) {
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
    out.set(m[1], source.slice(m.index, end));
  }
  return out;
}

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
  [
    "billing/subscription/reactivate/route.ts",
    "undoes a pending cancellation the customer can make again themselves, starts no new charge and changes no price, so refusing it would only stop staff from reversing a period-end cancel they made while reproducing a bug",
  ],
  [
    "webhooks/stripe/route.ts",
    "authenticated by Stripe's signature, never by a session, so no impersonation session can reach it; it cancels a subscription only after a second failed renewal Stripe itself reported",
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

  it("guards every server action that writes one", () => {
    // app/actions is the other way in: a "use server" export is a POST
    // endpoint with the caller's session, and nothing under app/api sees it.
    const actions = readdirSync(ACTIONS_ROOT).filter((f) => f.endsWith(".ts"));
    expect(actions).toContain("stripe.ts");
    const unguarded = actions.filter((file) => {
      const source = readFileSync(join(ACTIONS_ROOT, file), "utf8");
      return (
        CREDENTIAL_WRITE.test(code(source)) && !source.includes(ACTION_GUARD)
      );
    });
    expect(
      unguarded,
      `These server actions write a credential or move money and do not call ${ACTION_GUARD}(): ` +
        unguarded.join(", "),
    ).toEqual([]);
  });

  it("guards each key writer and each money-moving Stripe call at its own route", () => {
    // A file-level match is satisfied by one guard anywhere in it, so the
    // files where only one branch moves money are checked at that branch.
    for (const rel of [
      "keys/route.ts",
      "keys/[id]/rotate/route.ts",
      "keys/[id]/revoke/route.ts",
      "keys/[id]/reset-binding/route.ts",
      "billing/route.ts",
      "billing/subscription/cancel/route.ts",
    ]) {
      expect(readFileSync(join(API_ROOT, rel), "utf8"), rel).toContain(GUARD);
    }
    const billing = code(
      readFileSync(join(API_ROOT, "billing/route.ts"), "utf8"),
    );
    const immediate = billing.slice(billing.indexOf('"cancel_immediately"'));
    expect(
      immediate.slice(0, immediate.indexOf("subscriptions.cancel(")),
    ).toContain(GUARD);
  });

  it("refuses each Stripe server action that moves money before Stripe or the database is touched", () => {
    const actions = exportedActions(
      code(readFileSync(join(ACTIONS_ROOT, "stripe.ts"), "utf8")),
    );
    // The ones that exist today, so a rename cannot make this pass by
    // matching nothing.
    const moving = [...actions].filter(([, body]) => MONEY_MOVE.test(body));
    expect(moving.map(([name]) => name).sort()).toEqual([
      "createAiCreditPaymentIntent",
      "createBillingPortalSession",
      "createBrowserbaseCreditPaymentIntent",
      "createGithubCreditPaymentIntent",
      "createSubscription",
    ]);
    for (const [name, body] of moving) {
      const guard = body.indexOf(`${ACTION_GUARD}(`);
      expect(guard, `${name} never calls ${ACTION_GUARD}()`).toBeGreaterThan(
        -1,
      );
      // At the top: a guard after the first read or the first Stripe call
      // leaves a path (the staff floor plan change, a customer created on
      // the account) that runs before it.
      for (const first of ["getStripe(", "pool.query(", "stripe."]) {
        const at = body.indexOf(first);
        if (at < 0) continue;
        expect(guard, `${name}: ${ACTION_GUARD}() after ${first}`).toBeLessThan(
          at,
        );
      }
    }
  });

  it("lets only the read-only Stripe server actions skip the guard", () => {
    const actions = exportedActions(
      code(readFileSync(join(ACTIONS_ROOT, "stripe.ts"), "utf8")),
    );
    const unguarded = [...actions]
      .filter(([, body]) => /getStripe\(/.test(body))
      .filter(([, body]) => !body.includes(ACTION_GUARD))
      .map(([name]) => name);
    expect(unguarded.sort()).toEqual(
      [...ACTIONS_NO_GUARD_NEEDED.keys()].sort(),
    );
    for (const name of ACTIONS_NO_GUARD_NEEDED.keys()) {
      // An exception is only true while the action calls nothing but
      // retrieve on Stripe.
      const calls = [
        ...actions.get(name)!.matchAll(/\bstripe!?\.(\w+(?:\.\w+)*)\(/g),
      ].map((m) => m[1]);
      expect(calls.length, name).toBeGreaterThan(0);
      for (const call of calls) expect(call, name).toMatch(/\.retrieve$/);
    }
  });

  it("counts minting a key or moving a subscription as a credential write", () => {
    for (const write of [
      "const key = await generateApiKey(session.userId, name)",
      "await rotateApiKey(keyId, session.userId, limit)",
      "await revokeApiKey(keyId, session.userId)",
      "await resetApiKeyBinding(keyId, session.userId)",
      "await stripe.subscriptions.cancel(subscriptionId)",
      "await stripe.subscriptions.update(id, { cancel_at: now })",
      "await stripe.billingPortal.sessions.create({ customer })",
      "await stripe.subscriptions.create({ customer: customerId })",
      "await stripe.paymentIntents.create({ amount, customer })",
    ]) {
      expect(CREDENTIAL_WRITE.test(write), write).toBe(true);
    }
    for (const read of [
      "const keys = await getUserApiKeys(session.userId)",
      "await stripe.subscriptions.retrieve(id)",
      "await stripe.subscriptions.list({ customer })",
      "await stripe.paymentIntents.retrieve(paymentIntentId)",
    ]) {
      expect(CREDENTIAL_WRITE.test(read), read).toBe(false);
    }
  });

  it("counts writing a sign-in provider as a credential write, and looking one up as not", () => {
    for (const write of [
      "UPDATE users SET google_id = $1, google_email = $2 WHERE id = $5",
      "UPDATE users SET github_id = $1 WHERE id = $2 AND github_id IS NULL",
      'pool.query("UPDATE users SET discord_id = $1 WHERE id = $2", [a, b])',
      "UPDATE users SET name = $1, discord_id = NULL WHERE id = $2",
      "UPDATE users SET ${idColumn} = $1, discord_id = $2 WHERE id = $3",
      "INSERT INTO discord_connections (user_id) VALUES ($1)",
      "UPDATE discord_connections SET access_token = $1",
      "DELETE FROM discord_connections WHERE user_id = $1",
      "await saveGithubConnection({ userId: session.userId })",
    ]) {
      expect(CREDENTIAL_WRITE.test(write), write).toBe(true);
    }
    for (const read of [
      "SELECT id FROM users WHERE google_id = $1",
      "SELECT user_id FROM discord_connections WHERE discord_id = $1",
      "UPDATE users SET avatar_url = $1 WHERE discord_id = $2",
      "const same = row.github_id === userId",
    ]) {
      expect(CREDENTIAL_WRITE.test(read), read).toBe(false);
    }
  });

  it("guards every place a sign-in provider or a repo grant gets attached", () => {
    // The start routes write nothing, so the enumeration above cannot see
    // them. Refusing only at the callback would still mint a usable state.
    for (const rel of [
      "auth/oauth/[provider]/route.ts",
      "auth/oauth/[provider]/callback/route.ts",
      "auth/discord/route.ts",
      "auth/discord/callback/route.ts",
      "account/github/connect/route.ts",
    ]) {
      expect(readFileSync(join(API_ROOT, rel), "utf8"), rel).toContain(GUARD);
    }
  });

  it("gives the repo grant's refusal a sentence on the profile page", () => {
    // The callback can only report this as a code in the URL, and a code with
    // no entry falls through to "Could not grant repo access."
    const page = readFileSync(
      join(process.cwd(), "app/profile/page.tsx"),
      "utf8",
    );
    const errors = page.slice(page.indexOf("GITHUB_CONNECT_ERRORS"));
    expect(errors.slice(0, errors.indexOf("};"))).toMatch(
      /impersonation_blocked:[\s\S]*?admin/,
    );
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

  it("throws the same sentence for a server action", async () => {
    const { refuseWhileImpersonating, throwIfImpersonating } =
      await import("@/lib/auth/impersonation-guard");
    expect(() =>
      throwIfImpersonating(null, "Opening the billing portal"),
    ).not.toThrow();
    expect(() =>
      throwIfImpersonating({}, "Opening the billing portal"),
    ).not.toThrow();
    const refused = refuseWhileImpersonating(
      { impersonatedBy: 7 },
      "Opening the billing portal",
    );
    const { error } = await refused!.json();
    expect(() =>
      throwIfImpersonating({ impersonatedBy: 7 }, "Opening the billing portal"),
    ).toThrow(error);
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
